import { completeJson } from "./openrouter";
import type { Competitor, CrawledPage, PainPoint, SearchHit } from "./types";
import type { Extracted } from "./extract";

const SYSTEM = `You are a senior business research analyst preparing a due-diligence briefing.
You work only from the EVIDENCE supplied. You never invent phone numbers, addresses, revenue
figures, headcounts or customer names. When a fact is not present in the evidence you return an
empty string for it — an honest gap is worth more than a plausible guess.

Return ONE JSON object and nothing else. No prose, no markdown, no code fences.`;

const SCHEMA = `{
  "name": "Trading name of the company",
  "legalName": "Registered legal entity if stated, else \\"\\"",
  "industry": "Specific industry, e.g. 'B2B payments infrastructure' not 'technology'",
  "headquarters": "City, Country if determinable, else \\"\\"",
  "country": "Country of primary operation, else \\"\\"",
  "founded": "Year only, else \\"\\"",
  "employees": "Range or number if stated, else \\"\\"",
  "phone": "Primary public phone, digits and + only, else \\"\\"",
  "email": "Primary public email, else \\"\\"",
  "address": "Full postal address on one line, else \\"\\"",
  "summary": "3 to 4 sentences: what the company does, who it serves, how it makes money, what distinguishes it. Concrete and specific. No marketing adjectives.",
  "products": ["6-10 named products or service lines. Format: 'Name — one clause on what it does'"],
  "painPoints": [
    {
      "title": "4-7 word business challenge THIS company plausibly faces",
      "detail": "2-3 sentences grounding the challenge in evidence from their own site or the market, and why it matters commercially."
    }
  ],
  "competitors": [
    { "name": "Company name", "website": "https://domain.com or \\"\\"", "reason": "One clause on where they overlap" }
  ]
}`;

export interface AnalysisInput {
  query: string;
  website: string;
  pages: CrawledPage[];
  search: { query: string; hits: SearchHit[] }[];
  knowledge?: Record<string, any>;
  extracted: Extracted;
  apiKey?: string;
}

function budgetedCorpus(pages: CrawledPage[], budget = 26_000): string {
  // Home/About/Products get the biggest slice; the tail gets whatever remains.
  const weights: Record<string, number> = {
    Home: 1.25,
    About: 1.25,
    Products: 1.2,
    Services: 1.2,
    Solutions: 1,
    Contact: 0.7,
    Pricing: 0.8,
  };
  const total = pages.reduce((s, p) => s + (weights[p.kind] ?? 0.7), 0) || 1;
  return pages
    .map((p) => {
      const share = Math.floor((budget * (weights[p.kind] ?? 0.7)) / total);
      return `### [${p.kind}] ${p.title}\nURL: ${p.url}\n${p.text.slice(0, Math.max(600, share))}`;
    })
    .join("\n\n");
}

export async function analyse(model: string, input: AnalysisInput) {
  const searchBlock = input.search
    .map(
      (s) =>
        `Query: ${s.query}\n` +
        s.hits
          .slice(0, 6)
          .map((h) => `- ${h.title} (${h.link})\n  ${h.snippet}`)
          .join("\n")
    )
    .join("\n\n");

  const verified = [
    input.extracted.legalName && `Legal name (schema.org): ${input.extracted.legalName}`,
    input.extracted.phone && `Phone (extracted from site): ${input.extracted.phone}`,
    input.extracted.email && `Email (extracted from site): ${input.extracted.email}`,
    input.extracted.address && `Address (schema.org): ${input.extracted.address}`,
    input.extracted.founded && `Founded (schema.org): ${input.extracted.founded}`,
    input.extracted.employees && `Employees (schema.org): ${input.extracted.employees}`,
  ]
    .filter(Boolean)
    .join("\n");

  const kg = input.knowledge
    ? Object.entries(input.knowledge)
        .filter(([, v]) => typeof v === "string" || typeof v === "number")
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n")
    : "";

  const user = `Research subject: ${input.query}
Official website: ${input.website}

=== VERIFIED FIELDS (already extracted deterministically — prefer these over your own reading) ===
${verified || "(none found)"}

=== GOOGLE KNOWLEDGE PANEL ===
${kg || "(none)"}

=== CRAWLED WEBSITE CONTENT (${input.pages.length} pages) ===
${budgetedCorpus(input.pages)}

=== WEB SEARCH RESULTS ===
${searchBlock || "(none)"}

=== TASK ===
Fill this exact JSON shape:

${SCHEMA}

Rules:
- painPoints: exactly 4 items. These are challenges the COMPANY faces (operational, competitive,
  go-to-market, technical, regulatory) — not problems their product solves for customers. Ground
  each one in something you actually saw in the evidence.
- competitors: exactly 6 items. Same country or region where determinable, same industry, and
  overlapping products. Real companies only. Give the homepage URL when you are confident.
- products: use the company's own naming from the site.
- Never copy marketing slogans verbatim. Write in neutral analyst register.
- Output the JSON object only.`;

  const raw = await completeJson(model, SYSTEM, user, 45_000, input.apiKey);
  return normalise(raw);
}

const str = (v: any) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function normalise(raw: any) {
  const products: string[] = Array.isArray(raw.products)
    ? raw.products
        .map((p: any) => (typeof p === "string" ? p : `${str(p?.name)}${p?.description ? ` — ${str(p.description)}` : ""}`))
        .map((s: string) => s.replace(/^[-•*]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 12)
    : [];

  const painPoints: PainPoint[] = Array.isArray(raw.painPoints)
    ? raw.painPoints
        .map((p: any) =>
          typeof p === "string"
            ? { title: p.slice(0, 90), detail: "" }
            : { title: str(p?.title) || str(p?.name), detail: str(p?.detail) || str(p?.description) }
        )
        .filter((p: any) => p.title)
        .slice(0, 6)
    : [];

  const competitors: Competitor[] = Array.isArray(raw.competitors)
    ? raw.competitors
        .map((c: any) =>
          typeof c === "string"
            ? { name: c, website: "", reason: "" }
            : { name: str(c?.name), website: str(c?.website ?? c?.url), reason: str(c?.reason ?? c?.overlap) }
        )
        .filter((c: any) => c.name)
        .slice(0, 8)
    : [];

  return {
    name: str(raw.name),
    legalName: str(raw.legalName),
    industry: str(raw.industry),
    headquarters: str(raw.headquarters),
    country: str(raw.country),
    founded: str(raw.founded).slice(0, 10),
    employees: str(raw.employees),
    phone: str(raw.phone),
    email: str(raw.email),
    address: str(raw.address),
    summary: str(raw.summary),
    products,
    painPoints,
    competitors,
  };
}