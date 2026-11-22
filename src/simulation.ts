import type { ColonyState, Dwarf, JobType, Resources } from "./types";
import {isFamine} from "./utils";

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
  const dwarves = state.dwarves.map((dwarf) =>
    dwarf.status === "resting"
      ? {
          ...dwarf,
          status: dwarf.assignment ? ("working" as const) : ("idle" as const),
        }
      : dwarf,
  );

    let modifier = 0;

  dwarves.forEach((dwarf) => {
    if (!dwarf.assignment || !isProducing(dwarf)) return; // Skip dwarves without an assignment or on an expedition

      if(dwarf.wasOnExpedition) {
          dwarf.wasOnExpedition = false;
          return;
      }
    const output = production[dwarf.assignment];

    if(isFamine(state)) { modifier -= 1; }

    Object.entries(output).forEach(([resource, amount]) => {
      resources[resource as keyof Resources] += amount ? amount + modifier : 0;
    });
  });

  resources.food = Math.max(0, resources.food - state.dwarves.length);

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
