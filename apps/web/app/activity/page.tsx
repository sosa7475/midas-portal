"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";

export default function Activity() {
  const ready = useAuth();
  const [data, setData] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { setRefreshing(true); try { setData(await api.activity()); } catch { setData({ holdings: [], positions: [], trades: [] }); } finally { setRefreshing(false); } }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);
  // Live-ish: refresh positions/holdings every 20s.
  useEffect(() => { if (!ready) return; const t = setInterval(load, 20000); return () => clearInterval(t); }, [ready, load]);
  if (!ready) return null;

  const fmt = (n: any, d = 2) => n == null ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d });
  const usd = (n: any) => n == null ? "—" : `$${fmt(n)}`;
  const when = (t: any) => { try { return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const holdings = data?.holdings ?? [];
  const positions = data?.positions ?? [];
  const trades = data?.trades ?? [];

  return (
    <main className="container" style={{ paddingTop: 22, paddingBottom: 60, maxWidth: 960 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Terminal</h1>
        <button className="btn btn-ghost btn-sm" onClick={load} disabled={refreshing}>{refreshing ? "…" : "↻ Refresh"}</button>
      </div>

      {/* Portfolio value header */}
      <div className="card" style={{ marginBottom: 20, display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>Total value</div>
          <div className="display" style={{ fontSize: 30, fontWeight: 800 }}>{data ? usd(data.totalValueUsd) : "…"}</div>
        </div>
        <div><div className="muted" style={{ fontSize: 12 }}>Assets</div><div style={{ fontSize: 18, fontWeight: 700 }}>{holdings.length}</div></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Open perps</div><div style={{ fontSize: 18, fontWeight: 700 }}>{positions.length}</div></div>
      </div>

      {/* Holdings — what you're in */}
      <SectionTitle>Holdings</SectionTitle>
      <div className="card mono" style={{ marginBottom: 22, padding: holdings.length ? 0 : 18, overflow: "hidden" }}>
        {!data ? <p className="muted" style={{ padding: 14 }}>Loading…</p>
          : holdings.length === 0 ? <p className="text-2" style={{ fontSize: 13.5 }}>No holdings yet. Assets your agents buy show here with live value & allocation.</p>
          : (<>
            <Row head cols={["Asset", "Amount", "Price", "Value", "Alloc"]} />
            {holdings.map((h: any, i: number) => (
              <Row key={i} cols={[
                <b key="a">{h.symbol}<span className="muted" style={{ fontWeight: 400 }}> · {h.agent}</span></b>,
                fmt(h.amount, 4), usd(h.priceUsd == 1 ? 1 : h.priceUsd), <b key="v">{usd(h.valueUsd)}</b>, `${h.allocationPct ?? 0}%`,
              ]} last={i === holdings.length - 1} />
            ))}
          </>)}
      </div>

      {/* Perp positions */}
      <SectionTitle>Open positions</SectionTitle>
      <div className="card mono" style={{ marginBottom: 22, padding: positions.length ? 0 : 18, overflow: "hidden" }}>
        {!data ? <p className="muted" style={{ padding: 14 }}>Loading…</p>
          : positions.length === 0 ? <p className="text-2" style={{ fontSize: 13.5 }}>No open perp positions.</p>
          : (<>
            <Row head cols={["Market", "Side", "Size @ Entry", "uPnL"]} />
            {positions.map((p: any, i: number) => (
              <Row key={i} cols={[
                <b key="c">{p.coin}<span className="muted" style={{ fontWeight: 400 }}> · {p.agent}</span></b>,
                <span key="s" style={{ color: p.szi >= 0 ? "var(--green)" : "var(--red)" }}>{p.szi >= 0 ? "LONG" : "SHORT"}</span>,
                `${fmt(Math.abs(p.szi), 4)} @ ${fmt(p.entry)}`,
                <span key="u" style={{ color: (p.upnl ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>{(p.upnl ?? 0) >= 0 ? "+" : ""}{usd(p.upnl)}</span>,
              ]} last={i === positions.length - 1} />
            ))}
          </>)}
      </div>

      {/* Trades */}
      <SectionTitle>Trades</SectionTitle>
      <div className="card" style={{ padding: trades.length ? 8 : 18 }}>
        {!data ? <p className="muted">Loading…</p>
          : trades.length === 0 ? <p className="text-2" style={{ fontSize: 13.5 }}>No trades yet.</p>
          : trades.map((t: any, i: number) => (
            <div key={i} style={{ padding: "11px 8px", borderBottom: i < trades.length - 1 ? "1px solid var(--border)" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge badge-soft" style={{ textTransform: "uppercase", fontSize: 10 }}>{t.venue || t.kind}</span>
                <span className="mono" style={{ fontWeight: 600, flex: 1, fontSize: 13 }}>{t.summary}</span>
                {t.strategyVersion != null && <span className="muted" style={{ fontSize: 11 }}>v{t.strategyVersion}</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 5, flexWrap: "wrap" }}>
                <span className="muted mono" style={{ fontSize: 11.5 }}>{when(t.at)}</span>
                {t.price != null && <span className="muted mono" style={{ fontSize: 11.5 }}>@ {fmt(t.price, 6)}</span>}
                {t.notionalUsd != null && <span className="muted mono" style={{ fontSize: 11.5 }}>{usd(t.notionalUsd)}</span>}
                {t.txHash && <a href={`https://basescan.org/tx/${t.txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--brand)" }}>tx ↗</a>}
                {t.rationale && <button onClick={() => setOpen(open === `${i}` ? null : `${i}`)} style={{ fontSize: 11.5, color: "var(--brand)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>{open === `${i}` ? "hide" : "why?"}</button>}
              </div>
              {open === `${i}` && t.rationale && <div className="text-2" style={{ fontSize: 12.5, marginTop: 8, padding: 10, background: "var(--surface-2)", borderRadius: 8, lineHeight: 1.5 }}>{t.rationale}</div>}
            </div>
          ))}
      </div>
    </main>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow" style={{ color: "var(--text-muted)", marginBottom: 8, fontSize: 11 }}>{children}</div>;
}

function Row({ cols, head, last }: { cols: React.ReactNode[]; head?: boolean; last?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols.length === 5 ? "1.6fr 1fr 1fr 1fr 0.7fr" : cols.length === 4 ? "1.6fr 0.8fr 1.4fr 1fr" : `repeat(${cols.length}, 1fr)`, gap: 8, padding: "10px 14px", fontSize: 13, borderBottom: head || !last ? "1px solid var(--border)" : "none", background: head ? "var(--surface-2)" : "transparent", color: head ? "var(--text-muted)" : "var(--text)", fontWeight: head ? 600 : 400 }}>
      {cols.map((c, i) => <div key={i} style={{ textAlign: i === 0 ? "left" : "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</div>)}
    </div>
  );
}
