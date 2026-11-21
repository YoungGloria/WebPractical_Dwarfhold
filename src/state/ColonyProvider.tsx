import { useEffect, useRef, useState, type ReactNode } from "react";
import { beginExpedition } from "../api";
import { createInitialState } from "../initialState";
import { advanceDay } from "../simulation";
import type { JobType } from "../types";
import {
  assignJob,
  completeCraftToolAction,
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
  const craftTimers = useRef(new Map<string, number>());
  const pausedRef = useRef(paused);
  const [craftCountdowns, setCraftCountdowns] = useState<
    Record<string, number>
  >({});

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(
    () => () => {
      craftTimers.current.forEach((timer) => window.clearInterval(timer));
      craftTimers.current.clear();
    },
    [],
  );

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
    if (
      dwarf?.status === "expedition" ||
      dwarf?.status === "resting" ||
      dwarf?.status === "forging"
    )
      return;

    setColony((current) => assignJob(current, id, assignment));
  }

  function craftTool(dwarfId: string) {
    const dwarf = colony.dwarves.find((item) => item.id === dwarfId);
    if (
      !dwarf?.specialty ||
      (dwarf.status !== "working" && dwarf.status !== "idle")
    )
      return;
    if (
      colony.resources.wood < 3 ||
      colony.resources.stone < 2 ||
      craftTimers.current.has(dwarfId)
    )
      return;

    setColony((current) => craftToolAction(current, dwarfId));
    setCraftCountdowns((current) => ({ ...current, [dwarfId]: 5 }));

    let remaining = 5;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;

      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        craftTimers.current.delete(dwarfId);
        setCraftCountdowns((current) => {
          const next = { ...current };
          delete next[dwarfId];
          return next;
        });
        setColony((current) => completeCraftToolAction(current, dwarfId));
        return;
      }
      setCraftCountdowns((current) => ({
        ...current,
        [dwarfId]: remaining,
      }));
    }, 1_000);
    craftTimers.current.set(dwarfId, timer);
  }

  async function sendExpedition(dwarfId: string, destination: string) {
    const dwarf = colony.dwarves.find((d) => d.id === dwarfId);
    if (
      !dwarf ||
      dwarf.status === "expedition" ||
      inFlight.current.has(dwarfId)
    )
      return; // Prevent sending a dwarf on an expedition if they are already on one or if the expedition is in flight - optional chaining is not possible because dwarf not found -> undefined -> false

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
    craftCountdowns,
    togglePaused: () => setPaused((value) => !value),
    assignDwarf,
    craftTool,
    sendExpedition,
  };

  return <ColonyContext value={value}>{children}</ColonyContext>;
}
