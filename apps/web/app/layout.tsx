import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono, Oxanium } from "next/font/google";
import "./globals.css";
import { AppShell } from "./components/AppShell";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const display = Oxanium({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "Midas — Systematic trading agents",
  description: "Systematic, not speculative. Build disciplined, data-driven trading agents and let them execute.",
};

// Without this, mobile browsers assume a ~980px desktop width and the responsive layout never triggers.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Set theme before paint to avoid a flash.
const themeScript = `(function(){try{var t=localStorage.getItem('midas-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
