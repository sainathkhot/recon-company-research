import { NextRequest } from "next/server";
import { crawlSite } from "@/lib/crawler";
import { fromJsonLd, fromText, merge } from "@/lib/extract";
import { serper, resolveOfficialSite, normaliseRoot, findCompetitorSite, hostOf } from "@/lib/serper";
import { analyse } from "@/lib/analyse";
import { DEFAULT_MODEL } from "@/lib/openrouter";
import type { CompanyReport, ResearchEvent, SearchHit, TrailStep } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const enc = new TextEncoder();

function docketNo(): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RC-${ymd}-${rand}`;
}

const looksLikeUrl = (s: string) =>
  /^https?:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s.trim());

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    model?: string;
    serperKey?: string;
    openrouterKey?: string;
  };
  const input = (body.query ?? "").trim();
  const chosenModel = (body.model ?? "").trim() || DEFAULT_MODEL;
  // Optional per-request keys. Never persisted, never logged, never shared
  // between requests — they live only in this closure.
  const serperKey = (body.serperKey ?? "").trim() || undefined;
  const openrouterKey = (body.openrouterKey ?? "").trim() || undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      let searchCount = 0;

      const emit = (e: ResearchEvent) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };
      const step = (s: TrailStep) => emit({ type: "step", step: s });
      const timers = new Map<string, number>();
      const begin = (id: string, stage: TrailStep["stage"], label: string, detail?: string) => {
        timers.set(id, Date.now());
        step({ id, stage, label, detail, status: "running" });
      };
      const finish = (id: string, stage: TrailStep["stage"], label: string, detail?: string) =>
        step({ id, stage, label, detail, status: "done", ms: Date.now() - (timers.get(id) ?? Date.now()) });

      try {
        if (!input) throw new Error("Enter a company name or a website URL to begin.");
        if (!serperKey && !process.env.SERPER_API_KEY)
          throw new Error("No Serper.dev API key. Add one in Settings, or set SERPER_API_KEY on the server.");
        if (!openrouterKey && !process.env.OPENROUTER_API_KEY)
          throw new Error("No OpenRouter API key. Add one in Settings, or set OPENROUTER_API_KEY on the server.");

        /* ── 1. Resolve the official website ───────────────── */
        let website: string;
        let label = input;
        let knowledge: Record<string, any> | undefined;
        const seedHits: SearchHit[] = [];

        if (looksLikeUrl(input)) {
          begin("resolve", "resolve", "Reading supplied URL");
          website = normaliseRoot(input);
          label = hostOf(website).split(".")[0] || website;
          finish("resolve", "resolve", "Reading supplied URL", website);
        } else {
          begin("resolve", "resolve", "Locating official website", `Searching for "${input}"`);
          const r = await resolveOfficialSite(input, serperKey);
          searchCount++;
          website = r.url;
          seedHits.push(...r.hits);
          finish("resolve", "resolve", "Located official website", `${website} — via ${r.how}`);
        }

        /* ── 2. Public-source search sweep ─────────────────── */
        begin("search", "search", "Sweeping public sources", "4 Serper queries");
        const queries = [
          `${label} company overview what they do`,
          `${label} contact phone number head office address`,
          `${label} products services offerings`,
          `${label} competitors alternatives same industry`,
        ];
        const sweeps = await Promise.all(
          queries.map(async (q) => {
            try {
              const r = await serper(q, { num: 8, key: serperKey });
              searchCount++;
              if (r.knowledge && !knowledge) knowledge = r.knowledge;
              return { query: q, hits: r.organic };
            } catch {
              return { query: q, hits: [] as SearchHit[] };
            }
          })
        );
        const totalHits = sweeps.reduce((s, x) => s + x.hits.length, 0);
        if (totalHits === 0) {
          step({
            id: "search",
            stage: "search",
            label: "Public source sweep returned nothing",
            detail: "Search was unavailable. Continuing with crawled pages only.",
            status: "skipped",
          });
        } else {
          finish("search", "search", "Swept public sources", `${searchCount} queries \u00b7 ${totalHits} results`);
        }

        /* ── 3. Crawl ──────────────────────────────────────── */
        begin("crawl", "crawl", `Crawling ${hostOf(website)}`, "Prioritising About, Products, Services, Contact");
        let idx = 0;
        const crawl = await crawlSite(website, {
          maxPages: 8,
          concurrency: 4,
          onPage: (p) => {
            step({
              id: `page:${idx++}`,
              stage: "crawl",
              label: `${p.kind} — ${p.title.slice(0, 64) || p.url}`,
              detail: `${p.url} · ${p.words} words`,
              status: "done",
            });
          },
        });

        if (!crawl.pages.length) {
          step({
            id: "crawl",
            stage: "crawl",
            label: `Could not crawl ${hostOf(website)}`,
            detail: "Site blocked the crawler. Continuing with search results only.",
            status: "skipped",
          });
        } else {
          finish(
            "crawl",
            "crawl",
            `Crawled ${hostOf(website)}`,
            `${crawl.pages.length} pages kept · ${crawl.skipped} duplicate or irrelevant pages skipped`
          );
        }

        if (!crawl.pages.length && totalHits === 0) {
          throw new Error(
            `No public information could be retrieved for "${input}". Check the spelling, or try the website URL directly.`
          );
        }

        const extracted = merge(fromJsonLd(crawl.jsonLd), fromText(crawl.pages));
        if (!extracted.phone && crawl.tels.length) extracted.phone = crawl.tels[0];
        if (!extracted.email && crawl.mails.length) extracted.email = crawl.mails[0];

        /* ── 4. AI analysis ────────────────────────────────── */
        begin("analyse", "analyse", "Analysing with AI", chosenModel);
        const ai = await analyse(chosenModel, {
          query: input,
          website,
          pages: crawl.pages,
          search: [{ query: `${input} official website`, hits: seedHits }, ...sweeps].filter((s) => s.hits.length),
          knowledge,
          extracted,
          apiKey: openrouterKey,
        });
        finish(
          "analyse",
          "analyse",
          "Analysis complete",
          `${ai.products.length} products · ${ai.painPoints.length} pain points`
        );

        /* ── 5. Verify competitor websites ─────────────────── */
        begin("competitors", "competitors", "Verifying competitors", `${ai.competitors.length} candidates`);
        const competitors = await Promise.all(
          ai.competitors.slice(0, 6).map(async (c) => {
            if (/^https?:\/\/\S+\.\S+/.test(c.website)) return { ...c, website: normaliseRoot(c.website) };
            const found = await findCompetitorSite(c.name, ai.industry, serperKey);
            if (found) searchCount++;
            return { ...c, website: found };
          })
        );
        const confirmed = competitors.filter((c) => c.website).length;
        finish("competitors", "competitors", "Competitors verified", `${confirmed} of ${competitors.length} websites confirmed`);

        /* ── 6. Compile ────────────────────────────────────── */
        begin("compile", "compile", "Filing the dossier");

        const sources: CompanyReport["sources"] = [
          ...crawl.pages.map((p) => ({ url: p.url, label: `${p.kind} — ${p.title || p.url}`, via: "crawl" as const })),
        ];
        const seenSrc = new Set(sources.map((s) => s.url));
        for (const s of sweeps) {
          for (const h of s.hits.slice(0, 3)) {
            if (!h.link || seenSrc.has(h.link)) continue;
            seenSrc.add(h.link);
            sources.push({ url: h.link, label: h.title || h.link, via: "search" });
          }
        }

        const report: CompanyReport = {
          docket: docketNo(),
          generatedAt: new Date().toLocaleString("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Kolkata",
          }),
          model: chosenModel,
          name: ai.name || label,
          website,
          legalName: ai.legalName || extracted.legalName,
          industry: ai.industry,
          headquarters: ai.headquarters,
          country: ai.country,
          founded: ai.founded || extracted.founded,
          employees: ai.employees || extracted.employees,
          phone: extracted.phone || ai.phone,
          email: extracted.email || ai.email,
          address: extracted.address || ai.address,
          summary: ai.summary,
          products: ai.products,
          painPoints: ai.painPoints,
          competitors,
          sources: sources.slice(0, 30),
          stats: {
            pagesCrawled: crawl.pages.length,
            searchQueries: searchCount,
            elapsedMs: Date.now() - t0,
          },
        };

        finish("compile", "compile", "Dossier filed", `Docket ${report.docket}`);
        emit({ type: "report", report });
      } catch (err: any) {
        emit({
          type: "error",
          message: err?.message ?? "Research failed unexpectedly.",
          hint: /No Serper|No OpenRouter|is not configured/i.test(err?.message ?? "")
            ? "Paste a key into Settings, or set it in .env.local (local) / your Vercel environment variables."
            : undefined,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
