import type { SearchHit } from "./types";
import { memo } from "./cache";

const ENDPOINT = "https://google.serper.dev/search";

export interface SerperResult {
  query: string;
  organic: SearchHit[];
  knowledge?: Record<string, any>;
  answerBox?: Record<string, any>;
}

let queryCount = 0;
export const searchesUsed = () => queryCount;
export const resetSearchCount = () => {
  queryCount = 0;
};

/** One Serper call. Cached for the life of the lambda so repeat runs are cheap. */
export async function serper(
  query: string,
  opts: { num?: number; gl?: string; key?: string } = {}
): Promise<SerperResult> {
  // A key entered in the UI wins; the deployment's own key is the fallback.
  const key = opts.key?.trim() || process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is not configured on the server.");

  const cacheKey = `serper:${query}:${opts.gl ?? ""}:${opts.num ?? 8}`;
  return memo(cacheKey, async () => {
    queryCount++;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12_000);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: opts.num ?? 8, ...(opts.gl ? { gl: opts.gl } : {}) }),
        signal: ctl.signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Serper ${res.status}: ${body.slice(0, 160)}`);
      }
      const json: any = await res.json();
      return {
        query,
        organic: (json.organic ?? []).map((o: any) => ({
          title: String(o.title ?? ""),
          link: String(o.link ?? ""),
          snippet: String(o.snippet ?? ""),
        })),
        knowledge: json.knowledgeGraph,
        answerBox: json.answerBox,
      };
    } finally {
      clearTimeout(t);
    }
  });
}

const AGGREGATORS =
  /(wikipedia|linkedin|crunchbase|bloomberg|zoominfo|glassdoor|indeed|facebook|twitter|x\.com|instagram|youtube|yelp|tracxn|owler|pitchbook|rocketreach|apollo\.io|dnb\.com|zaubacorp|tofler|justdial|ambitionbox|medium\.com|reddit|quora|github\.io|amazon\.|play\.google|apps\.apple)/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Turn a plain company name into its official website.
 * Prefers the knowledge-graph link, then the first organic result that is not
 * a directory / social / news aggregator.
 */
export async function resolveOfficialSite(
  name: string,
  key?: string
): Promise<{ url: string; how: string; hits: SearchHit[] }> {
  const r = await serper(`${name} official website`, { num: 10, key });

  const kg = r.knowledge?.website || r.knowledge?.descriptionLink;
  if (typeof kg === "string" && /^https?:\/\//.test(kg) && !AGGREGATORS.test(kg)) {
    return { url: normaliseRoot(kg), how: "Google knowledge panel", hits: r.organic };
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const scored = r.organic
    .filter((o) => /^https?:\/\//.test(o.link) && !AGGREGATORS.test(o.link))
    .map((o) => {
      const h = hostOf(o.link);
      let score = 0;
      const bare = h.split(".")[0].replace(/[^a-z0-9]/g, "");
      if (bare === slug) score += 60;
      else if (bare.includes(slug) || slug.includes(bare)) score += 32;
      if (/\.(com|io|ai|co|net|org)$/.test(h)) score += 8;
      if (new URL(o.link).pathname.replace(/\/$/, "") === "") score += 14;
      return { o, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const fallback = await serper(name, { num: 10, key });
    const first = fallback.organic.find((o) => !AGGREGATORS.test(o.link));
    if (!first) throw new Error(`Could not find an official website for “${name}”.`);
    return { url: normaliseRoot(first.link), how: "top search result", hits: fallback.organic };
  }
  return { url: normaliseRoot(scored[0].o.link), how: "best-matching search result", hits: r.organic };
}

export function normaliseRoot(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return url;
  }
}

/** Resolve a competitor's homepage when the model didn't supply a usable one. */
export async function findCompetitorSite(name: string, industry?: string, key?: string): Promise<string> {
  try {
    const r = await serper(`${name} ${industry ?? "company"} official site`, { num: 6, key });
    const kg = r.knowledge?.website;
    if (typeof kg === "string" && /^https?:\/\//.test(kg)) return normaliseRoot(kg);
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const best =
      r.organic.find((o) => !AGGREGATORS.test(o.link) && hostOf(o.link).replace(/[^a-z0-9]/g, "").includes(slug)) ??
      r.organic.find((o) => !AGGREGATORS.test(o.link));
    return best ? normaliseRoot(best.link) : "";
  } catch {
    return "";
  }
}