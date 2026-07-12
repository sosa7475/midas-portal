import Link from "next/link";

/**
 * Landing shell (Phase 1). Phase 4 builds the full marketing page —
 * this establishes the glass aesthetic and the public front door.
 */
export default function Landing() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div className="glass" style={{ maxWidth: 720, padding: "64px 48px" }}>
        <p
          style={{
            color: "var(--primary)",
            fontWeight: 600,
            letterSpacing: 2,
            fontSize: 13,
            textTransform: "uppercase",
            marginBottom: 16,
          }}
        >
          Midas Portal
        </p>
        <h1 style={{ fontSize: 44, lineHeight: 1.15, marginBottom: 20 }}>
          Trade with an agent.
          <br />
          <span style={{ color: "var(--primary)" }}>Keep the discipline.</span>
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 18,
            lineHeight: 1.6,
            marginBottom: 36,
          }}
        >
          Midas analyzes the market, checks every idea against your strategy, and executes
          on-chain perps — but never without your confirmation. Emotional discipline,
          enforced in code.
        </p>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/login" className="btn-primary">
            Enter the portal
          </Link>
        </div>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 32, maxWidth: 560 }}>
        Trading perpetual futures involves substantial risk of loss. Midas Portal is not
        financial advice. Nothing here is a recommendation to buy or sell any asset.
      </p>
    </main>
  );
}
