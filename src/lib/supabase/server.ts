import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseServerEnv } from "./server-env";

interface CreateClientOptions {
  allowCookieWriteFailure?: boolean;
}

export async function createClient(options: CreateClientOptions = {}) {
  const cookieStore = await cookies();
  const allowCookieWriteFailure = options.allowCookieWriteFailure ?? true;
  const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch (error) {
            if (!allowCookieWriteFailure) {
              throw error;
            }

            // Server Components cannot always write cookies. The proxy refreshes
            // auth cookies for request lifecycles that need mutation.
          }
        },
      },
    },
  );
}
