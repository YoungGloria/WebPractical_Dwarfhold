import type { ColonyState } from "./types";

export function isFamine(ColonyState: ColonyState) {
  return ColonyState.resources.food - ColonyState.dwarves.length < 0;
}
