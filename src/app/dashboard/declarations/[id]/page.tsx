import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Declaration, FilingJob } from "@/lib/supabase/types";
import { computeDisplayStatus } from "@/lib/supabase/types";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { DeclarationActions } from "@/components/dashboard/DeclarationActions";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-HK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHKD(value: number | undefined | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-HK", {
    style: "currency",
    currency: "HKD",
    minimumFractionDigits: 2,
  }).format(value);
}

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div
      className="grid grid-cols-[180px_1fr] items-start gap-4 py-2.5"
      style={{ borderBottom: "1px solid #1a2d40" }}
    >
      <span
        className="font-mono text-[11px] uppercase tracking-widest"
        style={{ color: "#4a5a6d" }}
      >
        {label}
      </span>
      <span className="text-sm" style={{ color: "#ffffff" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div
      className="rounded overflow-hidden"
      style={{ background: "#0f1e2e", border: "1px solid #243447" }}
    >
      <div
        className="px-5 py-3"
        style={{ borderBottom: "1px solid #243447", background: "#0b1b2b" }}
      >
        <h2
          className="font-mono text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: "#4a5a6d" }}
        >
          {title}
        </h2>
      </div>
      <div className="px-5 py-1">{children}</div>
    </div>
  );
}

function computeComplianceChecks(decl: Declaration) {
  const d = decl.declaration_data;
  const checks: { label: string; pass: boolean; note: string }[] = [];

  const hsCode = d.hkhs_code ?? d.hs_code;
  checks.push({
    label: "HS/HKHS Code present",
    pass: Boolean(hsCode),
    note: hsCode ? `Code: ${hsCode}` : "Missing HS code — required for TDEC",
  });

  const value = d.total_value_hkd ?? d.value_hkd;
  checks.push({
    label: "Value in HKD present",
    pass: value != null && value > 0,
    note: value != null ? formatHKD(value) : "Missing value — required for duty calculation",
  });

  const dutyRate = d.duty_rate;
  const dutyAmount =
    value != null && dutyRate != null ? value * dutyRate : null;
  checks.push({
    label: "Duty calculation",
    pass: dutyAmount != null,
    note:
      dutyAmount != null
        ? `${((dutyRate ?? 0) * 100).toFixed(1)}% × ${formatHKD(value)} = ${formatHKD(dutyAmount)}`
        : "Duty rate not set — assumed exempt",
  });

  const deadline = decl.filing_deadline;
  if (deadline) {
    const daysUntil =
      (new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    checks.push({
      label: "Deadline status",
      pass: daysUntil > 0,
      note:
        daysUntil > 0
          ? `${daysUntil.toFixed(1)} days remaining (${formatDate(deadline)})`
          : `OVERDUE by ${Math.abs(daysUntil).toFixed(1)} days`,
    });
  }

  checks.push({
    label: "Declaration type set",
    pass: Boolean(d.declaration_type),
    note: d.declaration_type ?? "Missing declaration type",
  });

  return checks;
}

export default async function DeclarationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: declData }, { data: jobsData }] = await Promise.all([
    supabase.from("declarations").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("filing_jobs")
      .select("*")
      .eq("declaration_id", id)
      .order("queued_at", { ascending: false }),
  ]);

  if (!declData) notFound();

  const decl = declData as Declaration;
  const jobs = (jobsData ?? []) as FilingJob[];
  const displayStatus = computeDisplayStatus(decl);
  const d = decl.declaration_data;
  const complianceChecks = computeComplianceChecks(decl);
  const canTrigger = decl.status === "pending" || decl.status === "failed" || decl.status === "manual_required";

  return (
    <div className="flex flex-col" style={{ minHeight: "100%" }}>
      {/* Page header */}
      <div
        className="px-8 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div className="mb-2">
          <Link
            href="/dashboard/declarations"
            className="inline-flex items-center gap-1.5 font-mono text-xs transition-colors"
            style={{ color: "#4a5a6d" }}
          >
            <ArrowLeft className="h-3 w-3" />
            Declarations
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-base font-bold tracking-tight text-white">
            {id}
          </h1>
          <StatusBadge status={displayStatus} />
        </div>
        <p className="mt-0.5 text-xs" style={{ color: "#4a5a6d" }}>
          Created {formatDate(decl.created_at)} · Updated{" "}
          {formatDate(decl.updated_at)}
        </p>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-5 px-8 py-6">
        {/* Actions row */}
        <DeclarationActions
          declarationId={id}
          canTrigger={canTrigger}
          tradelinkRef={decl.tradelink_ref}
        />

        {/* Declaration data */}
        <Section title="Declaration Fields">
          <DetailRow label="Consignee" value={d.consignee ?? d.declarant_name} />
          <DetailRow label="Shipment Ref" value={d.shipment_ref} />
          <DetailRow label="Declaration Type" value={d.declaration_type} />
          <DetailRow
            label="Departure Date"
            value={d.departure_date ?? d.trade_date}
          />
          <DetailRow label="Country of Origin" value={d.country_of_origin} />
          <DetailRow
            label="Country of Destination"
            value={d.country_of_destination}
          />
          <DetailRow label="HKHS / HS Code" value={d.hkhs_code ?? d.hs_code} />
          <DetailRow label="Goods Description" value={d.goods_description} />
          <DetailRow
            label="Quantity"
            value={
              d.quantity != null
                ? `${d.quantity} ${d.unit ?? ""}`
                : undefined
            }
          />
          <DetailRow
            label="Value (HKD)"
            value={formatHKD(d.total_value_hkd ?? d.value_hkd)}
          />
          <DetailRow
            label="Duty Rate"
            value={
              d.duty_rate != null
                ? `${(d.duty_rate * 100).toFixed(2)}%`
                : "Not set (exempt)"
            }
          />
          <DetailRow label="Filing Deadline" value={formatDate(decl.filing_deadline)} />
          <DetailRow label="Tradelink Ref" value={decl.tradelink_ref} />
          <DetailRow label="Filed At" value={formatDate(decl.filed_at)} />
        </Section>

        {/* Compliance checks */}
        <Section title="Compliance Checks">
          {complianceChecks.map((check) => (
            <div
              key={check.label}
              className="grid grid-cols-[180px_1fr_1fr] items-center gap-4 py-2.5"
              style={{ borderBottom: "1px solid #1a2d40" }}
            >
              <span
                className="font-mono text-[11px] uppercase tracking-widest"
                style={{ color: "#4a5a6d" }}
              >
                {check.label}
              </span>
              <span
                className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: check.pass ? "#4ade80" : "#f87171" }}
              >
                {check.pass ? "✓ PASS" : "✗ FAIL"}
              </span>
              <span className="text-xs" style={{ color: "#8a9a8c" }}>
                {check.note}
              </span>
            </div>
          ))}
        </Section>

        {/* Filing job history */}
        <Section title={`Filing Job History (${jobs.length})`}>
          {jobs.length === 0 ? (
            <p
              className="py-6 text-center font-mono text-xs"
              style={{ color: "#4a5a6d" }}
            >
              No filing jobs for this declaration yet.
            </p>
          ) : (
            jobs.map((job) => (
              <div
                key={job.id}
                className="py-3"
                style={{ borderBottom: "1px solid #1a2d40" }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                    style={{
                      color:
                        job.status === "completed"
                          ? "#4ade80"
                          : job.status === "failed"
                            ? "#f87171"
                            : job.status === "running"
                              ? "#60a5fa"
                              : "#8a9a8c",
                    }}
                  >
                    {job.status.toUpperCase()}
                  </span>
                  <span
                    className="font-mono text-xs"
                    style={{ color: "#4a5a6d" }}
                  >
                    {formatDate(job.queued_at)}
                  </span>
                  {job.portal_ref && (
                    <span
                      className="ml-auto font-mono text-xs"
                      style={{ color: "#4ade80" }}
                    >
                      Portal Ref: {job.portal_ref}
                    </span>
                  )}
                </div>
                {job.skyvern_task_id && (
                  <p
                    className="mt-0.5 font-mono text-[11px]"
                    style={{ color: "#4a5a6d" }}
                  >
                    Task: {job.skyvern_task_id} · Retries:{" "}
                    {job.retry_count}/{job.max_retries}
                  </p>
                )}
                {job.last_error_msg && (
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "#f87171" }}
                  >
                    {job.last_error_code}: {job.last_error_msg}
                  </p>
                )}
                {job.audit_log.length > 0 && (
                  <div className="mt-2">
                    <p
                      className="mb-1 font-mono text-[10px] uppercase tracking-widest"
                      style={{ color: "#243447" }}
                    >
                      Audit Log
                    </p>
                    <div
                      className="rounded p-2 space-y-0.5"
                      style={{
                        background: "#06111a",
                        border: "1px solid #1a2d40",
                        fontFamily: "monospace",
                        fontSize: 11,
                      }}
                    >
                      {job.audit_log.map((entry, i) => (
                        <div key={i} className="flex gap-3">
                          <span style={{ color: "#243447", flexShrink: 0 }}>
                            {new Date(entry.ts).toLocaleTimeString("en-HK", {
                              hour12: false,
                            })}
                          </span>
                          <span
                            style={{
                              color: entry.success ? "#4a5a6d" : "#f87171",
                              flexShrink: 0,
                              minWidth: 80,
                            }}
                          >
                            [{entry.stage.toUpperCase()}]
                          </span>
                          <span
                            style={{
                              color: entry.success ? "#8a9a8c" : "#f87171",
                            }}
                          >
                            {entry.msg}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Raw extraction */}
        <div id="raw-extraction">
          <Section title="Raw Declaration Data (JSON)">
            <pre
              className="overflow-x-auto py-4 text-[11px] leading-relaxed"
              style={{
                color: "#8a9a8c",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {JSON.stringify(decl.declaration_data, null, 2)}
            </pre>
          </Section>
        </div>
      </div>
    </div>
  );
}
