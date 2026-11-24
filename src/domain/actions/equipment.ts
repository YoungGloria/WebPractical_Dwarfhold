import type { ColonyState } from "../types";
import { log } from "../log";

export function toggleToolAction(
  state: ColonyState,
  dwarfId: string,
  toolEquipped: boolean,
  message: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf) return state;
  if (dwarf.hasTool !== toolEquipped) return state;
  if (!toolEquipped && state.resources.tools <= 0) return state;

  const newState = {
    ...state,
    resources: {
      ...state.resources,
      tools: toolEquipped
        ? state.resources.tools + 1
        : state.resources.tools - 1,
    },
    dwarves: state.dwarves.map((item) =>
      item.id === dwarfId ? { ...item, hasTool: !toolEquipped } : item,
    ),
  };

  return log(newState, message);
}
