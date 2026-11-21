import { useEffect, useRef, useState, type ReactNode } from "react";
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
  const inFlight = useRef(new Set<string>()); // Track dwarves currently on expeditions

  useEffect(() => {
    if (paused) return;

    const timer = window.setInterval(
      () => setColony((current) => advanceDay(current)),
      8_000,
    );

    return () => window.clearInterval(timer);
  }, [paused]);

  function assignDwarf(id: string, assignment: JobType) {
    const dwarf = colony.dwarves.find((d) => d.id === id);
    if (dwarf?.status === "expedition") return; // Prevent assigning a job to a dwarf on an expedition

    setColony((current) => assignJob(current, id, assignment));
  }

  function craftTool() {
    setColony((current) => craftToolAction(current));
  }

  async function sendExpedition(dwarfId: string, destination: string) {
    const dwarf = colony.dwarves.find((d) => d.id === dwarfId);
    if (dwarf?.status === "expedition" || inFlight.current.has(dwarfId)) return; // Prevent sending a dwarf on an expedition if they are already on one or if the expedition is in flight

    inFlight.current.add(dwarfId);
    setColony((current) =>
      startExpeditionAction(current, dwarfId, destination),
    );

    const requestId = crypto.randomUUID();

    try {
      const result = await beginExpedition(dwarfId, destination, requestId);
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
      inFlight.current.delete(dwarfId);
    }
  }

  const expeditionPending = colony.dwarves.some(
    (d) => d.status === "expedition",
  );

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
