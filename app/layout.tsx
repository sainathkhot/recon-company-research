import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recon — Company Research Assistant",
  description:
    "Give it a company name or a URL. It crawls the site, sweeps public sources, files a dossier, and hands you a PDF.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%2314201C'/%3E%3Ctext x='16' y='23' font-family='Georgia,serif' font-size='19' fill='%23E8EBE3' text-anchor='middle'%3ER%3C/text%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E8EBE3" },
    { media: "(prefers-color-scheme: dark)", color: "#0E110F" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Runs before first paint so the saved theme is applied without a flash of the
 * wrong palette. Falls back to the operating system preference.
 */
const themeBootstrap = `
(function(){
  try {
    var saved = localStorage.getItem("recon.theme.v1");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", saved || (prefersDark ? "dark" : "light"));
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "light");
  }
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..800;1,6..96,400..600&family=Karla:ital,wght@0,300..700;1,400..600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
