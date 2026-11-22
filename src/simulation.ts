import type { ColonyState, JobType, Resources } from "./types";
import {isFamine} from "./utils";

export const production: Record<Exclude<JobType, null>, Partial<Resources>> = {
  woodcutting: { wood: 3 },
  mining: { stone: 2 },
  farming: { food: 4 },
};

export function advanceDay(state: ColonyState): ColonyState {
  const resources = { ...state.resources };
  let modifier: number = 0;

  state.dwarves.forEach((dwarf) => {
    if (!dwarf.assignment || dwarf.status === "expedition") return; // Skip dwarves without an assignment or on an expedition
    if(dwarf.wasOnExpedition) {
        dwarf.wasOnExpedition = false;
        return;
    }
    const output = production[dwarf.assignment];

    if(isFamine(state)) {
        modifier -= 1;
    }

    Object.entries(output).forEach(([resource, amount]) => {
      resources[resource as keyof Resources] += amount ? amount + modifier : 0;
    });
  });

  resources.food = Math.max(0, resources.food - state.dwarves.length);

  return { ...state, day: state.day + 1, resources };
}

export const jobLabel = (job: JobType) =>
  job
    ? {
        woodcutting: "Woodcutting",
        mining: "Deep Mining",
        farming: "Mushroom Farm",
      }[job]
    : "Unassigned";
