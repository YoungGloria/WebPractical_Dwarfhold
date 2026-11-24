import type { ColonyState, ResourceKey } from "../types";
import { log } from "../log";
import { canScout } from "../rules/availability";
import { recruitSirOneUper } from "./recruitment";

export function startExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  destination: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (!dwarf || !canScout(dwarf)) return state;

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
  shouldRecruitSirOneUper = false,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (dwarf?.status !== "expedition") return state;

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

  let next = { ...state, resources, dwarves };
  if (shouldRecruitSirOneUper) next = recruitSirOneUper(next);

  return log(next, message, "good");
}

export function failExpeditionAction(
  state: ColonyState,
  dwarfId: string,
  errorMessage: string,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === dwarfId);
  if (dwarf?.status !== "expedition") return state;

  const dwarves = state.dwarves.map((d) =>
    d.id === dwarfId ? { ...d, status: "resting" as const } : d,
  );

  return log({ ...state, dwarves }, errorMessage, "warning");
}
