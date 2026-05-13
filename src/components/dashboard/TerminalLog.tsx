"use client";

import { useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { FilingJob, AuditLogEntry } from "@/lib/supabase/types";
import { useMountEffect } from "@/hooks/useMountEffect";

interface LogLine {
  ts: string;
  action: string;
  message: string;
  level: "info" | "error" | "success";
}

function auditEntryToLogLine(entry: AuditLogEntry): LogLine {
  const action = entry.stage?.toUpperCase() ?? "LOG";
  const level: LogLine["level"] = !entry.success
    ? "error"
    : action === "COMPLETED" || action === "FILED"
      ? "success"
      : "info";
  return { ts: entry.ts, action: `[${action}]`, message: entry.msg, level };
}

function jobToStatusLine(job: FilingJob): LogLine {
  const statusMap: Record<string, string> = {
    queued: "Job queued, waiting for Skyvern agent",
    running: "Skyvern agent running",
    completed: "Filing completed successfully",
    failed: `Filing failed: ${job.last_error_msg ?? job.last_error_code ?? "unknown"}`,
    cancelled: "Job cancelled",
  };
  return {
    ts: job.queued_at,
    action: "[STATUS]",
    message: `${job.status.toUpperCase()} — ${statusMap[job.status] ?? job.status}`,
    level:
      job.status === "failed" || job.status === "cancelled" ? "error" : "info",
  };
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-HK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

const LINE_COLORS = {
  info: "#8a9a8c",
  error: "#f87171",
  success: "#4ade80",
};

interface TerminalLogProps {
  initialJob: FilingJob | null;
}

export function TerminalLog({ initialJob }: TerminalLogProps) {
  const [activeJob, setActiveJob] = useState<FilingJob | null>(initialJob);
  const [lines, setLines] = useState<LogLine[]>(() => {
    if (!initialJob) return [];
    const auditLines = (initialJob.audit_log ?? []).map(auditEntryToLogLine);
    return [jobToStatusLine(initialJob), ...auditLines];
  });

  // Stable ref to the scroll container; scroll to bottom whenever lines update
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    scrollContainerRef.current = node;
  }, []);

  function applyJobAndScroll(job: FilingJob) {
    const auditLines = (job.audit_log ?? []).map(auditEntryToLogLine);
    setActiveJob(job);
    setLines([jobToStatusLine(job), ...auditLines]);
    // Defer so the DOM has updated before we scroll
    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop =
          scrollContainerRef.current.scrollHeight;
      }
    }, 0);
  }

  useMountEffect(() => {
    const supabase = createClient();
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    async function fetchActiveJob() {
      // Prefer active job first
      const { data: active } = await supabase
        .from("filing_jobs")
        .select("*")
        .in("status", ["queued", "running"])
        .order("queued_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (active) {
        applyJobAndScroll(active as FilingJob);
        return;
      }

      // Fallback to most recent job
      const { data: recent } = await supabase
        .from("filing_jobs")
        .select("*")
        .order("queued_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent) {
        applyJobAndScroll(recent as FilingJob);
      } else {
        setActiveJob(null);
        setLines([]);
      }
    }

    // Subscribe to realtime changes on filing_jobs
    const channel = supabase
      .channel("filing_jobs_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "filing_jobs" },
        (payload) => {
          applyJobAndScroll(payload.new as FilingJob);
        }
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") {
          // Fallback: poll every 3 seconds if realtime unavailable
          pollInterval = setInterval(fetchActiveJob, 3000);
        }
      });

    // Initial fetch
    fetchActiveJob();

    return () => {
      supabase.removeChannel(channel);
      if (pollInterval) clearInterval(pollInterval);
    };
  });

  const isActive =
    activeJob?.status === "queued" || activeJob?.status === "running";

  return (
    <div
      className="flex flex-col rounded overflow-hidden"
      style={{
        background: "#06111a",
        border: "1px solid #243447",
        minHeight: 420,
      }}
    >
      {/* Terminal header bar */}
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ background: "#0b1b2b", borderBottom: "1px solid #243447" }}
      >
        <div className="flex gap-1.5">
          <div
            className="h-3 w-3 rounded-full"
            style={{ background: "#3d1a1a" }}
          />
          <div
            className="h-3 w-3 rounded-full"
            style={{ background: "#3d2d0a" }}
          />
          <div
            className="h-3 w-3 rounded-full"
            style={{ background: "#0a2d1a" }}
          />
        </div>
        <span className="font-mono text-xs" style={{ color: "#4a5a6d" }}>
          skyvern-agent — filing terminal
        </span>
        {isActive && (
          <span
            className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "#4ade80" }}
          >
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: "#4ade80" }}
            />
            LIVE
          </span>
        )}
        {activeJob && !isActive && (
          <span
            className="ml-auto font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "#4a5a6d" }}
          >
            {activeJob.status.toUpperCase()}
          </span>
        )}
      </div>

      {/* Job info bar */}
      {activeJob && (
        <div
          className="grid grid-cols-3 gap-4 px-4 py-2"
          style={{
            background: "#08161f",
            borderBottom: "1px solid #1a2d40",
          }}
        >
          <div>
            <span
              className="font-mono text-[10px] uppercase tracking-widest"
              style={{ color: "#4a5a6d" }}
            >
              Task ID
            </span>
            <p className="mt-0.5 truncate font-mono text-xs text-white">
              {activeJob.skyvern_task_id ?? "—"}
            </p>
          </div>
          <div>
            <span
              className="font-mono text-[10px] uppercase tracking-widest"
              style={{ color: "#4a5a6d" }}
            >
              Retries
            </span>
            <p className="mt-0.5 font-mono text-xs text-white">
              {activeJob.retry_count} / {activeJob.max_retries}
            </p>
          </div>
          <div>
            <span
              className="font-mono text-[10px] uppercase tracking-widest"
              style={{ color: "#4a5a6d" }}
            >
              Portal Ref
            </span>
            <p className="mt-0.5 font-mono text-xs text-white">
              {activeJob.portal_ref ?? "—"}
            </p>
          </div>
        </div>
      )}

      {/* Log output */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{ fontFamily: "monospace", fontSize: 12, lineHeight: "1.8" }}
      >
        {lines.length === 0 ? (
          <p style={{ color: "#4a5a6d" }}>
            {"> "}No active filing in progress. Waiting for next job…
          </p>
        ) : (
          lines.map((line) => (
            <div key={`${line.ts}-${line.action}`} className="flex items-start gap-3">
              <span
                style={{ color: "#243447", flexShrink: 0, minWidth: 70 }}
              >
                {formatTs(line.ts)}
              </span>
              <span
                style={{
                  color:
                    line.action === "[ERROR]" ? "#f87171" : "#4a5a6d",
                  flexShrink: 0,
                  minWidth: 100,
                }}
              >
                {line.action}
              </span>
              <span style={{ color: LINE_COLORS[line.level] }}>
                {line.message}
              </span>
            </div>
          ))
        )}
        {isActive && (
          <div
            className="flex items-center gap-2 pt-1"
            style={{ color: "#4ade80" }}
          >
            <span>{">"}</span>
            <span
              className="inline-block h-3 w-px animate-pulse"
              style={{ background: "#4ade80" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
