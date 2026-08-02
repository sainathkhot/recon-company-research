import type { Config } from "tailwindcss";

/** Colours resolve through CSS variables so the whole palette can flip themes. */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        card: v("card"),
        ink: v("ink"),
        slate: v("slate"),
        rule: v("rule"),
        brass: v("brass"),
        stamp: v("stamp"),
        masthead: v("masthead"),
        mastheadfg: v("masthead-fg"),
        btnbg: v("btn-bg"),
        btnfg: v("btn-fg"),
      },
      fontFamily: {
        display: ["'Bodoni Moda'", "Georgia", "serif"],
        sans: ["Karla", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      borderRadius: { none: "0", sm: "2px", DEFAULT: "3px" },
      keyframes: {
        rise: { from: { opacity: "0", transform: "translateY(4px)" }, to: { opacity: "1", transform: "none" } },
        stamp: {
          "0%": { opacity: "0", transform: "scale(1.6) rotate(-14deg)" },
          "60%": { opacity: "1", transform: "scale(0.96) rotate(-7deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-8deg)" },
        },
        blink: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.15" } },
      },
      animation: {
        rise: "rise .28s ease-out both",
        stamp: "stamp .5s cubic-bezier(.2,.8,.3,1) both",
        blink: "blink 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
