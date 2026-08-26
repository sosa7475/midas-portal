"use client";

/**
 * Frontend API client — talks to same-origin Next.js API routes on Vercel
 * (auth, strategy, market analysis, chat). No separate backend host.
 */
const TOKEN_KEY = "midas_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

async function req<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
    login: (email: string, password: string) => req("POST", "/api/auth/login", { email, password }),
    register: (email: string, password: string) => req("POST", "/api/auth/register", { email, password }),
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
    create: (a: { name: string; instructions: string; mcps: string[] }) => req("POST", "/api/agents", a),
    remove: (id: string) => req("DELETE", `/api/agents/${id}`),
  },
};

/** Stream a chat message from /api/chat. Calls onEvent for each SSE event. Returns an abort fn. */
export function streamChat(message: string, onEvent: (e: any) => void, agentId?: string): () => void {
  const controller = new AbortController();
  (async () => {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
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
