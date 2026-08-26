"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = mode === "login" ? await api.auth.login(email, password) : await api.auth.register(email, password);
      setToken(res.token);
      router.push("/overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "calc(100vh - 60px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form className="card" style={{ width: 400, padding: 32 }} onSubmit={submit}>
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <p className="text-2" style={{ marginBottom: 24, fontSize: 14 }}>
          {mode === "login" ? "Sign in to your agents" : "Start building trading agents in minutes"}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <input className="input" type="password" placeholder="Password (min 8 characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 8 : undefined} required />
          {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
          <button className="btn btn-solid" type="submit" disabled={busy} style={{ width: "100%", height: 44 }}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </div>
        <p style={{ marginTop: 18, fontSize: 13.5 }} className="text-2">
          {mode === "login" ? "No account? " : "Already have an account? "}
          <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} style={{ background: "none", border: "none", color: "var(--brand)", cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </form>
    </main>
  );
}
