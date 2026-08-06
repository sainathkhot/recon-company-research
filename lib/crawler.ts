import * as cheerio from "cheerio";
import type { CrawledPage } from "./types";

const UA =
  "Mozilla/5.0 (compatible; ReconResearchBot/1.0; +https://github.com/) AppleWebKit/537.36 Chrome/124 Safari/537.36";

/**
 * Pages we actively want, highest value first. The crawler is a best-first
 * search over this scoring function rather than a blind BFS — a 6-page budget
 * spent on About + Products + Contact beats 30 pages of blog archive.
 */
const PRIORITY: { re: RegExp; weight: number; kind: string }[] = [
  { re: /^\/?$/, weight: 100, kind: "Home" },
  { re: /(about|company|who-we-are|our-story|overview|mission)/i, weight: 92, kind: "About" },
  { re: /(products?|platform|features?|technology|offerings?)/i, weight: 90, kind: "Products" },
  { re: /(services?|what-we-do|capabilities|expertise)/i, weight: 88, kind: "Services" },
  { re: /(solutions?|use-cases?)/i, weight: 84, kind: "Solutions" },
  { re: /(contact|get-in-touch|reach-us|locations?|offices?)/i, weight: 82, kind: "Contact" },
  { re: /(pricing|plans|packages|subscribe)/i, weight: 76, kind: "Pricing" },
  { re: /(industries|sectors|markets|clients|customers|case-stud)/i, weight: 58, kind: "Customers" },
  { re: /(team|leadership|people|management)/i, weight: 34, kind: "Team" },
];

const SKIP_PATH =
  /(\/login|\/log-in|\/signin|\/sign-in|\/signup|\/sign-up|\/register|\/account|\/dashboard|\/cart|\/checkout|\/basket|\/wishlist|\/privacy|\/terms|\/legal|\/cookie|\/gdpr|\/disclaimer|\/sitemap|\/rss|\/feed|\/wp-admin|\/wp-login|\/wp-json|\/tag\/|\/tags\/|\/category\/|\/categories\/|\/author\/|\/archive|\/search|\/cdn-cgi|\/admin)/i;

const SKIP_EXT =
  /\.(pdf|docx?|xlsx?|pptx?|zip|rar|gz|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|css|js|json|xml|txt|woff2?|ttf|eot)(\?|#|$)/i;

function score(pathname: string): { weight: number; kind: string } {
  const p = pathname.toLowerCase();
  const depth = p.split("/").filter(Boolean).length;
  for (const { re, weight, kind } of PRIORITY) {
    if (re.test(p)) return { weight: weight - depth * 4, kind };
  }
  return { weight: 18 - depth * 5, kind: "Page" };
}

function canonical(raw: string, base: string): string | null {
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    // Strip tracking noise so ?utm_source variants don't look like new pages.
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|ref|source|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    u.pathname = u.pathname.replace(/\/{2,}/g, "/").replace(/\/index\.(html?|php)$/i, "/");
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/$/, "");
    return u.toString();
  } catch {
    return null;
  }
}

async function get(url: string, timeoutMs = 7000): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 3_500_000) return null;
    return new TextDecoder("utf-8").decode(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export interface PageParse {
  title: string;
  description: string;
  text: string;
  links: string[];
  jsonLd: any[];
  tels: string[];
  mails: string[];
}

export function parse(html: string, url: string): PageParse {
  const $ = cheerio.load(html);

  const jsonLd: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const v = JSON.parse($(el).contents().text());
      Array.isArray(v) ? jsonLd.push(...v) : jsonLd.push(v);
    } catch {
      /* malformed structured data is common — ignore */
    }
  });

  const tels: string[] = [];
  const mails: string[] = [];
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^tel:/i.test(href)) tels.push(decodeURIComponent(href.slice(4)).trim());
    else if (/^mailto:/i.test(href)) mails.push(decodeURIComponent(href.slice(7)).split("?")[0].trim());
    else if (!/^(javascript:|#|data:)/i.test(href)) {
      const c = canonical(href, url);
      if (c) links.push(c);
    }
  });

  const title = ($("title").first().text() || $("h1").first().text() || "").trim().slice(0, 180);
  const description = ($('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "").trim();

  $("script, style, noscript, svg, iframe, template, form, nav, footer, header, aside, [aria-hidden='true']").remove();

  const headings: string[] = [];
  $("h1, h2, h3").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t && t.length < 140) headings.push(t);
  });

  const body = ($("main").text() || $("body").text() || "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();

  const text = [description, headings.slice(0, 24).join(" · "), body].filter(Boolean).join("\n\n");

  return { title, description, text, links, jsonLd, tels, mails };
}

/** 96-bit fingerprint of the page's first meaningful words — cheap near-dupe detector. */
function fingerprint(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 60).join(" ");
}

export interface CrawlResult {
  pages: CrawledPage[];
  jsonLd: any[];
  tels: string[];
  mails: string[];
  finalOrigin: string;
  skipped: number;
}

export async function crawlSite(
  startUrl: string,
  opts: { maxPages?: number; concurrency?: number; onPage?: (p: CrawledPage) => void } = {}
): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 8;
  const concurrency = opts.concurrency ?? 4;

  const start = canonical(startUrl, startUrl) ?? startUrl;
  const origin = new URL(start).origin;
  const rootHost = new URL(start).hostname.replace(/^www\./, "");

  const queue: { url: string; weight: number; kind: string }[] = [{ url: start, weight: 100, kind: "Home" }];
  const seen = new Set<string>([start]);
  const fingerprints = new Set<string>();
  /**
   * Sites with large listing sections (portfolio, blog, team) otherwise flood
   * the frontier with near-identical stubs and eat the whole page budget.
   * Unclassified pages get at most four slots per top-level section.
   */
  const sectionQuota = new Map<string, number>();

  const pages: CrawledPage[] = [];
  const jsonLd: any[] = [];
  const tels: string[] = [];
  const mails: string[] = [];
  let skipped = 0;

  const enqueue = (url: string) => {
    if (seen.has(url)) return;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return;
    }
    const host = u.hostname.replace(/^www\./, "");
    if (host !== rootHost) return; // same-site only
    if (SKIP_EXT.test(u.pathname) || SKIP_PATH.test(u.pathname)) {
      skipped++;
      return;
    }
    if (u.pathname.split("/").filter(Boolean).length > 3) return;
    const s = score(u.pathname);
    if (s.weight <= 0) return;

    if (s.kind === "Page") {
      const section = u.pathname.split("/").filter(Boolean)[0] ?? "";
      const used = sectionQuota.get(section) ?? 0;
      if (used >= 4) return;
      sectionQuota.set(section, used + 1);
    }

    seen.add(url);
    queue.push({ url, weight: s.weight, kind: s.kind });
  };

  while (pages.length < maxPages && queue.length) {
    queue.sort((a, b) => b.weight - a.weight);
    const batch = queue.splice(0, Math.min(concurrency, maxPages - pages.length));

    await Promise.all(
      batch.map(async ({ url, kind }) => {
        const html = await get(url);
        if (!html) return;
        const p = parse(html, url);

        const fp = fingerprint(p.text);
        if (fp.length > 40 && fingerprints.has(fp)) {
          skipped++;
          return; // near-duplicate of a page we already have
        }
        fingerprints.add(fp);

        // Home and Contact are worth keeping even when terse; everything else
        // needs enough substance to justify a slot in the budget.
        const density = p.text.replace(/\s/g, "").length;
        const floor = kind === "Home" || kind === "Contact" ? 180 : 450;
        if (density < floor) {
          skipped++;
          return; // stub or shell page, nothing to analyse
        }

        jsonLd.push(...p.jsonLd);
        tels.push(...p.tels);
        mails.push(...p.mails);
        p.links.forEach(enqueue);

        const page: CrawledPage = {
          url,
          title: p.title || kind,
          kind,
          words: p.text.split(/\s+/).length,
          text: p.text.slice(0, 7000),
        };
        pages.push(page);
        opts.onPage?.(page);
      })
    );
  }

  return { pages, jsonLd, tels, mails, finalOrigin: origin, skipped };
}