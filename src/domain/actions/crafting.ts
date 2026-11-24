import type { ColonyState } from "../types";
import { log } from "../log";
import { canForge } from "../rules/availability";

export function craftToolAction(
  state: ColonyState,
  dwarfId: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf || !canForge(dwarf)) return state;
  if (state.resources.wood < 3 || state.resources.stone < 2) return state;

  return log(
    {
      ...state,
      resources: {
        ...state.resources,
        wood: state.resources.wood - 3,
        stone: state.resources.stone - 2,
      },
      dwarves: state.dwarves.map((d) =>
        d.id === dwarfId ? { ...d, status: "forging_Tool" as const } : d,
      ),
    },
    `${dwarf.name} started forging a beautiful tool.`,
    "good",
  );
}

export function completeCraftToolAction(
  state: ColonyState,
  dwarfId: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (dwarf?.status !== "forging_Tool") return state;

  return log(
    {
      ...state,
      resources: { ...state.resources, tools: state.resources.tools + 1 },
      dwarves: state.dwarves.map((d) =>
        d.id === dwarfId ? { ...d, status: "resting" as const } : d,
      ),
    },
    `${dwarf.name} completed the tool and is resting until tomorrow.`,
    "good",
  );
}

export function craftWeaponAction(
  state: ColonyState,
  dwarfId: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf || !canForge(dwarf)) return state;
  if (state.resources.wood < 4 || state.resources.stone < 3) return state;

  return log(
    {
      ...state,
      resources: {
        ...state.resources,
        wood: state.resources.wood - 4,
        stone: state.resources.stone - 3,
      },
      dwarves: state.dwarves.map((d) =>
        d.id === dwarfId ? { ...d, status: "forging_Weapon" as const } : d,
      ),
    },
    `${dwarf.name} started forging a beautiful weapon.`,
    "good",
  );
}

export function completeCraftWeaponAction(
  state: ColonyState,
  dwarfId: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (dwarf?.status !== "forging_Weapon") return state;

  return log(
    {
      ...state,
      resources: { ...state.resources, weapons: state.resources.weapons + 1 },
      dwarves: state.dwarves.map((d) =>
        d.id === dwarfId ? { ...d, status: "resting" as const } : d,
      ),
    },
    `${dwarf.name} completed the Weapon and is resting until tomorrow.`,
    "good",
  );
}
