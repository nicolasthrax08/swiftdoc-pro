"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Terminal,
  Settings,
  Zap,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/declarations", label: "Declarations", icon: FileText, exact: false },
  { href: "/dashboard/terminal", label: "Terminal", icon: Terminal, exact: false },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, exact: false },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="flex h-full w-56 flex-col"
      style={{ background: "#0b1b2b", borderRight: "1px solid #243447" }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-5 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div
          className="flex h-7 w-7 items-center justify-center rounded"
          style={{ background: "#4a5a6d" }}
        >
          <Zap className="h-4 w-4 text-white" />
        </div>
        <span className="text-sm font-bold tracking-tight text-white">
          SwiftDoc
        </span>
        <span
          className="ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest"
          style={{ background: "#1a2d40", color: "#8a9a8c" }}
        >
          HKSAR
        </span>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 p-3 flex-1">
        <p
          className="px-2 pb-2 pt-1 font-mono text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "#4a5a6d" }}
        >
          Navigation
        </p>
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors"
              style={{
                background: active ? "#1a2d40" : "transparent",
                color: active ? "#ffffff" : "#8a9a8c",
              }}
            >
              <Icon
                className="h-4 w-4 flex-shrink-0"
                style={{ color: active ? "#ffffff" : "#4a5a6d" }}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "1px solid #243447" }}
      >
        <p className="font-mono text-[10px]" style={{ color: "#4a5a6d" }}>
          Trade Compliance Platform
        </p>
        <p className="font-mono text-[10px]" style={{ color: "#243447" }}>
          v0.1 · Staging
        </p>
      </div>
    </aside>
  );
}
