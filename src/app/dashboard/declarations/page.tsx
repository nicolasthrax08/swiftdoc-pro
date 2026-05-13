import { createClient } from "@/lib/supabase/server";
import type { Declaration } from "@/lib/supabase/types";
import { DeclarationsTable } from "@/components/dashboard/DeclarationsTable";

export const revalidate = 30;

export default async function DeclarationsPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("declarations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  const declarations = (data ?? []) as Declaration[];

  return (
    <div className="flex flex-col" style={{ minHeight: "100%" }}>
      {/* Page header */}
      <div
        className="px-8 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            Declarations
          </h1>
          <span className="font-mono text-xs" style={{ color: "#4a5a6d" }}>
            {declarations.length} record{declarations.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: "#4a5a6d" }}>
          All TDEC trade declarations. Click an ID to view detail and trigger
          filing.
        </p>
      </div>

      <div className="px-8 py-6">
        <div
          className="overflow-hidden rounded"
          style={{ background: "#0f1e2e", border: "1px solid #243447" }}
        >
          <DeclarationsTable declarations={declarations} />
        </div>
      </div>
    </div>
  );
}
