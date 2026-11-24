import type { ColonyState } from "../types";

export function isFamine(state: ColonyState): boolean {
  return state.resources.food - state.dwarves.length < 0;
}
