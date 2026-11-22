import { createContext, useContext } from "react";
import type { Activity, ColonyState, JobType } from "../types";
import { DayPhase } from "../simulation";

export interface ColonyContextValue {
  colony: ColonyState;
  paused: boolean;
  dayPhase: DayPhase;
  daySecondsLeft: number;
  activities: Activity[];
  expeditionPending: boolean;
  craftCountdowns: Record<string, number>;
  togglePaused: () => void;
  assignDwarf: (id: string, assignment: JobType) => void;
  craftTool: (dwarfId: string) => void;
  craftWeapon: (dwarfId: string) => void;
  sendExpedition: (dwarfId: string, destination: string) => Promise<void>;
}

export const ColonyContext = createContext<ColonyContextValue | null>(null);

export function useColony(): ColonyContextValue {
  const context = useContext(ColonyContext);
  if (!context) {
    throw new Error("useColony must be used inside <ColonyProvider>");
  }
  return context;
}
