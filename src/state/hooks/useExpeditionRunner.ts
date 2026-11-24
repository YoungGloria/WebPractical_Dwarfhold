import {
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { EXPEDITION_SECONDS } from "../../config/constants";
import {
  completeExpeditionAction,
  failExpeditionAction,
  startExpeditionAction,
} from "../../domain/actions/expedition";
import type { ColonyState } from "../../domain/types";
import { beginExpedition } from "../../services/expeditionApi";
import type { PendingExpedition } from "../../persistence/schema";

interface ExpeditionRunnerArgs {
  colony: ColonyState;
  colonyRef: RefObject<ColonyState>;
  setColony: Dispatch<SetStateAction<ColonyState>>;
  pendingRequests: RefObject<Map<string, PendingExpedition>>;
  saveDuringDay: () => void;
}

export function useExpeditionRunner({
  colony,
  colonyRef,
  setColony,
  pendingRequests,
  saveDuringDay,
}: ExpeditionRunnerArgs) {
  const inFlight = useRef(new Set<string>());

  async function runExpedition(
    dwarfId: string,
    destination: string,
    requestId: string,
  ) {
    if (inFlight.current.has(dwarfId)) return;
    inFlight.current.add(dwarfId);

    try {
      const result = await beginExpedition(dwarfId, destination, requestId);
      pendingRequests.current.delete(dwarfId);
      const shouldRecruit =
        !colonyRef.current.sirOneUperJoined && destination === "crystal-cave";
      setColony((current) => {
        const next = completeExpeditionAction(
          current,
          dwarfId,
          result.rewards,
          result.message,
          shouldRecruit,
        );
        colonyRef.current = next;
        saveDuringDay();
        return next;
      });
    } catch (error) {
      pendingRequests.current.delete(dwarfId);
      setColony((current) => {
        const next = failExpeditionAction(
          current,
          dwarfId,
          error instanceof Error
            ? error.message
            : "The expedition was lost from view.",
        );
        colonyRef.current = next;
        saveDuringDay();
        return next;
      });
    } finally {
      inFlight.current.delete(dwarfId);
    }
  }

  function sendExpedition(dwarfId: string, destination: string) {
    const dwarf = colony.dwarves.find((d) => d.id === dwarfId);
    if (
      !dwarf ||
      dwarf.status === "resting" ||
      typeof dwarf.countdown === "number" ||
      dwarf.species === "knight"
    )
      return;
    if (pendingRequests.current.has(dwarfId) || inFlight.current.has(dwarfId))
      return;

    const requestId = crypto.randomUUID();
    pendingRequests.current.set(dwarfId, {
      destination,
      requestId,
      seconds: EXPEDITION_SECONDS,
    });
    setColony((current) => {
      const updated = startExpeditionAction(current, dwarfId, destination);
      const next = {
        ...updated,
        dwarves: updated.dwarves.map((d) =>
          d.id === dwarfId ? { ...d, countdown: EXPEDITION_SECONDS } : d,
        ),
      };
      colonyRef.current = next;
      saveDuringDay();
      return next;
    });
  }

  return {
    inFlight,
    runExpedition,
    sendExpedition,
  };
}
