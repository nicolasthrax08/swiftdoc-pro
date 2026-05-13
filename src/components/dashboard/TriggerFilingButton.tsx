"use client";

import { useState } from "react";
import { Zap, Loader2 } from "lucide-react";

interface TriggerFilingButtonProps {
  declarationId: string;
  disabled?: boolean;
}

export function TriggerFilingButton({
  declarationId,
  disabled = false,
}: TriggerFilingButtonProps) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string>("");

  async function handleTrigger() {
    setState("loading");
    setMessage("");

    try {
      const res = await fetch("/api/filing/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ declarationId }),
      });

      const json = (await res.json()) as { error?: string; jobId?: string };

      if (!res.ok) {
        setState("error");
        setMessage(json.error ?? `HTTP ${res.status}`);
      } else {
        setState("success");
        setMessage(`Job created: ${json.jobId ?? "OK"}`);
      }
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleTrigger}
        disabled={disabled || state === "loading" || state === "success"}
        className="inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
        style={{
          background: state === "success" ? "#0a2d1a" : "#4a5a6d",
          color: state === "success" ? "#4ade80" : "#ffffff",
          border: `1px solid ${state === "success" ? "#1a5a30" : "#6a7a8d"}`,
          cursor:
            disabled || state === "loading" || state === "success"
              ? "not-allowed"
              : "pointer",
        }}
      >
        {state === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        {state === "success"
          ? "Filing Triggered"
          : state === "loading"
            ? "Triggering…"
            : "Trigger Filing"}
      </button>
      {message && (
        <p
          className="font-mono text-xs"
          style={{ color: state === "error" ? "#f87171" : "#4ade80" }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
