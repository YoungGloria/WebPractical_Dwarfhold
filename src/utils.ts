import type { ColonyState } from "./domain/types";

export function isFamine(ColonyState: ColonyState) {
  return ColonyState.resources.food - ColonyState.dwarves.length < 0;
}
