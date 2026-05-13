import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminEnv } from "./server-env";

export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient can only be used on the server.");
  }

  const { supabaseUrl, supabaseServiceRoleKey } = getSupabaseAdminEnv();

  return createSupabaseClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}
