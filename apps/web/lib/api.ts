"use client";

/**
 * Frontend API client. The auth token lives ONLY in an httpOnly cookie (set by
 * the server, not readable by JS → XSS-safe). The client keeps just a
 * non-sensitive "logged in" flag for UI gating. Same-origin requests send the
 * cookie automatically.
 */
const FLAG = "midas_authed";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(FLAG);
}
export function setToken(v: string | null) {
  if (typeof window === "undefined") return;
  if (v) window.localStorage.setItem(FLAG, "1");
  else window.localStorage.removeItem(FLAG);
}

async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    setToken(null);
    if (!["/login", "/"].includes(window.location.pathname)) window.location.href = "/login";
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { const d = await res.json(); if (d?.error) msg = d.error; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  auth: {
    login: async (email: string, password: string) => { const r = await req("POST", "/api/auth/login", { email, password }); setToken("1"); return r; },
    register: async (email: string, password: string) => { const r = await req("POST", "/api/auth/register", { email, password }); setToken("1"); return r; },
    logout: async () => { try { await req("POST", "/api/auth/logout"); } catch {} setToken(null); },
  },
  strategy: {
    get: () => req("GET", "/api/strategy"),
    save: (rulesText: string, name?: string) => req("POST", "/api/strategy", { rulesText, name }),
  },
  market: {
    analyze: (symbol: string, interval = "4h") => req("GET", `/api/market/analyze?symbol=${encodeURIComponent(symbol)}&interval=${interval}`),
  },
  agents: {
    list: () => req("GET", "/api/agents"),
    get: (id: string) => req("GET", `/api/agents/${id}`),
    messages: (id: string) => req("GET", `/api/agents/${id}/messages`),
    create: (a: { name: string; instructions: string; mcps: string[] }) => req("POST", "/api/agents", a),
    remove: (id: string) => req("DELETE", `/api/agents/${id}`),
  },
  orderly: {
    list: () => req("GET", "/api/orderly/list"),
    account: (agentId: string) => req("GET", `/api/orderly/account?agentId=${agentId}`),
    generate: (agentId: string) => req("POST", "/api/orderly/connect", { mode: "generate", agentId }),
    connectKey: (agentId: string, c: { accountId: string; orderlyKey: string; secretHex: string; network: string }) => req("POST", "/api/orderly/connect", { mode: "apikey", agentId, ...c }),
    disconnect: (agentId: string) => req("POST", "/api/orderly/disconnect", { agentId }),
    order: (agentId: string, o: { symbol: string; side: string; type?: string; quantity: number; price?: number; reduceOnly?: boolean }) => req("POST", "/api/orderly/order", { agentId, ...o }),
    faucet: (agentId: string) => req("POST", "/api/orderly/faucet", { agentId }),
  },
};

/** Stream a chat message. Cookie is sent automatically (same-origin). Returns an abort fn. */
export function streamChat(message: string, onEvent: (e: any) => void, agentId?: string): () => void {
  const controller = new AbortController();
  (async () => {
    const res = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, agentId }),
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) return;
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.split("\n").find((l) => l.startsWith("data: "));
        if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch {} }
      }
    }
  })().catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", error: String(e) }); });
  return () => controller.abort();
}
