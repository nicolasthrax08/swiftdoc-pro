"use client";

import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/useMountEffect";

const NIGHT_INK = "#0b1b2b";
const SAGE = "#8a9a8c";
const MUTED = "#4a5a6d";
const BORDER = "#243447";

const SKYVERN_EVENTS = [
  "[Vault] Keys Retrieved",
  "[Agent] Injecting HS Code",
  "[Status] 14-Day Watchdog Clear",
] as const;

function formatTs(d: Date): string {
  return d.toLocaleTimeString("en-HK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

type LogRow = { id: string; at: Date; text: (typeof SKYVERN_EVENTS)[number] };

export function AutomationMonitor() {
  const [lines, setLines] = useState<LogRow[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const indexRef = useRef(0);

  useMountEffect(() => {
    const pushNext = () => {
      const text = SKYVERN_EVENTS[indexRef.current % SKYVERN_EVENTS.length];
      indexRef.current += 1;
      const row: LogRow = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        at: new Date(),
        text,
      };
      setLines((prev) => {
        const next = [...prev, row];
        const trimmed = next.length > 80 ? next.slice(-80) : next;
        window.setTimeout(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        }, 0);
        return trimmed;
      });
    };

    pushNext();
    const id = window.setInterval(pushNext, 2600);

    return () => window.clearInterval(id);
  });

  return (
    <div
      className="flex flex-col overflow-hidden rounded"
      style={{
        background: NIGHT_INK,
        border: `1px solid ${BORDER}`,
        minHeight: 280,
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-2.5"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div className="flex gap-1.5" aria-hidden>
          <span
            className="h-3 w-3 rounded-full"
            style={{ background: "#3d1a1a" }}
          />
          <span
            className="h-3 w-3 rounded-full"
            style={{ background: "#3d2d0a" }}
          />
          <span
            className="h-3 w-3 rounded-full"
            style={{ background: SAGE }}
          />
        </div>
        <span className="font-mono text-xs" style={{ color: MUTED }}>
          Automation Monitor — Skyvern stream
        </span>
        <span
          className="ml-auto flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider"
          style={{ color: SAGE }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ background: SAGE }}
            aria-hidden
          />
          Live
        </span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3"
        style={{
          background: NIGHT_INK,
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.75,
        }}
      >
        {lines.length === 0 ? (
          <p style={{ color: MUTED }}>
            <span aria-hidden>{"> "}</span>
            Awaiting automation events…
          </p>
        ) : (
          lines.map((row) => (
            <div key={row.id} className="flex items-start gap-3">
              <span
                className="tabular-nums"
                style={{ color: MUTED, flexShrink: 0, minWidth: 72 }}
              >
                {formatTs(row.at)}
              </span>
              <span className="min-w-0 flex-1" style={{ color: SAGE }}>
                <span className="select-all">{row.text}</span>
                <span
                  className="ml-2 inline-flex items-center gap-1 align-middle font-mono text-[10px] uppercase tracking-wide"
                  style={{ color: SAGE, opacity: 0.85 }}
                  aria-label="Success"
                >
                  <span
                    className="inline-block h-1 w-1 rounded-full"
                    style={{ background: SAGE }}
                    aria-hidden
                  />
                  ok
                </span>
              </span>
            </div>
          ))
        )}

        <div
          className="mt-1 flex items-center gap-2 pt-0.5"
          style={{ color: SAGE }}
          aria-hidden
        >
          <span>{">"}</span>
          <span
            className="inline-block h-3 w-px animate-pulse"
            style={{ background: SAGE }}
          />
        </div>
      </div>
    </div>
  );
}
