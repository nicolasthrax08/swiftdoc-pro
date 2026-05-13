export default function SettingsPage() {
  return (
    <div className="flex flex-col" style={{ minHeight: "100%" }}>
      <div
        className="px-8 py-5"
        style={{ borderBottom: "1px solid #243447" }}
      >
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-bold tracking-tight text-white">
            Settings
          </h1>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: "#4a5a6d" }}>
          Platform configuration and credentials.
        </p>
      </div>

      <div className="px-8 py-6">
        <div
          className="rounded p-6 text-center"
          style={{ background: "#0f1e2e", border: "1px solid #243447" }}
        >
          <p className="font-mono text-sm" style={{ color: "#4a5a6d" }}>
            Settings panel coming soon.
          </p>
        </div>
      </div>
    </div>
  );
}
