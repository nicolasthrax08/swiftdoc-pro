interface SummaryCardProps {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "default" | "red" | "amber" | "blue";
}

const ACCENT_COLORS = {
  default: { value: "#ffffff", sub: "#8a9a8c", border: "#243447" },
  red: { value: "#f87171", sub: "#8a9a8c", border: "#3d1a1a" },
  amber: { value: "#fbbf24", sub: "#8a9a8c", border: "#3d2d0a" },
  blue: { value: "#60a5fa", sub: "#8a9a8c", border: "#1a2d40" },
};

export function SummaryCard({
  label,
  value,
  sub,
  accent = "default",
}: SummaryCardProps) {
  const colors = ACCENT_COLORS[accent];
  return (
    <div
      className="flex flex-col gap-1 rounded p-4"
      style={{
        background: "#132030",
        border: `1px solid ${colors.border}`,
        minWidth: 0,
      }}
    >
      <p
        className="font-mono text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: "#4a5a6d" }}
      >
        {label}
      </p>
      <p
        className="text-3xl font-bold leading-none tracking-tight"
        style={{ color: colors.value }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-xs" style={{ color: colors.sub }}>
          {sub}
        </p>
      )}
    </div>
  );
}
