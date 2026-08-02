"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ModelPicker from "./ModelPicker";
import ThemeToggle from "./ThemeToggle";
import Trail from "./Trail";
import Dossier from "./Dossier";
import { emptyConfig, loadConfig, loadModel, saveModel } from "@/lib/settings";
import type { CompanyReport, DiscordConfig, OpenRouterModel, ResearchEvent, TrailStep } from "@/lib/types";

type DiscordState = { status: "idle" | "sending" | "sent" | "error"; message?: string };

interface Turn {
  id: string;
  query: string;
  mode: "name" | "url";
  steps: TrailStep[];
  report?: CompanyReport;
  error?: { message: string; hint?: string };
  running: boolean;
  discord: DiscordState;
}

const EXAMPLES = ["Stripe", "https://zerodha.com", "Figma", "https://tatamotors.com"];

const isUrl = (s: string) => /^https?:\/\//i.test(s.trim()) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s.trim());

export default function Workbench() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [model, setModel] = useState("openai/gpt-oss-20b:free");
  const [config, setConfig] = useState<DiscordConfig>(emptyConfig);

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setConfig(loadConfig());
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setModel(loadModel(d.default ?? "openai/gpt-oss-20b:free"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const patch = useCallback((id: string, fn: (t: Turn) => Turn) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const sendToDiscord = useCallback(
    async (turnId: string, report: CompanyReport, cfg: DiscordConfig) => {
      patch(turnId, (t) => ({ ...t, discord: { status: "sending" } }));
      try {
        const res = await fetch("/api/discord", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "send",
            botToken: cfg.botToken,
            channelId: cfg.channelId,
            applicantName: cfg.applicantName,
            applicantEmail: cfg.applicantEmail,
            report,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Discord request failed.");
        patch(turnId, (t) => ({
          ...t,
          discord: { status: "sent", message: `Posted to Discord with the PDF attached (message ${data.messageId}).` },
        }));
      } catch (e: any) {
        patch(turnId, (t) => ({ ...t, discord: { status: "error", message: e?.message ?? "Discord request failed." } }));
      }
    },
    [patch]
  );

  async function run(raw: string) {
    const query = raw.trim();
    if (!query || busy) return;

    const id = `t${Date.now()}`;
    const cfg = loadConfig();
    setConfig(cfg);
    setTurns((p) => [
      ...p,
      { id, query, mode: isUrl(query) ? "url" : "name", steps: [], running: true, discord: { status: "idle" } },
    ]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          model,
          serperKey: cfg.serperKey,
          openrouterKey: cfg.openrouterKey,
        }),
      });
      if (!res.body) throw new Error("The server did not return a stream.");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished: CompanyReport | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let ev: ResearchEvent;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (ev.type === "step") {
            const s = ev.step;
            patch(id, (t) => {
              const i = t.steps.findIndex((x) => x.id === s.id);
              const steps = i === -1 ? [...t.steps, s] : t.steps.map((x, j) => (j === i ? s : x));
              return { ...t, steps };
            });
          } else if (ev.type === "report") {
            finished = ev.report;
            patch(id, (t) => ({ ...t, report: ev.report, running: false }));
          } else if (ev.type === "error") {
            patch(id, (t) => ({
              ...t,
              error: { message: ev.message, hint: ev.hint },
              running: false,
              steps: t.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" } : s)),
            }));
          }
        }
      }

      patch(id, (t) =>
        t.report || t.error
          ? { ...t, running: false }
          : {
              ...t,
              running: false,
              steps: t.steps.map((s) => (s.status === "running" ? { ...s, status: "failed" as const } : s)),
              error: {
                message: "The connection closed before the report arrived.",
                hint: "The server run was cut short, usually by a slow AI model. Pick a different model and try again.",
              },
            }
      );
      if (finished && cfg.autoSend && cfg.botToken && cfg.channelId) {
        void sendToDiscord(id, finished, cfg);
      }
    } catch (e: any) {
      patch(id, (t) => ({ ...t, running: false, error: { message: e?.message ?? "The research request failed." } }));
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  const empty = turns.length === 0;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/92 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link href="/" className="group flex items-baseline gap-2.5">
            <span className="display text-[22px] leading-none">Recon</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-slate sm:inline">
              Company research
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <ModelPicker models={models} value={model} onChange={(id) => { setModel(id); saveModel(id); }} disabled={busy} />
            <Link href="/settings" className="btn-ghost" aria-label="Settings">
              <span className="hidden sm:inline">Settings</span>
              <span className="sm:hidden">Set</span>
              {config.botToken && config.channelId && (
                <span className="h-1.5 w-1.5 rounded-full bg-brass" title="Discord configured" />
              )}
            </Link>
          </div>
        </div>
      </header>

      {/* ── Transcript ─────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4">
        {empty ? (
          <section className="py-14 sm:py-20">
            <p className="eyebrow">Open a file on any company</p>
            <h1 className="display mt-4 text-[38px] leading-[1.05] sm:text-[54px]">
              Name a company.
              <br />
              Get the whole file.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-ink/75">
              Recon finds the official site, crawls the pages that matter, sweeps public sources through Google, and has
              an AI model of your choosing write up what the company does, where it hurts, and who it is up against.
              Then it hands you a PDF.
            </p>

            <div className="mt-8 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" onClick={() => run(ex)} className="btn-ghost normal-case tracking-normal">
                  {ex}
                </button>
              ))}
            </div>

            <ol className="mt-12 grid gap-x-8 gap-y-4 border-t border-rule pt-6 sm:grid-cols-2">
              {[
                ["01", "Locate", "Resolves a name to the real corporate domain, not a directory listing."],
                ["02", "Crawl", "Best-first over About, Products, Services, Contact and Pricing. Duplicates dropped."],
                ["03", "Analyse", "Any OpenRouter model. Verified fields are extracted first so the model can't invent them."],
                ["04", "File", "A typeset PDF dossier, downloadable in one click and postable to Discord."],
              ].map(([n, title, body]) => (
                <li key={n} className="flex gap-3">
                  <span className="font-mono text-[10px] leading-5 text-brass">{n}</span>
                  <span>
                    <span className="block text-[14px] font-semibold">{title}</span>
                    <span className="block text-[13px] leading-snug text-slate">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <div className="space-y-8 py-6">
            {turns.map((t) => (
              <div key={t.id} className="space-y-4">
                {/* the request slip */}
                <div className="flex justify-end">
                  <div className="flex max-w-[85%] items-center gap-3 border border-ink bg-card px-3.5 py-2">
                    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-brass">
                      {t.mode}
                    </span>
                    <span className="min-w-0 break-words text-[14px]">{t.query}</span>
                  </div>
                </div>

                <Trail steps={t.steps} live={t.running} />

                {t.error && (
                  <div className="filed border-l-[3px] border-l-stamp p-4">
                    <p className="eyebrow text-stamp">Research stopped</p>
                    <p className="mt-2 text-[14px] leading-snug">{t.error.message}</p>
                    {t.error.hint && <p className="mt-2 text-[13px] text-slate">{t.error.hint}</p>}
                    <button type="button" onClick={() => run(t.query)} className="btn-ghost mt-3">
                      Try again
                    </button>
                  </div>
                )}

                {t.report && (
                  <Dossier
                    report={t.report}
                    config={config}
                    discordState={t.discord}
                    onSendDiscord={() => sendToDiscord(t.id, t.report!, loadConfig())}
                  />
                )}
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </main>

      {/* ── Composer ───────────────────────────────────────── */}
      <div className="sticky bottom-0 z-30 border-t border-rule bg-paper/92 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="filed flex items-end gap-2 p-2">
            <span className="shrink-0 self-center pl-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-brass">
              {input.trim() ? (isUrl(input) ? "URL" : "Name") : "\u203A"}
            </span>
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  run(input);
                }
              }}
              placeholder="Company name or website URL…"
              disabled={busy}
              aria-label="Company name or website URL"
              className="max-h-32 flex-1 resize-none bg-transparent py-2 text-[15px] outline-none placeholder:text-slate/60 disabled:opacity-60"
            />
            <button type="button" onClick={() => run(input)} disabled={busy || !input.trim()} className="btn-primary shrink-0">
              {busy ? "Researching…" : "Research"}
            </button>
          </div>
          <p className="mt-1.5 px-1 font-mono text-[10px] text-slate">
            Enter to research · Shift+Enter for a new line · a full run takes 25–50s
          </p>
        </div>
      </div>
    </div>
  );
}
