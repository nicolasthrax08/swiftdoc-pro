/**
 * Tradelink credential retrieval from Supabase Vault.
 *
 * SECURITY RULES:
 *  - Credentials are retrieved via a service-role RPC call only.
 *  - The returned object is used in-process and must never be logged,
 *    serialised to a response body, or stored outside Vault.
 *  - All audit log entries must use [REDACTED] in place of credentials.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface TradelinkCredential {
  username: string;
  /** Decrypted password — handle with care, do not log */
  password: string;
  credId: string;
}

/**
 * Retrieve decrypted Tradelink credentials for a tenant from Supabase Vault.
 * Throws if credentials are not found or the Vault lookup fails.
 *
 * @param tenantId   - UUID of the tenant
 * @param environment - "staging" | "production" (default: determined from env var)
 */
export async function getTradelinkCredential(
  tenantId: string,
  environment?: "staging" | "production",
): Promise<TradelinkCredential> {
  const env =
    environment ??
    (process.env.TRADELINK_ENVIRONMENT === "production"
      ? "production"
      : "staging");

  const admin = createAdminClient();

  // Use the security-definer Postgres function to retrieve credentials.
  // The service-role client bypasses RLS; the function itself restricts
  // access to the service role only.
  const { data, error } = await admin.rpc(
    "get_tradelink_credential_for_tenant",
    {
      p_tenant_id: tenantId,
      p_environment: env,
    },
  );

  if (error) {
    // Map Postgres error to a safe message (never expose raw error detail)
    const msg = error.message ?? "";
    if (msg.includes("No Tradelink credentials found")) {
      throw new CredentialError(
        "CREDENTIAL_NOT_FOUND",
        `No Tradelink credentials configured for tenant ${tenantId} (${env})`,
      );
    }
    if (msg.includes("Vault secret not found")) {
      throw new CredentialError(
        "CREDENTIAL_VAULT_ERROR",
        "Vault secret reference is invalid or was deleted",
      );
    }
    throw new CredentialError(
      "CREDENTIAL_VAULT_ERROR",
      "Vault credential retrieval failed",
    );
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.username || !row?.password) {
    throw new CredentialError(
      "CREDENTIAL_VAULT_ERROR",
      "Vault returned an empty credential record",
    );
  }

  return {
    username: row.username as string,
    password: row.password as string,
    credId: row.cred_id as string,
  };
}

export class CredentialError extends Error {
  constructor(
    public readonly code: "CREDENTIAL_NOT_FOUND" | "CREDENTIAL_VAULT_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "CredentialError";
  }
}
