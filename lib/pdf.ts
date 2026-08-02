import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, RGB } from "pdf-lib";
import type { CompanyReport } from "./types";

const A4 = { w: 595.28, h: 841.89 };
const M = { left: 54, right: 54, top: 54, bottom: 62 };

const INK = rgb(0.078, 0.125, 0.11);
const SLATE = rgb(0.369, 0.42, 0.388);
const RULE = rgb(0.788, 0.812, 0.761);
const BRASS = rgb(0.604, 0.459, 0.149);
const STAMP = rgb(0.478, 0.141, 0.094);
const CARD = rgb(0.984, 0.98, 0.961);
const WHITE = rgb(1, 1, 1);

/** pdf-lib standard fonts are WinAnsi — fold typographic characters down to Latin-1. */
function san(input: string): string {
  return String(input ?? "")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2022\u25CF\u25AA]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u2192\u21D2]/g, "->")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

interface Fonts {
  display: PDFFont;
  displayItalic: PDFFont;
  body: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

class Dossier {
  doc!: PDFDocument;
  f!: Fonts;
  page!: PDFPage;
  y = 0;
  section = 0;

  get contentWidth() {
    return A4.w - M.left - M.right;
  }

  async init() {
    this.doc = await PDFDocument.create();
    this.f = {
      display: await this.doc.embedFont(StandardFonts.TimesRomanBold),
      displayItalic: await this.doc.embedFont(StandardFonts.TimesRomanItalic),
      body: await this.doc.embedFont(StandardFonts.Helvetica),
      bold: await this.doc.embedFont(StandardFonts.HelveticaBold),
      mono: await this.doc.embedFont(StandardFonts.Courier),
      monoBold: await this.doc.embedFont(StandardFonts.CourierBold),
    };
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage([A4.w, A4.h]);
    this.page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: CARD });
    this.y = A4.h - M.top;
  }

  need(h: number) {
    if (this.y - h < M.bottom) this.newPage();
  }

  wrap(text: string, font: PDFFont, size: number, width = this.contentWidth): string[] {
    const lines: string[] = [];
    for (const para of san(text).split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        let w = word;
        // Hard-break tokens that can never fit (long URLs).
        while (font.widthOfTextAtSize(w, size) > width) {
          let cut = w.length;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          if (line) lines.push(line), (line = "");
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const probe = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(probe, size) > width) {
          if (line) lines.push(line);
          line = w;
        } else line = probe;
      }
      lines.push(line);
    }
    return lines.length ? lines : [""];
  }

  text(
    content: string,
    o: { font?: PDFFont; size?: number; color?: RGB; lead?: number; x?: number; width?: number; gapAfter?: number } = {}
  ) {
    const font = o.font ?? this.f.body;
    const size = o.size ?? 10.5;
    const lead = o.lead ?? size * 1.5;
    const x = o.x ?? M.left;
    const width = o.width ?? this.contentWidth - (x - M.left);
    for (const line of this.wrap(content, font, size, width)) {
      this.need(lead);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= lead;
    }
    this.y -= o.gapAfter ?? 0;
  }

  rule(color = RULE, thickness = 0.75) {
    this.need(8);
    this.page.drawLine({
      start: { x: M.left, y: this.y },
      end: { x: A4.w - M.right, y: this.y },
      thickness,
      color,
    });
    this.y -= 10;
  }

  /** Numbered section header — the numbers encode filing order, as in the app. */
  heading(label: string) {
    this.section++;
    this.need(56);
    this.y -= 12;
    const n = String(this.section).padStart(2, "0");
    this.page.drawText(n, { x: M.left, y: this.y - 9, size: 9, font: this.f.monoBold, color: BRASS });
    this.page.drawText(san(label).toUpperCase(), {
      x: M.left + 26,
      y: this.y - 9,
      size: 9,
      font: this.f.monoBold,
      color: INK,
    });
    this.y -= 16;
    this.page.drawLine({
      start: { x: M.left, y: this.y },
      end: { x: A4.w - M.right, y: this.y },
      thickness: 1.1,
      color: INK,
    });
    this.y -= 16;
  }

  /** Two-column key/value row used by the identification block. */
  kv(key: string, value: string) {
    const keyW = 132;
    const lines = this.wrap(value || "Not disclosed", this.f.body, 10.5, this.contentWidth - keyW);
    this.need(lines.length * 15 + 6);
    this.page.drawText(san(key).toUpperCase(), {
      x: M.left,
      y: this.y - 8,
      size: 7.5,
      font: this.f.mono,
      color: SLATE,
    });
    lines.forEach((line, i) => {
      this.page.drawText(line, {
        x: M.left + keyW,
        y: this.y - 9 - i * 15,
        size: 10.5,
        font: value ? this.f.body : this.f.displayItalic,
        color: value ? INK : SLATE,
      });
    });
    this.y -= lines.length * 15 + 5;
    this.page.drawLine({
      start: { x: M.left, y: this.y + 3 },
      end: { x: A4.w - M.right, y: this.y + 3 },
      thickness: 0.5,
      color: RULE,
    });
    this.y -= 5;
  }
}

export async function buildPdf(r: CompanyReport): Promise<Uint8Array> {
  const d = new Dossier();
  await d.init();

  /* ── Masthead ─────────────────────────────────────────────── */
  const HEAD = 176;
  d.page.drawRectangle({ x: 0, y: A4.h - HEAD, width: A4.w, height: HEAD, color: INK });
  d.page.drawRectangle({ x: 0, y: A4.h - HEAD, width: A4.w, height: 3, color: BRASS });

  d.page.drawText("COMPANY INTELLIGENCE DOSSIER", {
    x: M.left,
    y: A4.h - 52,
    size: 8,
    font: d.f.monoBold,
    color: BRASS,
  });

  const nameLines = d.wrap(r.name || "Unknown company", d.f.display, 30, d.contentWidth).slice(0, 2);
  nameLines.forEach((line, i) => {
    d.page.drawText(line, { x: M.left, y: A4.h - 88 - i * 33, size: 30, font: d.f.display, color: WHITE });
  });

  const afterName = A4.h - 88 - nameLines.length * 33;
  d.page.drawText(san(r.website), { x: M.left, y: afterName - 2, size: 10, font: d.f.mono, color: rgb(0.72, 0.76, 0.72) });

  const meta = [`DOCKET ${r.docket}`, san(r.generatedAt), `MODEL ${san(r.model)}`];
  meta.forEach((m, i) => {
    const w = d.f.mono.widthOfTextAtSize(m, 7.5);
    d.page.drawText(m, { x: A4.w - M.right - w, y: A4.h - 44 - i * 12, size: 7.5, font: d.f.mono, color: rgb(0.62, 0.66, 0.62) });
  });

  d.y = A4.h - HEAD - 26;

  /* ── 01 Identification ────────────────────────────────────── */
  d.heading("Identification");
  d.kv("Company name", r.name);
  if (r.legalName && r.legalName !== r.name) d.kv("Legal entity", r.legalName);
  d.kv("Website", r.website);
  d.kv("Phone number", r.phone || "");
  d.kv("Email", r.email || "");
  d.kv("Address", r.address || "");
  if (r.industry) d.kv("Industry", r.industry);
  if (r.headquarters) d.kv("Headquarters", r.headquarters);
  if (r.founded) d.kv("Founded", r.founded);
  if (r.employees) d.kv("Employees", r.employees);

  /* ── 02 Summary ───────────────────────────────────────────── */
  d.heading("Company summary");
  d.text(r.summary || "No summary could be generated from the available sources.", {
    size: 11,
    lead: 16.5,
    gapAfter: 6,
  });

  /* ── 03 Products & services ───────────────────────────────── */
  d.heading("Products & services");
  if (!r.products.length) d.text("None identified.", { color: SLATE, font: d.f.displayItalic });
  r.products.forEach((p, i) => {
    const n = String(i + 1).padStart(2, "0");
    d.need(20);
    const startY = d.y;
    d.text(p, { x: M.left + 26, size: 10.5, lead: 15 });
    d.page.drawText(n, { x: M.left, y: startY - 10, size: 8.5, font: d.f.mono, color: BRASS });
    d.y -= 5;
  });

  /* ── 04 Pain points ───────────────────────────────────────── */
  d.heading("AI-generated pain points");
  d.text("Inferred operating challenges. Analytical, not asserted as fact.", {
    size: 9,
    color: SLATE,
    font: d.f.displayItalic,
    gapAfter: 8,
  });
  if (!r.painPoints.length) d.text("None identified.", { color: SLATE, font: d.f.displayItalic });
  r.painPoints.forEach((p) => {
    const titleLines = d.wrap(p.title, d.f.bold, 11, d.contentWidth - 16).length;
    const detailLines = p.detail ? d.wrap(p.detail, d.f.body, 10, d.contentWidth - 16).length : 0;
    const blockH = titleLines * 15 + detailLines * 14.5;
    d.need(blockH + 18);
    const top = d.y;
    d.page.drawRectangle({ x: M.left, y: top - blockH, width: 2.5, height: blockH, color: STAMP });
    d.text(p.title, { x: M.left + 16, size: 11, font: d.f.bold, color: STAMP, lead: 15 });
    if (p.detail) d.text(p.detail, { x: M.left + 16, size: 10, lead: 14.5 });
    d.y -= 12;
  });

  /* ── 05 Competitive set ───────────────────────────────────── */
  d.heading("Competitive set");
  if (!r.competitors.length) d.text("None identified.", { color: SLATE, font: d.f.displayItalic });
  r.competitors.forEach((c, i) => {
    const reasonLines = c.reason ? d.wrap(c.reason, d.f.body, 9, d.contentWidth - 30).length : 0;
    d.need(reasonLines * 13 + 34);
    d.page.drawText(String(i + 1).padStart(2, "0"), {
      x: M.left,
      y: d.y - 10,
      size: 8.5,
      font: d.f.mono,
      color: BRASS,
    });
    d.page.drawText(san(c.name), { x: M.left + 26, y: d.y - 10, size: 11.5, font: d.f.bold, color: INK });
    const site = san(c.website || "Website not confirmed");
    const w = d.f.mono.widthOfTextAtSize(site, 8.5);
    d.page.drawText(site, {
      x: Math.max(M.left + 200, A4.w - M.right - w),
      y: d.y - 10,
      size: 8.5,
      font: d.f.mono,
      color: c.website ? BRASS : SLATE,
    });
    d.y -= 18;
    if (c.reason) d.text(c.reason, { x: M.left + 26, size: 9, lead: 13, color: SLATE });
    d.y -= 4;
    d.page.drawLine({ start: { x: M.left, y: d.y + 4 }, end: { x: A4.w - M.right, y: d.y + 4 }, thickness: 0.5, color: RULE });
    d.y -= 8;
  });

  /* ── 06 Sources ───────────────────────────────────────────── */
  d.heading("Evidence trail");
  d.text(
    `${r.stats.pagesCrawled} pages crawled - ${r.stats.searchQueries} search queries - completed in ${(
      r.stats.elapsedMs / 1000
    ).toFixed(1)}s`,
    { size: 9, color: SLATE, font: d.f.mono, gapAfter: 8 }
  );
  r.sources.slice(0, 26).forEach((s) => {
    d.need(22);
    d.page.drawText(s.via === "crawl" ? "CRAWL" : "SEARCH", {
      x: M.left,
      y: d.y - 8,
      size: 7,
      font: d.f.mono,
      color: s.via === "crawl" ? BRASS : SLATE,
    });
    d.text(s.label, { x: M.left + 46, size: 9, lead: 12, font: d.f.bold });
    d.text(s.url, { x: M.left + 46, size: 8, lead: 11, color: SLATE, font: d.f.mono });
    d.y -= 4;
  });

  /* ── Footers ──────────────────────────────────────────────── */
  const pages = d.doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({
      start: { x: M.left, y: M.bottom - 16 },
      end: { x: A4.w - M.right, y: M.bottom - 16 },
      thickness: 0.5,
      color: RULE,
    });
    p.drawText(`RECON  /  ${san(r.name).toUpperCase().slice(0, 46)}`, {
      x: M.left,
      y: M.bottom - 30,
      size: 7,
      font: d.f.mono,
      color: SLATE,
    });
    const label = `${String(i + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}`;
    const w = d.f.monoBold.widthOfTextAtSize(label, 7);
    p.drawText(label, { x: A4.w - M.right - w, y: M.bottom - 30, size: 7, font: d.f.monoBold, color: INK });
  });

  // Disclosure note, bottom of the last page.
  const last = pages[pages.length - 1];
  last.drawText(
    "Compiled automatically from public web sources. Verify independently before commercial use.",
    { x: M.left, y: M.bottom - 42, size: 6.5, font: d.f.body, color: SLATE }
  );

  return d.doc.save();
}

export function pdfFilename(r: CompanyReport): string {
  const slug =
    san(r.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "company";
  return `recon-${slug}-${r.docket}.pdf`;
}
