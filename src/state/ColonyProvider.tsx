import { useEffect, useRef, useState, type ReactNode } from "react";
import { beginExpedition } from "../api";
import { createInitialState } from "../initialState";
import { advanceDay, DayPhase, getDayPhase } from "../simulation";
import type { JobType, Dwarf } from "../types";
import {
  assignJob,
  completeCraftToolAction,
  completeCraftWeaponAction,
  completeExpeditionAction,
  craftToolAction,
  craftWeaponAction,
  failExpeditionAction,
  startExpeditionAction,
  toggleToolAction,
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

  // Track elapsed time for day phase updates

  const TICK_MS = 200; // Update every 200ms
  const DAY_MS = 8_000; // Total duration of a day in milliseconds (8 seconds)

  const elapsedMs = useRef(0);
  const [dayPhase, setDayPhase] = useState<DayPhase>("early_morning");
  const [daySecondsLeft, setDaySecondsLeft] = useState(8);

  useEffect(() => {
    if (paused) return;

    const timer = window.setInterval(() => {
      elapsedMs.current += TICK_MS;

      // Advance the day if a full day has passed
      if (elapsedMs.current >= DAY_MS) {
        elapsedMs.current %= DAY_MS;
        setColony((current) => advanceDay(current));
      }

      // Get the current day phase based on elapsed time and update state if it has changed
      const newPhase = getDayPhase(elapsedMs.current);
      setDayPhase((prev) => (prev === newPhase ? prev : newPhase));
      // Update the countdown for the next deep day
      const nextSecondsLeft = Math.ceil((DAY_MS - elapsedMs.current) / 1_000); // Display only full seconds: .ceil returns smallest integer greater than or equal to the given number
      setDaySecondsLeft((prev) =>
        prev === nextSecondsLeft ? prev : nextSecondsLeft,
      );
    }, TICK_MS);

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

  function toggleTool(dwarf: Dwarf) {
    setColony((current) =>
      toggleToolAction(
        current,
        dwarf.id,
        dwarf.hasTool,
        dwarf.hasTool
          ? `${dwarf.name} put the tool back into storage.`
          : `${dwarf.name} equipped a tool.`,
      ),
    );
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

  function craftWeapon(dwarfId: string) {
    const dwarf = colony.dwarves.find((item) => item.id === dwarfId);
    if (
      !dwarf?.specialty ||
      (dwarf.status !== "working" && dwarf.status !== "idle")
    )
      return;
    if (
      colony.resources.wood < 4 ||
      colony.resources.stone < 3 ||
      craftTimers.current.has(dwarfId)
    )
      return;

    setColony((current) => craftWeaponAction(current, dwarfId));
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
        setColony((current) => completeCraftWeaponAction(current, dwarfId));
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
    dayPhase,
    daySecondsLeft,
    togglePaused: () => setPaused((value) => !value),
    assignDwarf,
    craftTool,
    craftWeapon,
    sendExpedition,
    toggleTool,
  };

  return <ColonyContext value={value}>{children}</ColonyContext>;
}
