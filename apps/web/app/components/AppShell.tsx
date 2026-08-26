"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Icon } from "./Icon";

const NAV = [
  { label: "Overview", href: "/overview", icon: "overview" },
  { label: "Hire an Agent", href: "/hire", icon: "hire" },
  { label: "My Agents", href: "/agents", icon: "agents" },
  { label: "Wallet", href: "/wallet", icon: "wallet" },
];

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState("light");
  useEffect(() => { setTheme(document.documentElement.dataset.theme || "light"); }, []);
  const toggle = () => {
    const next = (document.documentElement.dataset.theme === "dark") ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("midas-theme", next); } catch {}
    setTheme(next);
  };
  return [theme, toggle];
}

function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16 }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, var(--brand-2), var(--brand))", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, boxShadow: "var(--glow)" }}>M</span>
      {!collapsed && "Midas"}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("midas-sidebar") === "1"); } catch {}
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => { const n = !c; try { localStorage.setItem("midas-sidebar", n ? "1" : "0"); } catch {} return n; });

  const ThemeBtn = (
    <button className="btn btn-icon btn-outline" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle theme">
      <Icon name={theme === "dark" ? "sun" : "moon"} size={17} />
    </button>
  );

  // Marketing / auth: minimal top bar, no sidebar.
  if (pathname === "/" || pathname === "/login") {
    return (
      <>
        <nav style={{ display: "flex", alignItems: "center", height: 62, padding: "0 26px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 40, background: "var(--surface)", backdropFilter: "blur(var(--glass-blur))" }}>
          <Link href="/"><Logo /></Link>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 10 }}>
            {ThemeBtn}
            <Link href="/login" className="btn btn-solid btn-sm">Sign in</Link>
          </div>
        </nav>
        {children}
      </>
    );
  }

  return (
    <div className="shell">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <div className="side-top">
          {!collapsed && <Link href="/overview" style={{ flex: 1 }}><Logo /></Link>}
          <button className="side-collapse" onClick={toggleCollapsed} title={collapsed ? "Expand" : "Collapse"} aria-label="Toggle sidebar">
            <Icon name="panel" size={18} />
          </button>
        </div>

        <Link href="/agents/new" className="btn btn-solid" style={{ marginBottom: 8, justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? 0 : "0 14px" }}>
          <Icon name="plus" size={18} />{!collapsed && "New Agent"}
        </Link>

        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={`side-item${pathname.startsWith(n.href) ? " active" : ""}`} title={n.label}>
            <Icon name={n.icon} size={19} />
            <span className="side-label">{n.label}</span>
          </Link>
        ))}

        <div style={{ flex: 1 }} />

        <div className="side-item" onClick={toggleTheme} title="Toggle theme">
          <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
          <span className="side-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </div>
        <div className="side-item" onClick={async () => { await api.auth.logout(); router.push("/login"); }} title="Sign out">
          <Icon name="logout" size={19} />
          <span className="side-label">Sign out</span>
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
