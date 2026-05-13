import { createClient } from "@/lib/supabase/server";
import type { FilingJob } from "@/lib/supabase/types";
import { TerminalLog } from "@/components/dashboard/TerminalLog";

export const dynamic = "force-dynamic";

async function getLatestJob(): Promise<FilingJob | null> {
  const supabase = await createClient();

  // Prefer active job first
  const { data: active } = await supabase
    .from("filing_jobs")
    .select("*")
    .in("status", ["queued", "running"])
    .order("queued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active) return active as FilingJob;

  // Fallback to most recent job
  const { data: recent } = await supabase
    .from("filing_jobs")
    .select("*")
    .order("queued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (recent as FilingJob) ?? null;
}

export default async function TerminalPage() {
  const initialJob = await getLatestJob();

  return (
    <div className="flex flex-col" style={{ minHeight: "100%" }}>
      {/* Page header */}
      <div
        className="px-8 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            Terminal
          </h1>
          <span className="font-mono text-xs" style={{ color: "#4a5a6d" }}>
            Skyvern Agent Live Output
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: "#4a5a6d" }}>
          Real-time browser agent actions from the TDEC filing pipeline. Updates
          via Supabase Realtime with 3s polling fallback.
        </p>
      </div>

      {/* Terminal */}
      <div className="flex-1 px-8 py-6">
        <TerminalLog initialJob={initialJob} />
      </div>
    </div>
  );
}
