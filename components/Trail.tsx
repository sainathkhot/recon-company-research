"use client";

import type { TrailStep } from "@/lib/types";

const MARK: Record<TrailStep["status"], string> = {
  running: "\u25CB",
  done: "\u2713",
  skipped: "\u2013",
  failed: "\u2717",
};

export default function Trail({ steps, live }: { steps: TrailStep[]; live: boolean }) {
  if (!steps.length) return null;

  return (
    <section
      aria-label="Research progress"
      aria-live="polite"
      className="filed"
    >
      <div className="perf h-2 border-b border-rule" />
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <span className="eyebrow">Research trail</span>
        <span className="eyebrow">
          {live ? (
            <span className="text-stamp">
              <span className="animate-blink">{"\u25CF"}</span> Working
            </span>
          ) : (
            `${steps.filter((s) => s.status === "done").length} steps`
          )}
        </span>
      </div>

      <ol className="px-4 pb-4 pt-2">
        {steps.map((s) => (
          <li key={s.id} className="animate-rise flex gap-3 py-[3px]">
            <span
              className={`mt-[1px] w-3 shrink-0 text-center font-mono text-[11px] ${
                s.status === "running" ? "animate-blink text-stamp" : s.status === "done" ? "text-brass" : "text-slate"
              }`}
              aria-hidden
            >
              {MARK[s.status]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] leading-snug text-ink">{s.label}</span>
              {s.detail && (
                <span className="block truncate font-mono text-[10.5px] leading-snug text-slate">{s.detail}</span>
              )}
            </span>
            {typeof s.ms === "number" && s.ms > 0 && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate/70">
                {(s.ms / 1000).toFixed(1)}s
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
