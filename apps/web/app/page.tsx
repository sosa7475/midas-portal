"use client";

import Link from "next/link";
import { Icon } from "./components/Icon";
import { BrandMark } from "./components/BrandMark";

const STEPS = [
  { n: "01", t: "Create your agent", d: "Name it and write its trading thesis in plain language — its strategy, risk rules, and edge become its own agent brief.", i: "cpu" },
  { n: "02", t: "Connect live data", d: "Wire in technical analysis, on-chain flow, DeFi metrics, and NFT markets. Your agent reads the same signals a desk would.", i: "plug" },
  { n: "03", t: "Backtest its own edge", d: "The agent stress-tests its strategy over years of history — Sharpe, drawdown, win rate, CAGR — before a dollar is risked.", i: "chart" },
  { n: "04", t: "Deploy & let it trade", d: "It executes perps from its own segregated, trade-only account, sized by a risk engine. You approve; it acts.", i: "bolt" },
];

const COVERAGE = [
  { t: "Perpetuals", d: "200+ markets on Hyperliquid — majors to memecoins, with funding and open interest.", i: "bolt", gold: true },
  { t: "On-chain flow", d: "Token price, metadata, holders, and real-time buy/sell/net volume across thousands of tokens.", i: "layers" },
  { t: "DeFi metrics", d: "TVL, yields, and chain-level flows to ground every thesis in real liquidity.", i: "link" },
  { t: "Technicals", d: "RSI, EMA, MACD, ATR and more — live indicators on any listed market.", i: "chart" },
  { t: "NFT markets", d: "Floor prices, collection stats, and trending activity when culture moves price.", i: "nft" },
  { t: "Conversational", d: "An agentic terminal that shows its reasoning, tool calls, and every number it cites.", i: "terminal" },
];

const TRUST = [
  { t: "Segregated accounts", d: "Every agent trades from its own isolated account — separate funds, keys, and risk." },
  { t: "Trade-only keys", d: "Agent keys can place orders but never withdraw. Your capital stays under your control." },
  { t: "Encrypted at rest", d: "Keys sealed with AES-256-GCM. Fail-closed — no weak-key fallback, ever." },
  { t: "Risk engine", d: "Leverage, notional, and per-trade caps enforced on every order before it fires." },
];

export default function Landing() {
  return (
    <main style={{ paddingBottom: 100 }}>
      {/* Hero */}
      <section className="container" style={{ paddingTop: 72, textAlign: "center" }}>
        <div style={{ maxWidth: 880, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}><BrandMark height={88} /></div>
          <span className="badge badge-gold eyebrow" style={{ marginBottom: 26, height: 30, padding: "0 16px", borderRadius: 999 }}>Agentic trading for digital assets</span>
          <h1 className="display" style={{ fontSize: "clamp(34px, 9vw, 72px)", lineHeight: 1.03, letterSpacing: "-0.01em", marginBottom: 22 }}>
            <span style={{ color: "var(--text)" }}>Stop Reacting.</span><br />
            <span style={{ color: "var(--brand)" }}>Start Compounding.</span>
          </h1>
          <p className="text-2" style={{ fontSize: 19, lineHeight: 1.55, maxWidth: 640, margin: "0 auto 20px" }}>
            Midas agents trade digital assets autonomously. You define the strategy and connect the data —
            they execute with discipline across 200+ perp markets and thousands of on-chain tokens. No charts to babysit, no emotion.
          </p>
          <p className="eyebrow" style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 34, letterSpacing: "0.14em" }}>
            Systematic. Not speculative.
          </p>
          <div style={{ display: "flex", gap: 18, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/login" className="btn btn-solid" style={{ height: 50, padding: "0 34px", fontSize: 15, borderRadius: 14, letterSpacing: "0.04em" }}>Request Access</Link>
            <Link href="#how" className="btn btn-ghost eyebrow" style={{ height: 50, fontSize: 13, letterSpacing: "0.14em" }}>How it works ↓</Link>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 40 }}>
            For accredited investors only · Minimum investment applies · Past performance does not guarantee future results
          </p>
        </div>
      </section>

      <div className="container"><hr className="gold-rule" style={{ maxWidth: 220, margin: "60px auto 0" }} /></div>

      {/* How it works */}
      <section id="how" className="container" style={{ paddingTop: 64 }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <span className="eyebrow text-gold" style={{ display: "block", marginBottom: 12 }}>Build a fleet of trading agents</span>
          <h2 className="display" style={{ fontSize: "clamp(24px, 6vw, 34px)", letterSpacing: "-0.01em" }}>From thesis to live execution</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
          {STEPS.map((s) => (
            <div key={s.n} className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span className="display gold-grad" style={{ fontSize: 26, fontWeight: 800 }}>{s.n}</span>
                <span style={{ width: 40, height: 40, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--brand-soft)", color: "var(--brand)", border: "1px solid var(--brand-ring)" }}><Icon name={s.i} size={20} /></span>
              </div>
              <div className="display" style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{s.t}</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Coverage */}
      <section className="container" style={{ paddingTop: 72 }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <span className="eyebrow text-gold" style={{ display: "block", marginBottom: 12 }}>Every corner of the market</span>
          <h2 className="display" style={{ fontSize: "clamp(24px, 6vw, 34px)", letterSpacing: "-0.01em" }}>One agent, the whole asset universe</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {COVERAGE.map((c) => (
            <div key={c.t} className="card-flat">
              <div style={{ width: 40, height: 40, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: c.gold ? "var(--gold-soft)" : "var(--brand-soft)", color: c.gold ? "var(--gold)" : "var(--brand)", border: `1px solid ${c.gold ? "var(--gold-ring)" : "var(--brand-ring)"}`, marginBottom: 12 }}><Icon name={c.i} size={20} /></div>
              <div className="display" style={{ fontWeight: 700, marginBottom: 5 }}>{c.t}</div>
              <div className="muted" style={{ fontSize: 14, lineHeight: 1.55 }}>{c.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="container" style={{ paddingTop: 72 }}>
        <div style={{ textAlign: "center", maxWidth: 640, margin: "0 auto 40px" }}>
          <span className="eyebrow text-gold" style={{ display: "block", marginBottom: 12 }}>Trust by design</span>
          <h2 className="display" style={{ fontSize: "clamp(24px, 6vw, 34px)", letterSpacing: "-0.01em" }}>Autonomy without losing custody</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
          {TRUST.map((t) => (
            <div key={t.t} className="card-flat">
              <div className="display" style={{ fontWeight: 700, fontSize: 15.5, marginBottom: 6 }}>{t.t}</div>
              <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{t.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="container" style={{ paddingTop: 80 }}>
        <div className="card gold-ring" style={{ textAlign: "center", padding: "52px 30px", maxWidth: 760, margin: "0 auto" }}>
          <h2 className="display" style={{ fontSize: "clamp(26px, 7vw, 36px)", letterSpacing: "-0.01em", marginBottom: 12 }}>Build your first trading agent</h2>
          <p className="text-2" style={{ fontSize: 17, maxWidth: 480, margin: "0 auto 26px" }}>
            Give it a strategy, hand it the data, and let it trade digital assets on your terms.
          </p>
          <Link href="/login" className="btn btn-solid" style={{ height: 50, padding: "0 34px", fontSize: 15, borderRadius: 14, letterSpacing: "0.04em" }}>Request Access</Link>
        </div>
      </section>
    </main>
  );
}
