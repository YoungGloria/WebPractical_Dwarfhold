import { DAY_MS } from "../../config/constants";

export type DayPhase = "EARLY MORNING" | "LUNCHTIME" | "DEEP DAY" | "EVENING";

export function getDayPhase(elapsedMs: number): DayPhase {
  const phases = [
    "EARLY MORNING",
    "LUNCHTIME",
    "DEEP DAY",
    "EVENING",
  ] as const satisfies readonly DayPhase[];

  const clampedMs = Math.max(0, Math.min(elapsedMs, DAY_MS - 1));
  const elapsedSeconds = clampedMs / 1_000;
  const secondsPerPhase = DAY_MS / 1_000 / phases.length;
  const index = Math.floor(elapsedSeconds / secondsPerPhase);

  return phases[index] ?? phases[0];
}
