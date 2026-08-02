"use client";

import { useState } from "react";
import type { CompanyReport, DiscordConfig } from "@/lib/types";

function Field({ label, value, href }: { label: string; value?: string; href?: string }) {
  return (
    <div className="border-b border-rule py-2.5 sm:grid sm:grid-cols-[9.5rem_1fr] sm:gap-4">
      <dt className="eyebrow pb-1 sm:pb-0 sm:pt-[3px]">{label}</dt>
      <dd className="min-w-0 break-words text-[14px] leading-snug">
        {value ? (
          href ? (
            <a className="underline decoration-brass decoration-1 underline-offset-2 hover:text-brass" href={href} target="_blank" rel="noreferrer">
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="font-display font-normal italic text-slate">Not disclosed</span>
        )}
      </dd>
    </div>
  );
}

function Section({ n, title, note, children }: { n: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="px-5 pb-6 pt-7 sm:px-7">
      <div className="mb-3 flex items-baseline gap-3 border-b-[1.5px] border-ink pb-2">
        <span className="font-mono text-[11px] font-semibold text-brass">{n}</span>
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">{title}</h3>
      </div>
      {note && <p className="mb-3 font-display text-[13px] italic text-slate">{note}</p>}
      {children}
    </section>
  );
}

export default function Dossier({
  report,
  config,
  discordState,
  onSendDiscord,
}: {
  report: CompanyReport;
  config: DiscordConfig;
  discordState: { status: "idle" | "sending" | "sent" | "error"; message?: string };
  onSendDiscord: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState("");
  const [showSources, setShowSources] = useState(false);

  async function download() {
    setDownloading(true);
    setDlError("");
    try {
      const res = await fetch("/api/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ?? `recon-${report.docket}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e: any) {
      setDlError(e?.message?.slice(0, 160) || "The PDF could not be built.");
    } finally {
      setDownloading(false);
    }
  }

  const canDiscord = Boolean(config.botToken && config.channelId);

  return (
    <article className="filed relative animate-rise">
      <div className="perf h-2.5 border-b border-rule" />

      {/* Masthead */}
      <header className="relative overflow-hidden bg-masthead px-5 pb-6 pt-6 text-mastheadfg sm:px-7">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-brass">Company intelligence dossier</p>
        <h2 className="display mt-2 pr-24 text-[30px] leading-[1.05] sm:text-[38px]">{report.name}</h2>
        <a
          href={report.website}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block font-mono text-[11px] text-mastheadfg/65 underline decoration-brass underline-offset-4 hover:text-mastheadfg"
        >
          {report.website}
        </a>

        {/* Signature: the rubber stamp */}
        <div className="pointer-events-none absolute right-3 top-5 animate-stamp sm:right-6">
          <div className="rubber flex h-[74px] w-[74px] flex-col items-center justify-center rounded-full text-center sm:h-[86px] sm:w-[86px]">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] leading-tight">Filed</span>
            <span className="mt-0.5 block h-px w-8 bg-current opacity-60" />
            <span className="mt-1 font-mono text-[7.5px] leading-tight opacity-90">{report.docket.slice(3)}</span>
          </div>
        </div>

        <dl className="mt-5 flex flex-wrap gap-x-7 gap-y-2 border-t border-mastheadfg/15 pt-4">
          {[
            ["Industry", report.industry],
            ["Headquarters", report.headquarters || report.country],
            ["Founded", report.founded],
            ["Employees", report.employees],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k as string}>
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-mastheadfg/45">{k}</dt>
                <dd className="text-[13px] text-mastheadfg/95">{v}</dd>
              </div>
            ))}
        </dl>
      </header>

      {/* 01 Identification */}
      <Section n="01" title="Identification">
        <dl>
          <Field label="Company name" value={report.legalName && report.legalName !== report.name ? `${report.name} (${report.legalName})` : report.name} />
          <Field label="Website" value={report.website} href={report.website} />
          <Field label="Phone number" value={report.phone} href={report.phone ? `tel:${report.phone.replace(/[^\d+]/g, "")}` : undefined} />
          <Field label="Email" value={report.email} href={report.email ? `mailto:${report.email}` : undefined} />
          <Field label="Address" value={report.address} />
        </dl>
      </Section>

      {/* 02 Summary */}
      <Section n="02" title="Company summary">
        <div className="prose-dossier">
          {(report.summary || "No summary could be generated from the available sources.")
            .split(/\n{2,}/)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>
      </Section>

      {/* 03 Products */}
      <Section n="03" title="Products & services">
        {report.products.length === 0 ? (
          <p className="font-display font-normal italic text-slate">None identified in the crawled pages.</p>
        ) : (
          <ol className="grid gap-x-6 sm:grid-cols-2">
            {report.products.map((p, i) => (
              <li key={i} className="flex gap-3 border-b border-rule py-2.5">
                <span className="font-mono text-[10px] leading-6 text-brass">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[14px] leading-snug">{p}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* 04 Pain points */}
      <Section n="04" title="AI-generated pain points" note="Inferred operating challenges. Analytical, not asserted as fact.">
        <ul className="space-y-4">
          {report.painPoints.map((p, i) => (
            <li key={i} className="border-l-[2.5px] border-stamp pl-4">
              <h4 className="text-[15px] font-semibold text-stamp">{p.title}</h4>
              {p.detail && <p className="mt-1 text-[14px] leading-[1.6] text-ink/80">{p.detail}</p>}
            </li>
          ))}
          {report.painPoints.length === 0 && <li className="font-display font-normal italic text-slate">None identified.</li>}
        </ul>
      </Section>

      {/* 05 Competitors */}
      <Section n="05" title="Competitive set">
        <ul>
          {report.competitors.map((c, i) => (
            <li key={i} className="border-b border-rule py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="flex items-baseline gap-3">
                  <span className="font-mono text-[10px] text-brass">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[15px] font-semibold">{c.name}</span>
                </span>
                {c.website ? (
                  <a
                    href={c.website}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-brass underline decoration-brass/40 underline-offset-2 hover:decoration-brass"
                  >
                    {c.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : (
                  <span className="font-mono text-[11px] text-slate">website not confirmed</span>
                )}
              </div>
              {c.reason && <p className="mt-1 pl-[1.6rem] text-[13px] leading-snug text-slate">{c.reason}</p>}
            </li>
          ))}
          {report.competitors.length === 0 && <li className="font-display font-normal italic text-slate">None identified.</li>}
        </ul>
      </Section>

      {/* 06 Evidence */}
      <Section n="06" title="Evidence trail">
        <p className="font-mono text-[11px] text-slate">
          {report.stats.pagesCrawled} pages crawled · {report.stats.searchQueries} search queries ·{" "}
          {(report.stats.elapsedMs / 1000).toFixed(1)}s · {report.model}
        </p>
        <button type="button" onClick={() => setShowSources((s) => !s)} className="btn-ghost mt-3">
          {showSources ? "Hide sources" : `Show ${report.sources.length} sources`}
        </button>
        {showSources && (
          <ul className="mt-3 space-y-1.5">
            {report.sources.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={`shrink-0 font-mono text-[9px] uppercase tracking-widest ${
                    s.via === "crawl" ? "text-brass" : "text-slate"
                  }`}
                >
                  {s.via}
                </span>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-[12.5px] hover:text-brass"
                  title={s.url}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Actions */}
      <footer className="flex flex-wrap items-center gap-2.5 border-t-[1.5px] border-ink bg-paper/60 px-5 py-4 sm:px-7">
        <button type="button" onClick={download} disabled={downloading} className="btn-primary">
          {downloading ? "Building PDF…" : "Download PDF report"}
        </button>

        <button
          type="button"
          onClick={onSendDiscord}
          disabled={!canDiscord || discordState.status === "sending"}
          className="btn-ghost"
          title={canDiscord ? "Post this dossier to your Discord channel" : "Add a bot token and channel ID in Settings first"}
        >
          {discordState.status === "sending"
            ? "Sending…"
            : discordState.status === "sent"
            ? "Sent to Discord ✓"
            : "Send to Discord"}
        </button>

        <span className="ml-auto font-mono text-[10px] text-slate">
          Docket {report.docket} · {report.generatedAt} IST
        </span>

        {(dlError || (discordState.status === "error" && discordState.message)) && (
          <p className="w-full border-l-2 border-stamp pl-3 text-[12.5px] text-stamp">
            {dlError || discordState.message}
          </p>
        )}
        {discordState.status === "sent" && discordState.message && (
          <p className="w-full border-l-2 border-brass pl-3 text-[12.5px] text-slate">{discordState.message}</p>
        )}
        {!canDiscord && (
          <p className="w-full text-[12px] text-slate">
            Discord delivery is off. Add a bot token and channel ID in{" "}
            <a href="/settings" className="underline decoration-brass underline-offset-2">
              Settings
            </a>
            .
          </p>
        )}
      </footer>
    </article>
  );
}
