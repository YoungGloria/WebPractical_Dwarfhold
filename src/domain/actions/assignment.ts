import type { ColonyState, JobType } from "../types";
import { jobLabel } from "../../simulation";
import { log } from "../log";
import { canAssignJob } from "../rules/availability";

export function assignJob(
  state: ColonyState,
  id: string,
  job: JobType,
): ColonyState {
  const dwarf = state.dwarves.find((d) => d.id === id);
  if (!dwarf || !canAssignJob(dwarf)) return state;

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
