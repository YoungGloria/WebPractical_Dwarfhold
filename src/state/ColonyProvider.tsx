import { useEffect, useRef, useState, type ReactNode } from "react";
import { beginExpedition } from "../services/expeditionApi";
import {
  advanceDay,
  DayPhase,
  getDayPhase,
  EXPEDITION_SECONDS,
  DAY_MS,
  FORGE_TOOL_SECONDS,
  FORGE_WEAPON_SECONDS,
} from "../simulation";
import type { JobType, Dwarf, ColonyState } from "../domain/types";
import {
  assignJob,
  completeCraftWeaponAction,
  completeExpeditionAction,
  craftToolAction,
  craftWeaponAction,
  failExpeditionAction,
  startExpeditionAction,
  toggleToolAction,
  completeCraftToolAction,
} from "../colonyActions";
import {
  bootstrapColony,
  clearColonySave,
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

  const firstSave = useRef(true); // Needed to ensure multiple reloads do not fill the ring buffer with duplicate snapshots
  const inFlight = useRef(new Set<string>()); // Track dwarves currently on expeditions
  const pendingRequests = useRef(
    new Map<string, PendingExpedition>(Object.entries(boot.pendingExpeditions)),
  );

  // Reference of the latest colony state to use in effects that need it
  const colonyRef = useRef(colony);
  colonyRef.current = colony;

  const snapshot = () => ({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    colony: colonyRef.current,
    dayElapsedMs: elapsedMs.current,
    pendingExpeditions: Object.fromEntries(pendingRequests.current),
  });

  // Significant events: the colony only changes through day tick, assign,
  // forge start/end and expedition start/end -> push a new snapshot.
  useEffect(() => {
    saveSnapshot(
      snapshot(),
      undefined,
      firstSave.current ? "replaceHead" : "push",
    );
    firstSave.current = false;
  }, [colony]);

  // Track elapsed time for day phase updates
  const elapsedMs = useRef(boot.dayElapsedMs);
  const [dayPhase, setDayPhase] = useState<DayPhase>(() =>
    getDayPhase(boot.dayElapsedMs),
  );
  const [daySecondsLeft, setDaySecondsLeft] = useState(() =>
    Math.ceil((DAY_MS - boot.dayElapsedMs) / 1_000),
  );

  const TICK_MS = 1_000; // Update every 1000ms

  // Combined countdowns for expeditions and crafting, used for UI display
  type CompletedTask =
    | { kind: "tool"; dwarfId: string }
    | { kind: "weapon"; dwarfId: string }
    | {
        kind: "expedition";
        dwarfId: string;
        destination: string;
        requestId: string;
      };

  function advanceDwarfCountdowns(
    state: ColonyState,
    onComplete: (task: CompletedTask) => void,
  ): ColonyState {
    let changed = false;
    const seenInTick = new Set<string>();

    const nextDwarves = state.dwarves.map((dwarf) => {
      if (typeof dwarf.countdown !== "number") return dwarf;

      changed = true;
      const remaining = dwarf.countdown - 1;

      if (remaining > 0) {
        if (dwarf.status === "expedition") {
          const pending = pendingRequests.current.get(dwarf.id);
          if (pending) {
            pendingRequests.current.set(dwarf.id, {
              ...pending,
              seconds: remaining,
            });
          }
        }
        return { ...dwarf, countdown: remaining };
      }

      if (!seenInTick.has(dwarf.id)) {
        seenInTick.add(dwarf.id);
        if (dwarf.status === "forging_Tool") {
          onComplete({ kind: "tool", dwarfId: dwarf.id });
        } else if (dwarf.status === "forging_Weapon") {
          onComplete({ kind: "weapon", dwarfId: dwarf.id });
        } else if (dwarf.status === "expedition") {
          const pending = pendingRequests.current.get(dwarf.id);
          if (pending) {
            onComplete({
              kind: "expedition",
              dwarfId: dwarf.id,
              destination: pending.destination,
              requestId: pending.requestId,
            });
          } else {
            onComplete({
              kind: "expedition",
              dwarfId: dwarf.id,
              destination: "unknown",
              requestId: "",
            });
          }
        }
      }

      const { countdown: _dropped, ...rest } = dwarf;
      return rest;
    });

    return changed ? { ...state, dwarves: nextDwarves } : state;
  }

  useEffect(() => {
    if (paused) return;

    const timer = window.setInterval(() => {
      elapsedMs.current += TICK_MS;

      // Advance the day if a full day has passed
      let dayAdvanced = false;
      if (elapsedMs.current >= DAY_MS) {
        elapsedMs.current %= DAY_MS;
        dayAdvanced = true;
      }

      // Get the current day phase based on elapsed time and update state if it has changed
      const newPhase = getDayPhase(elapsedMs.current);
      setDayPhase((prev) => (prev === newPhase ? prev : newPhase));

      // Update the countdown for the next deep day
      const nextSecondsLeft = Math.ceil((DAY_MS - elapsedMs.current) / 1_000); // Display only full seconds: .ceil returns smallest integer greater than or equal to the given number
      setDaySecondsLeft((prev) =>
        prev === nextSecondsLeft ? prev : nextSecondsLeft,
      );

      const completedThisTick: CompletedTask[] = [];
      let nextColony = dayAdvanced
        ? advanceDay(colonyRef.current)
        : colonyRef.current;

      nextColony = advanceDwarfCountdowns(nextColony, (task) => {
        completedThisTick.push(task);
      });

      for (const task of completedThisTick) {
        if (task.kind === "tool") {
          nextColony = completeCraftToolAction(nextColony, task.dwarfId);
        } else if (task.kind === "weapon") {
          nextColony = completeCraftWeaponAction(nextColony, task.dwarfId);
        }
      }

      colonyRef.current = nextColony;
      setColony(nextColony);

      for (const task of completedThisTick) {
        if (task.kind === "expedition") {
          void runExpedition(task.dwarfId, task.destination, task.requestId);
        }
      }

      /*setColony((current) => {
        let next: ColonyState = dayAdvanced ? advanceDay(current) : current;
        completedThisTick.length = 0;

        next = advanceDwarfCountdowns(next, (task) => {
          completedThisTick.push(task);
        });

        for (const task of completedThisTick) {
          if (task.kind === "tool") {
            next = completeCraftToolAction(next, task.dwarfId);
          } else if (task.kind === "weapon") {
            next = completeCraftWeaponAction(next, task.dwarfId);
          }
        }

        colonyRef.current = next; // Update the colonyRef to the latest state for snapshot purposes
        return next;
      });

      for (const task of completedThisTick) {
        if (task.kind === "expedition") {
          void runExpedition(task.dwarfId, task.destination, task.requestId); // handoff to async function to handle expedition completion
        }
      }
        */

      // Update the snapshot every tick to ensure the elapsed time is saved
      saveSnapshot(snapshot(), undefined, "replaceHead");
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [paused]);

  const isDwarfUnavailable = (dwarf: Dwarf | undefined): boolean =>
    !dwarf || dwarf.status === "resting" || typeof dwarf.countdown === "number";

  function assignDwarf(id: string, assignment: JobType) {
    const dwarf = colony.dwarves.find((d) => d.id === id);
    if (isDwarfUnavailable(dwarf)) return;

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
      isDwarfUnavailable(dwarf) ||
      !dwarf?.specialty ||
      dwarf.species === "knight"
    )
      return;

    //TODO: provider should not know recipe state - move resources to provider?
    if (colony.resources.wood < 3 || colony.resources.stone < 2) return;

    setColony((current) => {
      const updated = craftToolAction(current, dwarfId);
      return {
        ...updated,
        dwarves: updated.dwarves.map((d) =>
          d.id === dwarfId ? { ...d, countdown: FORGE_TOOL_SECONDS } : d,
        ),
      };
    });
  }

  function craftWeapon(dwarfId: string) {
    const dwarf = colony.dwarves.find((item) => item.id === dwarfId);
    if (
      isDwarfUnavailable(dwarf) ||
      !dwarf?.specialty ||
      dwarf.species === "knight"
    )
      return;

    //TODO: provider should not know recipe state - move resources to provider?
    if (colony.resources.wood < 4 || colony.resources.stone < 3) return;
    setColony((current) => {
      const updated = craftWeaponAction(current, dwarfId);
      return {
        ...updated,
        dwarves: updated.dwarves.map((d) =>
          d.id === dwarfId ? { ...d, countdown: FORGE_WEAPON_SECONDS } : d,
        ),
      };
    });
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
      const shouldRecruitSirOneUper =
        !colonyRef.current.sirOneUperJoined && destination === "crystal-cave";
      setColony((current) =>
        completeExpeditionAction(
          current,
          dwarfId,
          result.rewards,
          result.message,
          shouldRecruitSirOneUper,
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

  function sendExpedition(dwarfId: string, destination: string) {
    const dwarf = colony.dwarves.find((d) => d.id === dwarfId);
    if (isDwarfUnavailable(dwarf) || dwarf?.species === "knight") return;
    if (pendingRequests.current.has(dwarfId) || inFlight.current.has(dwarfId))
      return; // Prevent sending a dwarf on an expedition if they are already on one or if the expedition is in flight - optional chaining is not possible because dwarf not found -> undefined -> false

    const requestId = crypto.randomUUID();
    pendingRequests.current.set(dwarfId, {
      destination,
      requestId,
      seconds: EXPEDITION_SECONDS,
    });
    setColony((current) => {
      const updated = startExpeditionAction(current, dwarfId, destination);
      return {
        ...updated,
        dwarves: updated.dwarves.map((d) =>
          d.id === dwarfId ? { ...d, countdown: EXPEDITION_SECONDS } : d,
        ),
      };
    });
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
    dayPhase,
    daySecondsLeft,
    restoreNotice,
    dismissRestoreNotice: () => setRestoreNotice(null),
    newGame,
    togglePaused: () => setPaused((value) => !value),
    assignDwarf,
    craftTool,
    craftWeapon,
    sendExpedition,
    toggleTool,
  };

  return <ColonyContext value={value}>{children}</ColonyContext>;
}
