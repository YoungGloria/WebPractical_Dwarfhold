import type { ExpeditionResult } from "./types";

export async function beginExpedition(
  dwarfId: string,
  destination: string,
  requestId: string,
  timeoutMs = 10000,
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
    // workaround to catch errors that do not return a valid JSON response, such as 500 Internal Server Error
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
      throw new Error("Expedition timed out.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
