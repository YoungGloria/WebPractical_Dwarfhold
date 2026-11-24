import { useEffect, useRef, type RefObject } from "react";
import { SAVE_VERSION } from "../../config/constants";
import type { ColonyState } from "../../domain/types";
import { saveSnapshot } from "../../persistence/ring";
import type { PendingExpedition } from "../../persistence/schema";

interface AutosaveArgs {
  colony: ColonyState;
  colonyRef: RefObject<ColonyState>;
  elapsedMsRef: RefObject<number>;
  pendingRequestsRef: RefObject<Map<string, PendingExpedition>>;
}

export function useAutosave({
  colony,
  colonyRef,
  elapsedMsRef,
  pendingRequestsRef,
}: AutosaveArgs): {
  saveCompletedDay: () => void;
  saveDuringDay: () => void;
} {
  const firstSave = useRef(true);

  const createSnapshot = () => ({
    version: SAVE_VERSION,
    savedAt: Date.now(),
    colony: colonyRef.current,
    dayElapsedMs: elapsedMsRef.current,
    pendingExpeditions: Object.fromEntries(pendingRequestsRef.current),
  });

  const saveDuringDay = () => {
    saveSnapshot(createSnapshot(), undefined, "replaceHead");
  };

  const saveCompletedDay = () => {
    saveSnapshot(createSnapshot(), undefined, "push");
  };

  useEffect(() => {
    if (firstSave.current) {
      saveDuringDay();
      firstSave.current = false;
      return;
    }
  }, [colony, colonyRef, elapsedMsRef, pendingRequestsRef]);

  return { saveCompletedDay, saveDuringDay };
}
