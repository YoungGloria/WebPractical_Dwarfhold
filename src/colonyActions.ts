import type { ColonyState, JobType, ResourceKey } from "./types";
import { jobLabel } from "./simulation";
import { log } from "./stateUtils";

export function assignJob(
  state: ColonyState,
  id: string,
  job: JobType,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === id);
  if (!dwarf) return state;

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

export function craftToolAction(state: ColonyState): ColonyState {
  if (state.resources.wood < 3 || state.resources.stone < 2) {
    return log(state, "The forge needs more timber and stone.", "warning");
  }

  return log(
    {
      ...state,
      resources: {
        ...state.resources,
        wood: state.resources.wood - 3,
        stone: state.resources.stone - 2,
        tools: state.resources.tools + 1,
      },
    },
    "A sturdy iron tool joins the stores.",
    "good",
  );
}

export function startExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  destination: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf) return state;

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
  const resources = Object.entries(rewards).reduce(
    (all, [key, amount]) => ({
      ...all,
      [key]: all[key as ResourceKey] + (amount ?? 0),
    }),
    state.resources,
  );

  const dwarves = state.dwarves.map((d) =>
    d.id === dwarfId
      ? {
          ...d,
          status: d.assignment ? ("working" as const) : ("idle" as const),
        }
      : d,
  );

  return log({ ...state, resources, dwarves }, message, "good");
}

export function failExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  errorMessage: string,
): ColonyState {
  const dwarves = state.dwarves.map((d) =>
    d.id === dwarfId
      ? {
          ...d,
          status: d.assignment ? ("working" as const) : ("idle" as const),
        }
      : d,
  );

  return log({ ...state, dwarves }, errorMessage, "warning");
}
