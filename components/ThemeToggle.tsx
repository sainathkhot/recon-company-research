"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "recon.theme.v1";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as Theme) || "light";
    setTheme(current);
    setReady(true);
  }, []);

  function flip() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode — the toggle still works for this session */
    }
  }

  return (
    <button
      type="button"
      onClick={flip}
      className="btn-ghost"
      aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      title={theme === "dark" ? "Ledger (light)" : "Nightshift (dark)"}
    >
      {/* Hidden until mounted so the label can never contradict the rendered theme. */}
      <span className={ready ? "" : "opacity-0"}>{theme === "dark" ? "Ledger" : "Nightshift"}</span>
    </button>
  );
}
