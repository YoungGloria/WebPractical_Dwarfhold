import { useEffect, useState, type ReactNode } from "react";
import { beginExpedition } from "../api";
import { createInitialState } from "../initialState";
import { advanceDay } from "../simulation";
import type { JobType } from "../types";
import {
  assignJob,
  completeExpeditionAction,
  craftToolAction,
  failExpeditionAction,
  startExpeditionAction,
} from "../colonyActions";
import { ColonyContext, type ColonyContextValue } from "./ColonyContext";

export function ColonyProvider({ children }: { children: ReactNode }) {
  const [colony, setColony] = useState(createInitialState);
  const [paused, setPaused] = useState(false);
  const [expeditionPending, setExpeditionPending] = useState(false);

  useEffect(() => {
    if (paused) return;

    const timer = window.setInterval(
      () => setColony((current) => advanceDay(current)),
      8_000,
    );

    return () => window.clearInterval(timer);
  }, [paused]);

  function assignDwarf(id: string, assignment: JobType) {
    setColony((current) => assignJob(current, id, assignment));
  }

  function craftTool() {
    setColony((current) => craftToolAction(current));
  }

  async function sendExpedition(dwarfId: string, destination: string) {
    const dwarfExists = colony.dwarves.some((item) => item.id === dwarfId);
    if (!dwarfExists) return;

    setExpeditionPending(true);
    setColony((current) =>
      startExpeditionAction(current, dwarfId, destination),
    );

    try {
      const result = await beginExpedition(dwarfId, destination);
      setColony((current) =>
        completeExpeditionAction(
          current,
          dwarfId,
          result.rewards,
          result.message,
        ),
      );
    } catch (error) {
      setColony((current) =>
        failExpeditionAction(
          current,
          dwarfId,
          error instanceof Error
            ? error.message
            : "The expedition was lost from view.",
        ),
      );
    } finally {
      setExpeditionPending(false);
    }
  }

  const value: ColonyContextValue = {
    colony,
    paused,
    activities: colony.log,
    expeditionPending,
    togglePaused: () => setPaused((value) => !value),
    assignDwarf,
    craftTool,
    sendExpedition,
  };

  return <ColonyContext value={value}>{children}</ColonyContext>;
}
