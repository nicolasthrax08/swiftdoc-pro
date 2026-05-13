/**
 * Skyvern REST API client.
 *
 * Environment variables required:
 *   SKYVERN_API_KEY      – your Skyvern API key
 *   SKYVERN_BASE_URL     – defaults to https://api.skyvern.com
 *
 * All functions are server-side only.
 */

import type {
  SkyvernCreateTaskRequest,
  SkyvernTaskResponse,
} from "./types";

// ----------------------------------------------------------------
// Environment helpers
// ----------------------------------------------------------------

function getSkyvernEnv(): { baseUrl: string; apiKey: string } {
  const apiKey = process.env.SKYVERN_API_KEY;
  const baseUrl =
    process.env.SKYVERN_BASE_URL?.replace(/\/$/, "") ??
    "https://api.skyvern.com";

  if (!apiKey) {
    throw new Error(
      "SKYVERN_API_KEY is not configured. " +
        "Add it to your Vercel / .env.local before triggering filing jobs.",
    );
  }

  return { baseUrl, apiKey };
}

// ----------------------------------------------------------------
// Low-level fetch wrapper
// ----------------------------------------------------------------

async function skyvernFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const { baseUrl, apiKey } = getSkyvernEnv();

  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // Skyvern uses x-api-key header
      "x-api-key": apiKey,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable body)");
    throw new SkyvernApiError(
      `Skyvern API error ${res.status} on ${path}: ${body}`,
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

export class SkyvernApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "SkyvernApiError";
  }

  /** 5xx or network errors are retryable; 4xx are not */
  get isRetryable(): boolean {
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Create a new Skyvern task.
 * Returns the task object including the assigned task_id.
 */
export async function createSkyvernTask(
  req: SkyvernCreateTaskRequest,
): Promise<SkyvernTaskResponse> {
  return skyvernFetch<SkyvernTaskResponse>("/v1/tasks", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

/**
 * Get the current state of a Skyvern task.
 */
export async function getSkyvernTask(
  taskId: string,
): Promise<SkyvernTaskResponse> {
  return skyvernFetch<SkyvernTaskResponse>(`/v1/tasks/${taskId}`);
}

/**
 * Cancel a running Skyvern task.
 */
export async function cancelSkyvernTask(taskId: string): Promise<void> {
  await skyvernFetch(`/v1/tasks/${taskId}/cancel`, { method: "POST" });
}

/**
 * Poll a task until it reaches a terminal status or polling is exhausted.
 *
 * @param taskId - Skyvern task ID to poll
 * @param maxAttempts - maximum poll iterations (default 60 → ~5 min at 5s interval)
 * @param intervalMs - poll interval in ms (default 5 000)
 * @param onPoll - optional callback invoked after each poll with current response
 */
export async function pollSkyvernTask(
  taskId: string,
  {
    maxAttempts = 60,
    intervalMs = 5_000,
    onPoll,
  }: {
    maxAttempts?: number;
    intervalMs?: number;
    onPoll?: (task: SkyvernTaskResponse, attempt: number) => void;
  } = {},
): Promise<SkyvernTaskResponse> {
  const { SKYVERN_TERMINAL_STATUSES } = await import("./types");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const task = await getSkyvernTask(taskId);

    onPoll?.(task, attempt);

    if (SKYVERN_TERMINAL_STATUSES.has(task.status)) {
      return task;
    }

    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  // Return last known state so the caller can decide what to do
  return getSkyvernTask(taskId);
}

/**
 * Returns true if the Skyvern API key is configured (does not validate the key).
 */
export function isSkyvernConfigured(): boolean {
  return Boolean(process.env.SKYVERN_API_KEY);
}
