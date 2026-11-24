import type { ColonyState, Dwarf } from "../types";

export const SIR_ONE_UPER: Dwarf = {
  id: "sir-one-uper",
  species: "knight",
  name: "Sir One Uper",
  title: "Produces 1 extra",
  icon: "🤴",
  assignment: null,
  status: "idle",
  hasTool: false,
};

export function recruitSirOneUper(state: ColonyState): ColonyState {
  if (state.sirOneUperJoined) return state;
  if (state.dwarves.some((dwarf) => dwarf.id === SIR_ONE_UPER.id)) return state;

  return {
    ...state,
    dwarves: [...state.dwarves, SIR_ONE_UPER],
    sirOneUperJoined: true,
  };
}
