"use client";

import { ExternalLink } from "lucide-react";
import { TriggerFilingButton } from "./TriggerFilingButton";

interface DeclarationActionsProps {
  declarationId: string;
  canTrigger: boolean;
  tradelinkRef?: string | null;
}

export function DeclarationActions({
  declarationId,
  canTrigger,
  tradelinkRef,
}: DeclarationActionsProps) {
  function scrollToRaw() {
    document
      .getElementById("raw-extraction")
      ?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded p-4"
      style={{ background: "#0b1b2b", border: "1px solid #243447" }}
    >
      <TriggerFilingButton declarationId={declarationId} disabled={!canTrigger} />

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium"
        style={{
          background: "transparent",
          color: "#8a9a8c",
          border: "1px solid #243447",
          cursor: "not-allowed",
          opacity: 0.6,
        }}
        disabled
        title="Mark as Manual — coming soon"
      >
        Mark as Manual
      </button>

      <button
        type="button"
        onClick={scrollToRaw}
        className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors"
        style={{
          background: "transparent",
          color: "#8a9a8c",
          border: "1px solid #243447",
          cursor: "pointer",
        }}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        View Raw Extraction
      </button>

      {tradelinkRef && (
        <span
          className="ml-auto font-mono text-xs"
          style={{ color: "#4ade80" }}
        >
          Tradelink Ref: {tradelinkRef}
        </span>
      )}
    </div>
  );
}
