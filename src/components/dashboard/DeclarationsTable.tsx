import Link from "next/link";
import type { Declaration } from "@/lib/supabase/types";
import { computeDisplayStatus } from "@/lib/supabase/types";
import { StatusBadge } from "./StatusBadge";

interface DeclarationsTableProps {
  declarations: Declaration[];
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-HK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatHKD(value: number | undefined | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function DeclarationsTable({ declarations }: DeclarationsTableProps) {
  if (declarations.length === 0) {
    return (
      <div
        className="py-12 text-center font-mono text-sm"
        style={{ color: "#4a5a6d" }}
      >
        No declarations found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid #243447" }}>
            {[
              "ID",
              "Consignee",
              "Departure Date",
              "HKHS Code",
              "Value (HKD)",
              "Deadline",
              "Status",
            ].map((h) => (
              <th
                key={h}
                className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-widest"
                style={{ color: "#4a5a6d" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {declarations.map((decl) => {
            const d = decl.declaration_data;
            const displayStatus = computeDisplayStatus(decl);
            const consignee =
              d.consignee ?? d.declarant_name ?? "—";
            const departureDate =
              d.departure_date ?? d.trade_date ?? null;
            const hsCode =
              d.hkhs_code ?? d.hs_code ?? "—";
            const value =
              d.total_value_hkd ?? d.value_hkd ?? null;

            return (
              <tr
                key={decl.id}
                className="transition-colors"
                style={{ borderBottom: "1px solid #1a2d40" }}
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/declarations/${decl.id}`}
                    className="font-mono text-xs transition-colors"
                    style={{ color: "#60a5fa" }}
                  >
                    {decl.id.slice(0, 8)}…
                  </Link>
                </td>
                <td
                  className="max-w-[140px] truncate px-4 py-3 font-medium"
                  style={{ color: "#ffffff" }}
                  title={consignee}
                >
                  {consignee}
                </td>
                <td
                  className="px-4 py-3 font-mono text-xs"
                  style={{ color: "#8a9a8c" }}
                >
                  {formatDate(departureDate)}
                </td>
                <td
                  className="px-4 py-3 font-mono text-xs"
                  style={{ color: "#8a9a8c" }}
                >
                  {hsCode}
                </td>
                <td
                  className="px-4 py-3 font-mono text-xs"
                  style={{ color: "#8a9a8c" }}
                >
                  {formatHKD(value)}
                </td>
                <td
                  className="px-4 py-3 font-mono text-xs"
                  style={{ color: displayStatus === "CRITICAL" ? "#f87171" : "#8a9a8c" }}
                >
                  {formatDate(decl.filing_deadline)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={displayStatus} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
