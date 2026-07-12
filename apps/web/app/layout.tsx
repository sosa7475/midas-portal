import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Midas Portal — Agentic Crypto Trading",
  description:
    "An AI trading agent that analyzes the market, enforces your strategy, and executes with discipline. You stay in control — every trade needs your confirmation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
