"use client";

/**
 * Dashboard shell (Phase 1): proves auth + API connectivity end-to-end.
 * Phase 4 builds the full portfolio/chat/journal experience.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Strategy, Trade } from "@midas/shared";
import { api, getToken, setToken } from "../../lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api
      .health()
      .then(() => setApiOk(true))
      .catch(() => setApiOk(false));
    api.strategy.get().then((r) => setStrategy(r.strategy)).catch(() => undefined);
    api.trade.history(10).then((r) => setTrades(r.trades)).catch(() => undefined);
  }, [router]);

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        <h1 style={{ fontSize: 28 }}>Portfolio</h1>
        <button
          className="btn-primary"
          style={{ padding: "8px 16px", fontSize: 13 }}
          onClick={() => {
            setToken(null);
            router.replace("/login");
          }}
        >
          Sign out
        </button>
      </header>

      <div style={{ display: "grid", gap: 16 }}>
        <div className="glass" style={{ padding: 24 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 6 }}>
            API connection
          </p>
          <p style={{ fontWeight: 600, color: apiOk ? "var(--profit)" : "var(--loss)" }}>
            {apiOk === null ? "Checking…" : apiOk ? "● Connected" : "● Unreachable"}
          </p>
        </div>

        <div className="glass" style={{ padding: 24 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 6 }}>
            Active strategy
          </p>
          <p style={{ fontWeight: 600 }}>{strategy ? strategy.name : "None defined yet"}</p>
        </div>

        <div className="glass" style={{ padding: 24 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 12 }}>
            Recent trades
          </p>
          {trades.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No trades yet.</p>
          ) : (
            trades.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span style={{ fontWeight: 600 }}>{t.pair}</span>
                <span
                  style={{ color: t.side === "long" ? "var(--profit)" : "var(--loss)" }}
                >
                  {t.side.toUpperCase()}
                </span>
                <span style={{ color: "var(--text-secondary)" }}>{t.status}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
