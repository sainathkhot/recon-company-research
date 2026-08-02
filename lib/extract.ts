import type { CrawledPage } from "./types";

export interface Extracted {
  legalName?: string;
  phone?: string;
  email?: string;
  address?: string;
  founded?: string;
  employees?: string;
  logo?: string;
  sameAs: string[];
}

function flattenGraph(nodes: any[]): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    out.push(n);
    if (n["@graph"]) walk(n["@graph"]);
  };
  nodes.forEach(walk);
  return out;
}

function addressToString(a: any): string | undefined {
  if (!a) return;
  if (typeof a === "string") return a.replace(/\s+/g, " ").trim();
  if (Array.isArray(a)) return addressToString(a[0]);
  const parts = [
    a.streetAddress,
    a.addressLocality,
    a.addressRegion,
    a.postalCode,
    a.addressCountry?.name ?? a.addressCountry,
  ]
    .filter((x) => typeof x === "string" && x.trim())
    .map((x: string) => x.trim());
  return parts.length ? parts.join(", ") : undefined;
}

const ORG_TYPES = /(Organization|Corporation|LocalBusiness|Company|OnlineBusiness|ProfessionalService|Store)/i;

/** Structured data first — it's authored, not guessed. */
export function fromJsonLd(nodes: any[]): Extracted {
  const out: Extracted = { sameAs: [] };
  for (const n of flattenGraph(nodes)) {
    const type = Array.isArray(n["@type"]) ? n["@type"].join(" ") : String(n["@type"] ?? "");
    if (!ORG_TYPES.test(type)) continue;

    out.legalName ||= typeof n.legalName === "string" ? n.legalName : typeof n.name === "string" ? n.name : undefined;
    out.address ||= addressToString(n.address);
    out.founded ||= n.foundingDate ? String(n.foundingDate).slice(0, 10) : undefined;
    out.employees ||= n.numberOfEmployees?.value ? String(n.numberOfEmployees.value) : undefined;
    out.logo ||= typeof n.logo === "string" ? n.logo : n.logo?.url;

    if (typeof n.telephone === "string") out.phone ||= n.telephone;
    if (typeof n.email === "string") out.email ||= n.email;

    const cp = Array.isArray(n.contactPoint) ? n.contactPoint : n.contactPoint ? [n.contactPoint] : [];
    for (const c of cp) {
      if (typeof c?.telephone === "string") out.phone ||= c.telephone;
      if (typeof c?.email === "string") out.email ||= c.email;
    }
    if (Array.isArray(n.sameAs)) out.sameAs.push(...n.sameAs.filter((s: any) => typeof s === "string"));
  }
  return out;
}

const PHONE_RE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{3,5}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function looksLikePhone(s: string): boolean {
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  if (/^(19|20)\d{2}$/.test(digits)) return false; // a year
  if (/^0+$/.test(digits)) return false;
  return true;
}

export function normalisePhone(raw: string): string {
  const s = raw.replace(/[^\d+]/g, "");
  return s.startsWith("+") ? s : raw.trim().replace(/\s+/g, " ");
}

/** Fall back to scanning contact-ish pages when structured data is missing. */
export function fromText(pages: CrawledPage[]): { phones: string[]; emails: string[] } {
  const phones: string[] = [];
  const emails: string[] = [];
  const ordered = [...pages].sort((a, b) => (b.kind === "Contact" ? 1 : 0) - (a.kind === "Contact" ? 1 : 0));

  for (const p of ordered) {
    const window = p.kind === "Contact" ? p.text : p.text.slice(-3500);
    for (const m of window.match(PHONE_RE) ?? []) {
      const t = m.trim();
      if (looksLikePhone(t) && !phones.includes(t)) phones.push(t);
    }
    for (const m of window.match(EMAIL_RE) ?? []) {
      const e = m.toLowerCase();
      if (/\.(png|jpe?g|gif|webp|svg)$/i.test(e)) continue;
      if (/(sentry|wixpress|example\.com|yourdomain|domain\.com)/i.test(e)) continue;
      if (!emails.includes(e)) emails.push(e);
    }
    if (phones.length > 6 && emails.length > 4) break;
  }
  return { phones: phones.slice(0, 8), emails: emails.slice(0, 6) };
}

export function merge(structured: Extracted, text: { phones: string[]; emails: string[] }): Extracted {
  return {
    ...structured,
    phone: structured.phone ? normalisePhone(structured.phone) : text.phones[0],
    email: structured.email ?? text.emails[0],
  };
}
