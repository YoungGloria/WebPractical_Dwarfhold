import { useEffect, useRef, useState, type ReactNode } from "react";
import { beginExpedition } from "../api";
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
import {
  bootstrapColony,
  clearColonySave,
  EXPEDITION_SECONDS,
  FORGE_SECONDS,
  saveSnapshot,
  SAVE_VERSION,
  type PendingExpedition,
} from "../persistence";
import { ColonyContext, type ColonyContextValue } from "./ColonyContext";

export function ColonyProvider({ children }: { children: ReactNode }) {
 
  // Read the save exactly once (synchronous localStorage)
  const [boot] = useState(() => bootstrapColony());

  const [colony, setColony] = useState(boot.colony);
  const [paused, setPaused] = useState(boot.paused);
  const [restoreNotice, setRestoreNotice] = useState(boot.notice);
  const [craftCountdowns, setCraftCountdowns] = useState(boot.craftCountdowns);
  const [expeditionCountdowns, setExpeditionCountdowns] = useState(boot.expeditionCountdowns);

  const inFlight = useRef(new Set<string>()); // Track dwarves currently on expeditions
  const craftTimers = useRef(new Map<string, number>());
  const expeditionTimers = useRef(new Map<string, number>());
  const pausedRef = useRef(paused);
  const pendingRequests = useRef(
    new Map<string, PendingExpedition>(Object.entries(boot.pendingExpeditions)),
  )

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

    const snapshot = () => ({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    colony,
    craftCountdowns,
    pendingExpeditions: Object.fromEntries(pendingRequests.current),
  });

  // Significant events: the colony only changes through day tick, assign,
  // forge start/end and expedition start/end -> push a new snapshot.
  useEffect(() => {
    saveSnapshot(snapshot());
  }, [colony]);

  // Forge and Expedition progress: refresh the newest snapshot in place every second, so a
  // reload resumes with the exact remaining time without flooding the ring.
  useEffect(() => {
    saveSnapshot(snapshot(), undefined, "replaceHead");
  }, [craftCountdowns]);

  useEffect(() => {
    saveSnapshot(snapshot(), undefined, "replaceHead");
  }, [expeditionCountdowns]);

  // Resume interrupted tasks once after the first mount
  useEffect(() => {
    Object.entries(boot.craftCountdowns).forEach(([dwarfId, seconds]) =>
      startCraftTimer(dwarfId, seconds),
    );
    Object.entries(boot.pendingExpeditions).forEach(([dwarfId, request]) => {
      startExpeditionTimer(dwarfId, request.destination, request.requestId, request.seconds);
    });
  }, []);

  useEffect(
    () => () => {
      craftTimers.current.forEach((timer) => window.clearInterval(timer));
      craftTimers.current.clear();
      expeditionTimers.current.forEach((timer) => window.clearInterval(timer));
      expeditionTimers.current.clear();
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

  function startCraftTimer(dwarfId: string, startSeconds: number) {
    if (craftTimers.current.has(dwarfId)) return;

    let remaining = startSeconds;
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
    setCraftCountdowns((current) => ({ 
      ...current,
       [dwarfId]: FORGE_SECONDS,
    }));
    startCraftTimer(dwarfId, FORGE_SECONDS);
  }

  function startExpeditionTimer(
    dwarfId: string,
    destination: string,
    requestId: string,
    startSeconds: number,
  ) {
    if (expeditionTimers.current.has(dwarfId)) return;

    let remaining = startSeconds;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;

      remaining -= 1;
      if (remaining <= 0) {
        window.clearInterval(timer);
        expeditionTimers.current.delete(dwarfId);
        setExpeditionCountdowns((current) => {
          const next = { ...current };
          delete next[dwarfId];
          return next;
        });
        void runExpedition(dwarfId, destination, requestId);
        return;
      }

      setExpeditionCountdowns((current) => ({
        ...current,
        [dwarfId]: remaining,
      }));
      const pending = pendingRequests.current.get(dwarfId);
      if (pending) {
        pendingRequests.current.set(dwarfId, {
          ...pending,
          seconds: remaining,
        });
      }
    }, 1_000);
    expeditionTimers.current.set(dwarfId, timer);
  }

  // Used only after the expedition countdown reaches zero.
  async function runExpedition(
    dwarfId: string,
    destination: string,
    requestId: string,
  ) {
    if (inFlight.current.has(dwarfId)) return;
    inFlight.current.add(dwarfId);

    try {
      const result = await beginExpedition(dwarfId, destination, requestId);
      pendingRequests.current.delete(dwarfId); // before setColony -> consistent save
      setColony((current) =>
        completeExpeditionAction(
          current,
          dwarfId,
          result.rewards,
          result.message,
        ),
      );
    } catch (error) {
      pendingRequests.current.delete(dwarfId);
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

  function sendExpedition(
    dwarfId: string,
    destination: string,
    existingRequestId?: string,
  ) {
    if (existingRequestId) {
      const existingPending = pendingRequests.current.get(dwarfId);
      const seconds = existingPending?.seconds ?? EXPEDITION_SECONDS;
      pendingRequests.current.set(dwarfId, {
        destination,
        requestId: existingRequestId,
        seconds,
      });
      setExpeditionCountdowns((current) => ({
        ...current,
        [dwarfId]: seconds,
      }));
      startExpeditionTimer(
        dwarfId,
        destination,
        existingRequestId,
        seconds,
      );
      return;
    }

    const dwarf = colony.dwarves.find((d) => d.id === dwarfId);
    if (
      !dwarf ||
      dwarf.status === "expedition" ||
      dwarf.status === "resting" ||
      dwarf.status === "forging" ||
      pendingRequests.current.has(dwarfId) ||
      inFlight.current.has(dwarfId)
    )
      return; // Prevent sending a dwarf on an expedition if they are already on one or if the expedition is in flight - optional chaining is not possible because dwarf not found -> undefined -> false

    const requestId = crypto.randomUUID();
    pendingRequests.current.set(dwarfId, {
      destination,
      requestId,
      seconds: EXPEDITION_SECONDS,
    });
    setColony((current) =>
      startExpeditionAction(current, dwarfId, destination),
    );
    setExpeditionCountdowns((current) => ({
      ...current,
      [dwarfId]: EXPEDITION_SECONDS,
    }));
    startExpeditionTimer(
      dwarfId,
      destination,
      requestId,
      EXPEDITION_SECONDS,
    );
  }

function newGame() {
    clearColonySave();
    window.location.reload(); // nothing is saved on unload, so the reset sticks
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
    expeditionCountdowns,
    restoreNotice,
    dismissRestoreNotice: () => setRestoreNotice(null),
    newGame,
    setRestoreNotice,
    togglePaused: () => setPaused((value) => !value),
    assignDwarf,
    craftTool,
    sendExpedition,
  };

  return <ColonyContext value={value}>{children}</ColonyContext>;
}
