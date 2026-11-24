import type { ColonyState, Dwarf, JobType, ResourceKey } from "./types";
import { jobLabel } from "./simulation";
import { log } from "./stateUtils";

// Determins if a dwarf will produce resources from basic jobs: woodcutting, mining, farming
const isBusy = (dwarf: Dwarf) =>
  dwarf.status === "expedition" ||
  dwarf.status === "resting" ||
  dwarf.status === "forging_Tool" ||
  dwarf.status === "forging_Weapon";

// Determins if a dwarf is eligable to go on expeditions and forge
const isNoEligableCharacter = (dwarf: Dwarf) =>
  dwarf.status === "expedition" ||
  dwarf.status === "resting" ||
  dwarf.status === "forging_Tool" ||
  dwarf.status === "forging_Weapon" ||
  dwarf.species === "knight";

export function assignJob(
  state: ColonyState,
  id: string,
  job: JobType,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === id);
  if (!dwarf || isBusy(dwarf)) return state;

  const dwarves = state.dwarves.map((d) =>
    d.id === id
      ? {
          ...d,
          assignment: job,
          status: job ? ("working" as const) : ("idle" as const),
        }
      : d,
  );

  return log(
    { ...state, dwarves },
    `${dwarf.name} assigned to ${jobLabel(job)}.`,
  );
}

export function craftToolAction(
  state: ColonyState,
  dwarfId: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf?.specialty || isNoEligableCharacter(dwarf)) return state;

  if (state.resources.wood < 3 || state.resources.stone < 2) {
    return state;
  }

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
      resources: {
        ...state.resources,
        tools: state.resources.tools + 1,
      },
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
  if (!dwarf?.specialty || isNoEligableCharacter(dwarf)) return state;

  if (state.resources.wood < 4 || state.resources.stone < 3) {
    return state;
  }

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
      resources: {
        ...state.resources,
        weapons: state.resources.weapons + 1,
      },
      dwarves: state.dwarves.map((d) =>
        d.id === dwarfId ? { ...d, status: "resting" as const } : d,
      ),
    },
    `${dwarf.name} completed the Weapon and is resting until tomorrow.`,
    "good",
  );
}

/* 
D4 functions for expeditions. May be moved to simulations.ts or seperate file later on
*/

export function startExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  destination: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf || isNoEligableCharacter(dwarf)) return state; // unknown, travelling, resting or forging
  const dwarves = state.dwarves.map((d) =>
    d.id === dwarfId ? { ...d, status: "expedition" as const } : d,
  );

  return log(
    { ...state, dwarves },
    `${dwarf.name} departed for ${destination.replace("-", " ")}.`,
  );
}

export function completeExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  rewards: Partial<Record<ResourceKey, number>>,
  message: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (dwarf?.status !== "expedition") return state; // using optional chaining to check: Dwarf not found or not on an expedition?

  const resources = Object.entries(rewards).reduce(
    (all, [key, amount]) => ({
      ...all,
      [key]: all[key as ResourceKey] + (amount ?? 0),
    }),
    state.resources,
  );

  const dwarves = state.dwarves.map((d) =>
    d.id === dwarfId ? { ...d, status: "resting" as const } : d,
  );

  return log({ ...state, resources, dwarves }, message, "good");
}

export function failExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  errorMessage: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (dwarf?.status !== "expedition") return state; // Using optional chaining to check:Dwarf not found or not on an expedition

  const dwarves = state.dwarves.map((d) =>
    d.id === dwarfId ? { ...d, status: "resting" as const } : d,
  );

  return log({ ...state, dwarves }, errorMessage, "warning");
}

export function toggleToolAction(
  state: ColonyState,
  dwarfId: string,
  toolEquipped: boolean,
  message: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf) return state; // unknown dwarf
  if (dwarf.hasTool !== toolEquipped) return state; // flag does not match current state
  if (!toolEquipped && state.resources.tools <= 0) return state; // no spare tool in inventory

  const newState = {
    ...state,
    resources: {
      ...state.resources,
      tools: toolEquipped
        ? state.resources.tools + 1
        : state.resources.tools - 1,
    },
    dwarves: state.dwarves.map((dwarf) =>
      dwarf.id === dwarfId ? { ...dwarf, hasTool: !toolEquipped } : dwarf,
    ),
  };

  return log(newState, message);
}
