import type { DisplayStatus } from "@/lib/supabase/types";

interface StatusBadgeProps {
  status: DisplayStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  DisplayStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  OK: {
    label: "OK",
    bg: "bg-emerald-950",
    text: "text-emerald-400",
    border: "border-emerald-800",
  },
  WARNING: {
    label: "WARNING",
    bg: "bg-amber-950",
    text: "text-amber-400",
    border: "border-amber-800",
  },
  CRITICAL: {
    label: "CRITICAL",
    bg: "bg-red-950",
    text: "text-red-400",
    border: "border-red-800",
  },
  FILED: {
    label: "FILED",
    bg: "bg-blue-950",
    text: "text-blue-300",
    border: "border-blue-800",
  },
  FAILED: {
    label: "FAILED",
    bg: "bg-red-950",
    text: "text-red-400",
    border: "border-red-800",
  },
  IN_PROGRESS: {
    label: "IN PROGRESS",
    bg: "bg-sky-950",
    text: "text-sky-400",
    border: "border-sky-800",
  },
  MANUAL: {
    label: "MANUAL",
    bg: "bg-zinc-800",
    text: "text-zinc-300",
    border: "border-zinc-600",
  },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider ${cfg.bg} ${cfg.text} ${cfg.border} ${className}`}
    >
      {cfg.label}
    </span>
  );
}
