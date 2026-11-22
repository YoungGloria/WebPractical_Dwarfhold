import type { ExpeditionResult } from "./types";

export class RetryableError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOnce(
  dwarfId: string,
  destination: string,
  requestId: string,
  timeoutMs: number,
): Promise<ExpeditionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/api/expeditions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dwarfId, destination, requestId }),
      signal: controller.signal,
    });
    // Catch errors that do not return a valid JSON response, such as 500 Internal Server Error
    if (!response.ok) {
      const rawBody: unknown = await response.json().catch(() => ({}));
      const errorMessage =
        typeof rawBody === "object" &&
        rawBody !== null &&
        "error" in rawBody &&
        typeof rawBody.error === "string"
          ? rawBody.error
          : `Expedition failed (${response.status})`;

      throw new Error(errorMessage);
    }

    return (await response.json()) as ExpeditionResult;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RetryableError("Expedition timed out.", { cause: error });
    }
    if (error instanceof TypeError) {
      throw new RetryableError(error.message, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function beginExpedition(
  dwarfId: string,
  destination: string,
  requestId: string,
  {
    retries = 2,
    timeoutMs = 10_000,
  }: {
    retries?: number;
    timeoutMs?: number;
  } = {},
): Promise<ExpeditionResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await sendOnce(
        dwarfId,
        destination,
        requestId,
        timeoutMs,
      );
    } catch (error) {
      if (!(error instanceof RetryableError) || attempt >= retries) throw error;
      await sleep(500 * 2 ** attempt); // Exponential backoff: 500ms, 1000ms, etc.
    }
  }
}
