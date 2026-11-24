import type { Activity, ColonyState } from "./types";

export const MAX_LOG = 8;

export function log(
  state: ColonyState,
  message: string,
  tone?: Activity["tone"],
): ColonyState {
  const nextSeq = state.logSeq + 1;
  const entry: Activity = {
    id: `log-${nextSeq}`,
    day: state.day,
    message,
    tone,
  };

  return {
    ...state,
    log: [entry, ...state.log].slice(0, MAX_LOG),
    logSeq: nextSeq,
  };
}
