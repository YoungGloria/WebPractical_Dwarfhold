import { useRef, useState, type ReactNode } from "react";
import { recipes } from "../config/recipes";
import { assignJob } from "../domain/actions/assignment";
import { craftToolAction, craftWeaponAction } from "../domain/actions/crafting";
import { toggleToolAction } from "../domain/actions/equipment";
import type { Dwarf, JobType } from "../domain/types";
import { bootstrapColony } from "../persistence/bootstrap";
import { clearColonySave } from "../persistence/ring";
import type { PendingExpedition } from "../persistence/schema";
import { ColonyContext, type ColonyContextValue } from "./ColonyContext";
import { useAutosave } from "./hooks/useAutosave";
import { useExpeditionRunner } from "./hooks/useExpeditionRunner";
import { useSimulationClock } from "./hooks/useSimulationClock";

export function ColonyProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(() => bootstrapColony());
  const [colony, setColony] = useState(boot.colony);
  const [paused, setPaused] = useState(boot.paused);
  const [restoreNotice, setRestoreNotice] = useState(boot.notice);

  const colonyRef = useRef(colony);
  colonyRef.current = colony;
  const elapsedMsRef = useRef(boot.dayElapsedMs);
  const pendingRequests = useRef(
    new Map<string, PendingExpedition>(Object.entries(boot.pendingExpeditions)),
  );

  const autosave = useAutosave({
    colony,
    colonyRef,
    elapsedMsRef,
    pendingRequestsRef: pendingRequests,
  });

  const expeditionRunner = useExpeditionRunner({
    colony,
    colonyRef,
    setColony,
    pendingRequests,
    saveDuringDay: autosave.saveDuringDay,
  });

  const { dayPhase, daySecondsLeft } = useSimulationClock({
    paused,
    initialDayElapsedMs: boot.dayElapsedMs,
    colonyRef,
    elapsedMsRef,
    setColony,
    pendingRequests,
    runExpedition: expeditionRunner.runExpedition,
    saveCompletedDay: autosave.saveCompletedDay,
    saveDuringDay: autosave.saveDuringDay,
  });

  const isDwarfUnavailable = (dwarf: Dwarf | undefined): boolean =>
    !dwarf || dwarf.status === "resting" || typeof dwarf.countdown === "number";

  function assignDwarf(id: string, assignment: JobType) {
    const dwarf = colony.dwarves.find((d) => d.id === id);
    if (isDwarfUnavailable(dwarf)) return;
    setColony((current) => {
      const next = assignJob(current, id, assignment);
      colonyRef.current = next;
      autosave.saveDuringDay();
      return next;
    });
  }

  function toggleTool(dwarf: Dwarf) {
    setColony((current) => {
      const next = toggleToolAction(
        current,
        dwarf.id,
        dwarf.hasTool,
        dwarf.hasTool
          ? `${dwarf.name} put the tool back into storage.`
          : `${dwarf.name} equipped a tool.`,
      );
      colonyRef.current = next;
      autosave.saveDuringDay();
      return next;
    });
  }

  function craftTool(dwarfId: string) {
    const dwarf = colony.dwarves.find((item) => item.id === dwarfId);
    if (
      isDwarfUnavailable(dwarf) ||
      !dwarf?.specialty ||
      dwarf.species === "knight"
    )
      return;
    const recipe = recipes.tool;
    if (
      colony.resources.wood < recipe.wood ||
      colony.resources.stone < recipe.stone
    )
      return;

    setColony((current) => {
      const updated = craftToolAction(current, dwarfId);
      const next = {
        ...updated,
        dwarves: updated.dwarves.map((d) =>
          d.id === dwarfId
            ? { ...d, countdown: recipe.durationSeconds }
            : d,
        ),
      };
      colonyRef.current = next;
      autosave.saveDuringDay();
      return next;
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
    const recipe = recipes.weapon;
    if (
      colony.resources.wood < recipe.wood ||
      colony.resources.stone < recipe.stone
    )
      return;

    setColony((current) => {
      const updated = craftWeaponAction(current, dwarfId);
      const next = {
        ...updated,
        dwarves: updated.dwarves.map((d) =>
          d.id === dwarfId
            ? { ...d, countdown: recipe.durationSeconds }
            : d,
        ),
      };
      colonyRef.current = next;
      autosave.saveDuringDay();
      return next;
    });
  }

  function newGame() {
    clearColonySave();
    window.location.reload();
  }

  const value: ColonyContextValue = {
    colony,
    paused,
    activities: colony.log,
    expeditionPending: colony.dwarves.some((d) => d.status === "expedition"),
    dayPhase,
    daySecondsLeft,
    restoreNotice,
    dismissRestoreNotice: () => setRestoreNotice(null),
    newGame,
    togglePaused: () => setPaused((value) => !value),
    assignDwarf,
    craftTool,
    craftWeapon,
    sendExpedition: expeditionRunner.sendExpedition,
    toggleTool,
  };

  return <ColonyContext value={value}>{children}</ColonyContext>;
}
