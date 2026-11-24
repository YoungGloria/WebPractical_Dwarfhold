import type { ColonyState, Resources } from "../types";
import { isFamine } from "../rules/famine";
import { projectedOutput } from "../rules/production";
import { log } from "../log";

export function advanceDay(state: ColonyState): ColonyState {
  const resources = { ...state.resources };

  if (isFamine(state)) {
    state = log(
      state,
      "There is a Famine in your colony. The productivity of your dwarves was reduced.",
      "warning",
    );
  }

  const output = projectedOutput(state);
  Object.entries(output).forEach(([resource, amount]) => {
    const key = resource as keyof Resources;
    resources[key] = Math.max(0, resources[key] + (amount ?? 0));
  });

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
