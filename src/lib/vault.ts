/**
 * Supabase Vault — platform Tradelink credentials
 *
 * Reads named secrets `TRADELINK_ID` and `TRADELINK_PASS` from
 * `vault.decrypted_secrets` via the service-role-only RPC
 * `get_tradelink_vault_env_secrets` (see migration
 * `20260513000004_tradelink_vault_env.sql`).
 *
 * SECURITY:
 * - Call only from server code (Route Handlers, Server Actions, `server` components).
 * - Never return these values from an API response, `use client` props, or logs.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface TradelinkVaultCredentials {
  tradelinkId: string;
  tradelinkPass: string;
}

export class VaultCredentialError extends Error {
  constructor(
    message: string,
    public readonly code: "VAULT_RPC_ERROR" | "VAULT_MISSING_SECRETS",
  ) {
    super(message);
    this.name = "VaultCredentialError";
  }
}

/**
 * Load `TRADELINK_ID` and `TRADELINK_PASS` decrypted values from
 * `vault.decrypted_secrets` through the Vault RPC. Requires
 * `SUPABASE_SERVICE_ROLE_KEY` and matching Vault entries — see migration
 * `20260513000004_tradelink_vault_env.sql`.
 */
export async function getTradelinkVaultCredentials(): Promise<TradelinkVaultCredentials> {
  if (typeof window !== "undefined") {
    throw new Error("getTradelinkVaultCredentials must only run on the server.");
  }

  const admin = createAdminClient();

  const { data, error } = await admin.rpc("get_tradelink_vault_env_secrets");

  if (error) {
    const msg = error.message ?? "";
    if (
      msg.includes("TRADELINK_ID") ||
      msg.includes("TRADELINK_PASS") ||
      msg.includes("missing")
    ) {
      throw new VaultCredentialError(
        "TRADELINK_ID or TRADELINK_PASS is not configured in Vault",
        "VAULT_MISSING_SECRETS",
      );
    }
    throw new VaultCredentialError(
      "Vault credential RPC failed",
      "VAULT_RPC_ERROR",
    );
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (
    !row ||
    typeof (row as { tradelink_id?: unknown }).tradelink_id !== "string" ||
    typeof (row as { tradelink_pass?: unknown }).tradelink_pass !== "string"
  ) {
    throw new VaultCredentialError(
      "Vault returned an incomplete credential payload",
      "VAULT_MISSING_SECRETS",
    );
  }

  const { tradelink_id: tradelinkId, tradelink_pass: tradelinkPass } = row as {
    tradelink_id: string;
    tradelink_pass: string;
  };

  return { tradelinkId, tradelinkPass };
}
