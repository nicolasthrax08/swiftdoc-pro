import { createClient } from "@/lib/supabase/server";
import type { Declaration } from "@/lib/supabase/types";
import { computeDisplayStatus } from "@/lib/supabase/types";
import Link from "next/link";
import { SummaryCard } from "@/components/dashboard/SummaryCard";
import { DeclarationsTable } from "@/components/dashboard/DeclarationsTable";
import { AutomationMonitor } from "@/components/dashboard/AutomationMonitor";

export const revalidate = 30;

async function getDashboardData() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: declarations } = await supabase
    .from("declarations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const rows = (declarations ?? []) as Declaration[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const totalDeclarations = rows.length;
  const pendingFilings = rows.filter(
    (d) => d.status === "pending" || d.status === "in_progress"
  ).length;
  const criticalCount = rows.filter((d) => {
    const s = computeDisplayStatus(d);
    return s === "CRITICAL";
  }).length;
  const filedToday = rows.filter((d) => {
    if (!d.filed_at) return false;
    const fAt = new Date(d.filed_at);
    return fAt >= today && fAt < tomorrow;
  }).length;

  return { rows, totalDeclarations, pendingFilings, criticalCount, filedToday };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  if (!data) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: "#8a9a8c" }}
      >
        Failed to load dashboard data.
      </div>
    );
  }

  const { rows, totalDeclarations, pendingFilings, criticalCount, filedToday } =
    data;

  return (
    <div className="flex flex-col gap-0" style={{ minHeight: "100%" }}>
      {/* Page header */}
      <div
        className="px-8 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            Dashboard
          </h1>
          <span className="font-mono text-xs" style={{ color: "#4a5a6d" }}>
            Trade Compliance Overview
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: "#4a5a6d" }}>
          {new Date().toLocaleDateString("en-HK", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      </div>

      {/* Summary cards */}
      <div
        className="grid grid-cols-2 gap-3 px-8 py-5 lg:grid-cols-4"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <SummaryCard
          label="Total Declarations"
          value={totalDeclarations}
          sub="All time"
        />
        <SummaryCard
          label="Pending Filings"
          value={pendingFilings}
          sub="Requires action"
          accent="blue"
        />
        <SummaryCard
          label="Critical"
          value={criticalCount}
          sub=">3 days overdue"
          accent="red"
        />
        <SummaryCard
          label="Filed Today"
          value={filedToday}
          sub={new Date().toLocaleDateString("en-HK", {
            day: "numeric",
            month: "short",
          })}
        />
      </div>

      {/* Automation monitor */}
      <div
        className="px-8 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div className="mb-3">
          <h2 className="text-sm font-semibold tracking-tight text-white">
            Automation Monitor
          </h2>
          <p className="text-xs" style={{ color: "#4a5a6d" }}>
            Vault, agent, and watchdog milestones as they complete.
          </p>
        </div>
        <AutomationMonitor />
      </div>

      {/* Recent declarations */}
      <div className="flex flex-1 flex-col px-8 py-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2
              className="text-sm font-semibold tracking-tight text-white"
            >
              Recent Declarations
            </h2>
            <p className="text-xs" style={{ color: "#4a5a6d" }}>
              Latest {rows.length} records
            </p>
          </div>
          <Link
            href="/dashboard/declarations"
            className="font-mono text-xs transition-colors"
            style={{ color: "#60a5fa" }}
          >
            View all →
          </Link>
        </div>

        <div
          className="overflow-hidden rounded"
          style={{
            background: "#0f1e2e",
            border: "1px solid #243447",
          }}
        >
          <DeclarationsTable declarations={rows} />
        </div>
      </div>
    </div>
  );
}
