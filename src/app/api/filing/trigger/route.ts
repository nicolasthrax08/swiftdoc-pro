/**
 * POST /api/filing/trigger
 *
 * Triggers the Skyvern agentic filing pipeline for a declaration.
 * Callable from:
 *   - The SwiftDoc UI (authenticated tenant session)
 *   - A cron job using the FILING_CRON_SECRET header
 *
 * Request body: { declarationId: string }
 *
 * Response 200: { success, jobId, declarationId, tradelinkRef? }
 * Response 4xx/5xx: { error, code }
 *
 * Authentication:
 *   - UI path: valid Supabase session cookie (tenant must own the declaration)
 *   - Cron path: Authorization: Bearer <FILING_CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerEnv } from "@/lib/supabase/server-env";
import { runFilingPipeline } from "@/lib/filing/pipeline";
import { isSkyvernConfigured } from "@/lib/skyvern/client";

export const runtime = "nodejs";
// Long timeout — the pipeline polls Skyvern for up to ~6 minutes.
// Vercel Pro supports up to 300s on server functions.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // ------------------------------------------------------------------
  // Parse body
  // ------------------------------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "INVALID_REQUEST", "Request body must be JSON");
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("declarationId" in body) ||
    typeof (body as Record<string, unknown>).declarationId !== "string"
  ) {
    return errorResponse(
      400,
      "INVALID_REQUEST",
      "Required field: declarationId (string)",
    );
  }

  const declarationId = (body as { declarationId: string }).declarationId;

  // ------------------------------------------------------------------
  // Skyvern availability check
  // ------------------------------------------------------------------
  if (!isSkyvernConfigured()) {
    return errorResponse(
      503,
      "SKYVERN_NOT_CONFIGURED",
      "SKYVERN_API_KEY is not set. Configure it in Vercel environment variables.",
    );
  }

  // ------------------------------------------------------------------
  // Authentication
  // ------------------------------------------------------------------
  const authResult = await authenticate(req, declarationId);
  if (!authResult.ok) {
    return errorResponse(authResult.status, authResult.code, authResult.msg);
  }

  // ------------------------------------------------------------------
  // Run pipeline
  // ------------------------------------------------------------------
  try {
    const result = await runFilingPipeline(declarationId);

    if (result.success) {
      return NextResponse.json(result, { status: 200 });
    }

    // Distinguish client errors from server errors for the caller
    const clientErrorCodes = new Set([
      "DECLARATION_NOT_FOUND",
      "DECLARATION_INVALID_STATE",
      "CREDENTIAL_NOT_FOUND",
    ]);
    const statusCode = clientErrorCodes.has(result.errorCode ?? "") ? 422 : 500;

    return NextResponse.json(
      {
        success: false,
        jobId: result.jobId,
        declarationId: result.declarationId,
        error: result.errorMsg,
        code: result.errorCode,
      },
      { status: statusCode },
    );
  } catch (err) {
    console.error("[api/filing/trigger] Unhandled pipeline error:", err);
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred. Check server logs.",
    );
  }
}

// ----------------------------------------------------------------
// Auth helpers
// ----------------------------------------------------------------

type AuthResult =
  | { ok: true }
  | { ok: false; status: number; code: string; msg: string };

async function authenticate(
  req: NextRequest,
  declarationId: string,
): Promise<AuthResult> {
  // Cron / server-to-server path: Bearer token
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const cronSecret = process.env.FILING_CRON_SECRET;
    if (!cronSecret) {
      return {
        ok: false,
        status: 500,
        code: "CRON_SECRET_NOT_CONFIGURED",
        msg: "FILING_CRON_SECRET is not set",
      };
    }
    if (token !== cronSecret) {
      return {
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        msg: "Invalid cron secret",
      };
    }
    return { ok: true };
  }

  // Browser / UI path: Supabase session cookie
  const cookieStore = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      msg: "Authentication required",
    };
  }

  // Verify the authenticated user owns the declaration (prevents IDOR)
  const admin = createAdminClient();
  const { data: declaration } = await admin
    .from("declarations")
    .select("tenant_id")
    .eq("id", declarationId)
    .single();

  if (!declaration) {
    return {
      ok: false,
      status: 404,
      code: "DECLARATION_NOT_FOUND",
      msg: `Declaration ${declarationId} not found`,
    };
  }

  if (declaration.tenant_id !== user.id) {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      msg: "You do not have permission to file this declaration",
    };
  }

  return { ok: true };
}

function errorResponse(
  status: number,
  code: string,
  msg: string,
): NextResponse {
  return NextResponse.json({ success: false, error: msg, code }, { status });
}
