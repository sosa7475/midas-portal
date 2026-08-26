"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getToken } from "../../lib/api";

const TABS = [
  { label: "Overview", href: "/overview" },
  { label: "Hire an Agent", href: "/hire" },
  { label: "My Agents", href: "/agents" },
  { label: "Wallet", href: "/wallet" },
];

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  useEffect(() => setAuthed(!!getToken()), [pathname]);

  // Hide the app nav on the marketing/login screens.
  if (pathname === "/" || pathname === "/login") {
    return (
      <nav className="nav">
        <Link href="/" className="nav-logo"><Logo /> Midas</Link>
        <div className="nav-spacer" />
        <Link href="/login" className="btn btn-solid btn-sm">Sign in</Link>
      </nav>
    );
  }

  return (
    <nav className="nav">
      <Link href="/overview" className="nav-logo"><Logo /> Midas</Link>
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={`nav-tab${pathname.startsWith(t.href) ? " active" : ""}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <div className="nav-spacer" />
      <Link href="/agents/new" className="btn btn-solid btn-sm">+ New Agent</Link>
      {authed && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => { await api.auth.logout(); router.push("/login"); }}
        >
          Sign out
        </button>
      )}
    </nav>
  );
}

function Logo() {
  return (
    <span
      style={{
        width: 26, height: 26, borderRadius: 8,
        background: "linear-gradient(135deg, #e2622f, #f2913f)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "#fff", fontWeight: 800, fontSize: 15,
      }}
    >
      M
    </span>
  );
}
