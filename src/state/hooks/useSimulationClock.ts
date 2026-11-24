import {
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { DAY_MS } from "../../config/constants";
import {
  completeCraftToolAction,
  completeCraftWeaponAction,
} from "../../domain/actions/crafting";
import { advanceDay } from "../../domain/simulation/advanceDay";
import { getDayPhase, type DayPhase } from "../../domain/simulation/dayPhase";
import type { ColonyState } from "../../domain/types";
import type { PendingExpedition } from "../../persistence/schema";

type CompletedTask =
  | { kind: "tool"; dwarfId: string }
  | { kind: "weapon"; dwarfId: string }
  | {
      kind: "expedition";
      dwarfId: string;
      destination: string;
      requestId: string;
    };

interface SimulationClockArgs {
  paused: boolean;
  initialDayElapsedMs: number;
  colonyRef: RefObject<ColonyState>;
  elapsedMsRef: RefObject<number>;
  setColony: Dispatch<SetStateAction<ColonyState>>;
  pendingRequests: RefObject<Map<string, PendingExpedition>>;
  runExpedition: (
    dwarfId: string,
    destination: string,
    requestId: string,
  ) => Promise<void>;
  saveCompletedDay: () => void;
  saveDuringDay: () => void;
}

export function useSimulationClock({
  paused,
  initialDayElapsedMs,
  colonyRef,
  elapsedMsRef,
  setColony,
  pendingRequests,
  runExpedition,
  saveCompletedDay,
  saveDuringDay,
}: SimulationClockArgs) {
  const [dayPhase, setDayPhase] = useState<DayPhase>(() =>
    getDayPhase(initialDayElapsedMs),
  );
  const [daySecondsLeft, setDaySecondsLeft] = useState(() =>
    Math.ceil((DAY_MS - initialDayElapsedMs) / 1_000),
  );

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
          onComplete(
            pending
              ? {
                  kind: "expedition",
                  dwarfId: dwarf.id,
                  destination: pending.destination,
                  requestId: pending.requestId,
                }
              : {
                  kind: "expedition",
                  dwarfId: dwarf.id,
                  destination: "unknown",
                  requestId: "",
                },
          );
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
      elapsedMsRef.current += 1_000;
      let dayAdvanced = false;
      if (elapsedMsRef.current >= DAY_MS) {
        elapsedMsRef.current %= DAY_MS;
        dayAdvanced = true;
      }

      const nextPhase = getDayPhase(elapsedMsRef.current);
      setDayPhase((previous) =>
        previous === nextPhase ? previous : nextPhase,
      );
      const nextSecondsLeft = Math.ceil(
        (DAY_MS - elapsedMsRef.current) / 1_000,
      );
      setDaySecondsLeft((previous) =>
        previous === nextSecondsLeft ? previous : nextSecondsLeft,
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

      if (dayAdvanced) {
        saveCompletedDay();
      } else {
        saveDuringDay();
      }
    }, 1_000);

    return () => window.clearInterval(timer);
  }, [
    paused,
    colonyRef,
    elapsedMsRef,
    pendingRequests,
    runExpedition,
    saveCompletedDay,
    saveDuringDay,
    setColony,
  ]);

  return { elapsedMs: elapsedMsRef, dayPhase, daySecondsLeft };
}
