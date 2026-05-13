import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "src");
const LOCALHOST_PATTERN = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/g;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

function isIgnoredPath(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  return (
    normalized.includes("/__tests__/") ||
    normalized.endsWith(".test.ts") ||
    normalized.endsWith(".test.tsx") ||
    normalized.endsWith(".spec.ts") ||
    normalized.endsWith(".spec.tsx") ||
    normalized.endsWith(".server.ts") ||
    normalized.endsWith(".server.tsx") ||
    normalized.includes("/src/actions/") ||
    normalized.includes("/app/api/") ||
    normalized.includes("/app/auth/callback/") ||
    normalized.includes("/docs/") ||
    normalized.endsWith("/src/proxy.ts") ||
    normalized.endsWith("/src/lib/supabase/proxy.ts") ||
    normalized.endsWith("/src/lib/supabase/server.ts") ||
    normalized.endsWith("/src/lib/supabase/server-env.ts")
  );
}

function collectSourceFiles(directory) {
  let files = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files = files.concat(collectSourceFiles(entryPath));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entryPath))) {
      continue;
    }
    if (isIgnoredPath(entryPath)) {
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function isServerOnlySource(contents) {
  const source = contents.trimStart();
  return (
    /^["']use server["']\s*;?/.test(source) ||
    source.includes('from "next/headers"') ||
    source.includes("from 'next/headers'") ||
    source.includes('from "next/server"') ||
    source.includes("from 'next/server'")
  );
}

const findings = [];
for (const filePath of collectSourceFiles(SOURCE_DIR)) {
  const contents = readFileSync(filePath, "utf8");
  if (isServerOnlySource(contents)) {
    continue;
  }
  const lines = contents.split(/\r?\n/);
  lines.forEach((line, index) => {
    LOCALHOST_PATTERN.lastIndex = 0;
    if (!LOCALHOST_PATTERN.test(line)) {
      return;
    }
    findings.push(
      `${path.relative(ROOT, filePath)}:${index + 1}: avoid hardcoded localhost in browser-facing code`,
    );
  });
}

if (findings.length > 0) {
  console.error(
    "Browser-facing code must use relative URLs for same-origin Next calls or env-provided proxy URLs for local services.",
  );
  console.error(findings.join("\n"));
  process.exit(1);
}
