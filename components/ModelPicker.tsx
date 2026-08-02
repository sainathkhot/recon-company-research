"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenRouterModel } from "@/lib/types";

export default function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: OpenRouterModel[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const current = models.find((m) => m.id === value);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return models
      .filter((m) => (freeOnly ? m.free : true))
      .filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle))
      .slice(0, 120);
  }, [models, q, freeOnly]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="btn-ghost max-w-[13rem] sm:max-w-[18rem]"
        title="Choose any model available on OpenRouter"
      >
        <span className="text-brass">Model</span>
        <span className="truncate normal-case tracking-normal text-ink">
          {current?.name ?? value.split("/").pop() ?? "Select"}
        </span>
        <span className="text-slate">{open ? "\u2303" : "\u2304"}</span>
      </button>

      {open && (
        <div className="filed absolute right-0 z-50 mt-1.5 w-[min(24rem,calc(100vw-2rem))] animate-rise">
          <div className="border-b border-rule p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search 300+ OpenRouter models"
              className="field text-[13px]"
            />
            <label className="mt-2 flex cursor-pointer select-none items-center gap-2 px-0.5">
              <input
                type="checkbox"
                checked={freeOnly}
                onChange={(e) => setFreeOnly(e.target.checked)}
                className="h-3 w-3 accent-[#7A2418]"
              />
              <span className="eyebrow">Free models only</span>
            </label>
          </div>

          <ul role="listbox" className="scroll-thin max-h-[19rem] overflow-y-auto">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-slate">No model matches that.</li>}
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={m.id === value}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                    setQ("");
                  }}
                  className={`flex w-full items-baseline justify-between gap-3 border-b border-rule/60 px-3 py-2 text-left hover:bg-paper ${
                    m.id === value ? "bg-paper" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{m.name}</span>
                    <span className="block truncate font-mono text-[10px] text-slate">{m.id}</span>
                  </span>
                  {m.free ? (
                    <span className="shrink-0 border border-brass px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-brass">
                      Free
                    </span>
                  ) : m.context ? (
                    <span className="shrink-0 font-mono text-[10px] text-slate">{Math.round(m.context / 1000)}k</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
