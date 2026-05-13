import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function getSafeRedirectPath(requestUrl: URL, nextPath: string | null): string {
  if (!nextPath) {
    return "/";
  }

  try {
    const candidateUrl = new URL(nextPath, requestUrl.origin);
    if (candidateUrl.origin !== requestUrl.origin) {
      return "/";
    }
    if (!candidateUrl.pathname.startsWith("/")) {
      return "/";
    }

    return `${candidateUrl.pathname}${candidateUrl.search}`;
  } catch {
    return "/";
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/", requestUrl.origin));
  }

  const supabase = await createClient({ allowCookieWriteFailure: false });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/", requestUrl.origin));
  }

  const nextPath = getSafeRedirectPath(
    requestUrl,
    requestUrl.searchParams.get("next"),
  );
  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
