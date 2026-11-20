import type { ExpeditionResult } from "./types";
export async function beginExpedition(dwarfId: string, destination: string): Promise<ExpeditionResult> {
  const response = await fetch("/api/expeditions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dwarfId, destination }) });
  if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? `Expedition failed (${response.status})`);
  return response.json() as Promise<ExpeditionResult>;
}
