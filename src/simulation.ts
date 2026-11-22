import type { ColonyState, Dwarf, JobType, Resources } from "./types";
import { isFamine } from "./utils";
import { log } from "./stateUtils";

export const production: Record<Exclude<JobType, null>, Partial<Resources>> = {
  woodcutting: { wood: 3 },
  mining: { stone: 2 },
  farming: { food: 4 },
};

export const isProducing = (dwarf: Dwarf) =>
  dwarf.assignment !== null &&
  dwarf.status !== "expedition" &&
  dwarf.status !== "resting" &&
  dwarf.status !== "forging";

export function advanceDay(state: ColonyState): ColonyState {
  const resources = { ...state.resources };
  let modifier = 0;

  if (isFamine(state)) {
    modifier -= 1;
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
      resources[resource as keyof Resources] += amount ? amount + modifier : 0;
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
export type DayPhase = "early_morning" | "lunchtime" | "deep_day" | "evening";

export function getDayPhase(elapsedMs: number): DayPhase {
  const clamped = Math.max(0, Math.min(elapsedMs, 7_999));
  const index = Math.floor(clamped / 2_000); // day (8s) divided into 4 phases (2s each)

  const phases: DayPhase[] = [
    "early_morning",
    "lunchtime",
    "deep_day",
    "evening",
  ];

  return phases[index];
}

export function dayPhaseLabel(phase: DayPhase): string {
  switch (phase) {
    case "early_morning":
      return "EARLY MORNING";
    case "lunchtime":
      return "LUNCHTIME";
    case "deep_day":
      return "DEEP DAY";
    case "evening":
      return "EVENING";
  }
}
