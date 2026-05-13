const MISSING_SUPABASE_SERVER_ENV_ERROR =
  "Missing Supabase server env. Set SUPABASE_URL, GIC_SERVER_SUPABASE_URL, or NEXT_PUBLIC_SUPABASE_URL with SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY.";
const MISSING_SUPABASE_ADMIN_ENV_ERROR =
  "Missing Supabase admin env. Set SUPABASE_SERVICE_ROLE_KEY and a server Supabase URL.";

interface LocalService {
  alias?: unknown;
  port?: unknown;
  scheme?: unknown;
}

function getSandboxLocalSupabaseUrl(): string | undefined {
  const rawServices = process.env.GIC_BROWSER_LOCAL_SERVICES_JSON;
  if (!rawServices) {
    return undefined;
  }

  let services: unknown;
  try {
    services = JSON.parse(rawServices);
  } catch {
    return undefined;
  }

  if (!Array.isArray(services)) {
    return undefined;
  }

  for (const rawService of services) {
    if (!rawService || typeof rawService !== "object") {
      continue;
    }

    const service = rawService as LocalService;
    const alias =
      typeof service.alias === "string" ? service.alias.trim().toLowerCase() : "";
    if (alias !== "supabase") {
      continue;
    }

    const port =
      typeof service.port === "number" ? service.port : Number(service.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      continue;
    }

    const scheme = service.scheme === "https" ? "https" : "http";
    return `${scheme}://127.0.0.1:${port}`;
  }

  return undefined;
}

function isBrowserServiceProxyUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).pathname.includes("/proxy/browser/service/");
  } catch {
    return false;
  }
}

function getServerSupabaseUrl(): string | undefined {
  const configuredServerUrl = process.env.SUPABASE_URL;
  const sandboxServerUrl =
    process.env.GIC_SERVER_SUPABASE_URL || getSandboxLocalSupabaseUrl();

  if (sandboxServerUrl) {
    return sandboxServerUrl;
  }

  if (configuredServerUrl && !isBrowserServiceProxyUrl(configuredServerUrl)) {
    return configuredServerUrl;
  }

  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseServerEnv() {
  const supabaseUrl = getServerSupabaseUrl();
  const supabaseAnonKey =
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(MISSING_SUPABASE_SERVER_ENV_ERROR);
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
  };
}

export function getSupabaseAdminEnv() {
  const supabaseUrl = getServerSupabaseUrl();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(MISSING_SUPABASE_ADMIN_ENV_ERROR);
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
  };
}
