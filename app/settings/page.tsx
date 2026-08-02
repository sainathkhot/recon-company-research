"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import { emptyConfig, loadConfig, saveConfig } from "@/lib/settings";
import type { DiscordConfig } from "@/lib/types";

export default function SettingsPage() {
  const [cfg, setCfg] = useState<DiscordConfig>(emptyConfig);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ status: "idle" | "testing" | "ok" | "error"; message?: string }>({
    status: "idle",
  });
  const [reveal, setReveal] = useState(false);
  const [revealKeys, setRevealKeys] = useState(false);

  useEffect(() => setCfg(loadConfig()), []);

  const set = <K extends keyof DiscordConfig>(k: K, v: DiscordConfig[K]) => {
    setCfg((c) => ({ ...c, [k]: v }));
    setSaved(false);
    setTest({ status: "idle" });
  };

  function save() {
    saveConfig(cfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2600);
  }

  async function runTest() {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", botToken: cfg.botToken, channelId: cfg.channelId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Connection failed.");
      setTest({ status: "ok", message: `Connected to ${data.channelName}. The bot can see this channel.` });
    } catch (e: any) {
      setTest({ status: "error", message: e?.message ?? "Connection failed." });
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/92 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link href="/" className="display text-[22px] leading-none">
            Recon
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate">Settings</span>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Link href="/" className="btn-ghost">
              Back to research
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <p className="eyebrow">Configuration</p>
        <h1 className="display mt-3 text-[34px] leading-tight sm:text-[44px]">
          Keys and delivery
        </h1>
        <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink/75">
          Everything on this page is stored in this browser only. Nothing is written to a server, and nothing leaves
          the page until you file a report or run a connection test.
        </p>

        {/* API keys */}
        <section className="filed mt-8">
          <div className="perf h-2 border-b border-rule" />
          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <p className="eyebrow">API keys</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate">
                This deployment already has working keys, so you can leave both blank and just start researching. Fill
                them in to run on your own quota instead — a key entered here overrides the server&apos;s for your
                browser only.
              </p>
            </div>

            <div>
              <label htmlFor="or" className="eyebrow">
                OpenRouter API key
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="or"
                  type={revealKeys ? "text" : "password"}
                  value={cfg.openrouterKey}
                  onChange={(e) => set("openrouterKey", e.target.value)}
                  placeholder="sk-or-v1-…  (optional)"
                  autoComplete="off"
                  spellCheck={false}
                  className="field font-mono text-[13px]"
                />
                <button type="button" onClick={() => setRevealKeys((r) => !r)} className="btn-ghost shrink-0">
                  {revealKeys ? "Hide" : "Show"}
                </button>
              </div>
              <p className="mt-1.5 text-[12px] text-slate">openrouter.ai/keys · used for the AI analysis step.</p>
            </div>

            <div>
              <label htmlFor="sp" className="eyebrow">
                Serper.dev API key
              </label>
              <input
                id="sp"
                type={revealKeys ? "text" : "password"}
                value={cfg.serperKey}
                onChange={(e) => set("serperKey", e.target.value)}
                placeholder="Optional — leave blank to use this deployment&apos;s key"
                autoComplete="off"
                spellCheck={false}
                className="field mt-1.5 font-mono text-[13px]"
              />
              <p className="mt-1.5 text-[12px] text-slate">
                serper.dev → Dashboard → API Key · used for search, website resolution and competitor verification.
              </p>
            </div>

            <div className="hairline pt-5">
              <button type="button" onClick={save} className="btn-primary">
                {saved ? "Configuration saved ✓" : "Save configuration"}
              </button>
            </div>
          </div>
        </section>

        <h2 className="mt-12 font-display text-[26px] leading-tight tracking-tight sm:text-[32px]">Discord delivery</h2>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink/75">
          When a dossier is filed, Recon can post it straight to a Discord channel with the applicant details and the
          PDF attached.
        </p>

        {/* Discord credentials */}
        <section className="filed mt-6">
          <div className="perf h-2 border-b border-rule" />
          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <label htmlFor="token" className="eyebrow">
                Discord bot token
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="token"
                  type={reveal ? "text" : "password"}
                  value={cfg.botToken}
                  onChange={(e) => set("botToken", e.target.value)}
                  placeholder="MTIzNDU2Nzg5…"
                  autoComplete="off"
                  spellCheck={false}
                  className="field font-mono text-[13px]"
                />
                <button type="button" onClick={() => setReveal((r) => !r)} className="btn-ghost shrink-0">
                  {reveal ? "Hide" : "Show"}
                </button>
              </div>
              <p className="mt-1.5 text-[12px] text-slate">
                Discord Developer Portal → your application → Bot → Reset Token.
              </p>
            </div>

            <div>
              <label htmlFor="channel" className="eyebrow">
                Discord channel ID
              </label>
              <input
                id="channel"
                value={cfg.channelId}
                onChange={(e) => set("channelId", e.target.value.replace(/\D/g, ""))}
                placeholder="1234567890123456789"
                inputMode="numeric"
                className="field mt-1.5 font-mono text-[13px]"
              />
              <p className="mt-1.5 text-[12px] text-slate">
                Turn on Developer Mode in Discord, then right-click the channel → Copy Channel ID.
              </p>
            </div>

            <div className="hairline pt-5">
              <p className="eyebrow">Applicant details</p>
              <p className="mt-1.5 text-[12.5px] text-slate">Included in every Discord message alongside the report.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="an" className="eyebrow">
                    Applicant name
                  </label>
                  <input
                    id="an"
                    value={cfg.applicantName}
                    onChange={(e) => set("applicantName", e.target.value)}
                    placeholder="Your full name"
                    className="field mt-1.5"
                  />
                </div>
                <div>
                  <label htmlFor="ae" className="eyebrow">
                    Applicant email
                  </label>
                  <input
                    id="ae"
                    type="email"
                    value={cfg.applicantEmail}
                    onChange={(e) => set("applicantEmail", e.target.value)}
                    placeholder="you@example.com"
                    className="field mt-1.5"
                  />
                </div>
              </div>
            </div>

            <label className="hairline flex cursor-pointer items-start gap-3 pt-5">
              <input
                type="checkbox"
                checked={cfg.autoSend}
                onChange={(e) => set("autoSend", e.target.checked)}
                className="mt-1 h-3.5 w-3.5 accent-[#7A2418]"
              />
              <span>
                <span className="block text-[14px] font-semibold">Post automatically after every report</span>
                <span className="block text-[12.5px] text-slate">
                  Leave this off to send manually with the button on each dossier.
                </span>
              </span>
            </label>

            <div className="hairline flex flex-wrap items-center gap-2.5 pt-5">
              <button type="button" onClick={save} className="btn-primary">
                {saved ? "Configuration saved ✓" : "Save configuration"}
              </button>
              <button
                type="button"
                onClick={runTest}
                disabled={!cfg.botToken || !cfg.channelId || test.status === "testing"}
                className="btn-ghost"
              >
                {test.status === "testing" ? "Testing…" : "Test connection"}
              </button>
            </div>

            {test.status === "ok" && (
              <p className="border-l-2 border-brass pl-3 text-[13px] text-ink/80">{test.message}</p>
            )}
            {test.status === "error" && (
              <p className="border-l-2 border-stamp pl-3 text-[13px] text-stamp">{test.message}</p>
            )}
          </div>
        </section>

        {/* Setup guidance */}
        <section className="mt-8">
          <p className="eyebrow">Bot permissions</p>
          <ol className="mt-3 space-y-2.5 border-t border-rule pt-4">
            {[
              ["01", "Create an application and a bot at discord.com/developers/applications."],
              ["02", "Under OAuth2 → URL Generator, tick bot, then View Channels, Send Messages and Attach Files."],
              ["03", "Open the generated URL and add the bot to your server."],
              ["04", "Paste the token and channel ID above, save, and run the connection test."],
            ].map(([n, text]) => (
              <li key={n} className="flex gap-3">
                <span className="font-mono text-[10px] leading-5 text-brass">{n}</span>
                <span className="text-[13.5px] leading-snug text-ink/80">{text}</span>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-10 border-t border-rule pt-4 text-[12px] leading-relaxed text-slate">
          The server falls back to the DISCORD_BOT_TOKEN and DISCORD_CHANNEL_ID environment variables when these fields
          are blank, so a deployment can ship pre-configured.
        </p>
      </main>
    </div>
  );
}
