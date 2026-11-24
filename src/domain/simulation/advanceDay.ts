import type { ColonyState, Resources } from "../types";
import { production } from "../../config/jobs";
import { isFamine } from "../rules/famine";
import { isProducing } from "../rules/availability";
import { log } from "../log";

export function advanceDay(state: ColonyState): ColonyState {
  const resources = { ...state.resources };
  let famineModifier = 0;

  if (isFamine(state)) {
    famineModifier -= 1;
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
      let yieldAmount = amount ?? 0;
      yieldAmount += famineModifier;
      if (dwarf.hasTool) yieldAmount += 1;
      if (dwarf.species === "knight") yieldAmount += 1;
      resources[resource as keyof Resources] += yieldAmount;
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
