import type { ColonyState, Dwarf, JobType, Resources } from "./types";
import { isFamine } from "./utils";
import { log } from "./stateUtils";

// Constants for simulation
// TODO: link all related input to these constants
export const DAY_MS = 8_000;
export const FORGE_TOOL_SECONDS = 5;
export const EXPEDITION_SECONDS = 5;
export const FORGE_WEAPON_SECONDS = 7;

export const production: Record<Exclude<JobType, null>, Partial<Resources>> = {
  woodcutting: { wood: 3 },
  mining: { stone: 2 },
  farming: { food: 4 },
};

export const isProducing = (dwarf: Dwarf) =>
  dwarf.assignment !== null &&
  dwarf.status !== "expedition" &&
  dwarf.status !== "resting" &&
  dwarf.status !== "forging_Tool" &&
  dwarf.status !== "forging_Weapon";

export function advanceDay(state: ColonyState): ColonyState {
  const resources = { ...state.resources };
  let famineModefier = 0;

  if (isFamine(state)) {
    famineModefier -= 1;
    state = log(
      state,
      "There is a Famine in your colony. The productivity of your dwarves was reduced.",
      "warning",
    );
  }

  state.dwarves.forEach((dwarf) => {
    if (!dwarf.assignment || !isProducing(dwarf)) return;

    const output = production[dwarf.assignment];
    Object.entries(output).forEach(([resource, amount]) => {
      amount = amount ? amount + famineModefier : 0;
      if (dwarf.hasTool) amount += 1;
      resources[resource as keyof Resources] += amount;
    });
  });

  resources.food = Math.max(0, resources.food - state.dwarves.length);

  const dwarves = state.dwarves.map((dwarf) =>
    dwarf.status === "resting"
      ? {
          ...dwarf,
          status: dwarf.assignment ? ("working" as const) : ("idle" as const),
        }
      : dwarf,
  );

  return { ...state, day: state.day + 1, resources, dwarves };
}

export const jobLabel = (job: JobType) =>
  job
    ? {
        woodcutting: "Woodcutting",
        mining: "Deep Mining",
        farming: "Mushroom Farm",
      }[job]
    : "Unassigned";

// Helper functions to display dynamic daytime statements
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
  const totalSeconds = DAY_MS / 1_000;
  const secondsPerPhase = totalSeconds / phases.length;
  const index = Math.floor(elapsedSeconds / secondsPerPhase);

  return phases[index] ?? phases[0];
}
