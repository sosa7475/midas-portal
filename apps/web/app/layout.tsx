import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "./components/TopNav";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Midas — Build your trading agents",
  description:
    "Create AI trading agents, give them your strategy, connect trading MCPs (technical analysis, DeFiLlama, on-chain, Orderly), and let them work.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <TopNav />
        {children}
      </body>
    </html>
  );
}
