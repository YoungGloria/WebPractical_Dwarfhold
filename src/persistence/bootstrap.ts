import { createInitialState } from "../domain/initialState";
import { log } from "../domain/log";
import { loadSnapshot } from "./ring";
import type { Bootstrap, StorageLike } from "./schema";

export function bootstrapColony(
  storage: StorageLike = window.localStorage,
): Bootstrap {
  const result = loadSnapshot(storage);

  if (result.status === "empty") {
    return {
      colony: createInitialState(),
      dayElapsedMs: 0,
      expeditionCountdowns: {},
      pendingExpeditions: {},
      paused: false,
      notice: null,
      raidNotice: null,
    };
  }

  if (result.status === "fallback") {
    return {
      colony: createInitialState(),
      dayElapsedMs: 0,
      expeditionCountdowns: {},
      pendingExpeditions: {},
      paused: true,
      notice: {
        header: "Saved hold lost",
        subHeader:
          result.reason === "incompatible"
            ? "The save comes from another version of the game."
            : "The save was damaged.",
        message:
          "No readable save was found, so a new hold was founded. The hold is resting until you wake it.",
      },
      raidNotice: null,
    };
  }

  const { snapshot, skipped } = result;
  let colony = log(
    snapshot.colony,
    skipped === 0
      ? `Hold restored on day ${snapshot.colony.day}. It rests until you wake it.`
      : `An older save from day ${snapshot.colony.day} was restored.`,
    skipped === 0 ? "good" : "warning",
  );

  for (const dwarf of colony.dwarves) {
    if (dwarf.status === "forging_Tool" || dwarf.status === "forging_Weapon") {
      colony = log(
        colony,
        `${dwarf.name}'s forging continues once the hold is awake.`,
      );
    } else if (dwarf.status === "expedition") {
      colony = log(
        colony,
        `${dwarf.name}'s expedition continues once the hold is awake.`,
      );
    }
  }

  return {
    colony,
    dayElapsedMs: snapshot.dayElapsedMs ?? 0,
    expeditionCountdowns: Object.fromEntries(
      Object.entries(snapshot.pendingExpeditions).map(([dwarfId, request]) => [
        dwarfId,
        request.seconds,
      ]),
    ),
    pendingExpeditions: snapshot.pendingExpeditions,
    paused: true,
    raidNotice: snapshot.raidNotice ?? null,
    notice:
      skipped === 0
        ? {
            header: "Latest save restored",
            subHeader: "No progress was lost.",
            message: `Day ${snapshot.colony.day} was restored..`,
          }
        : {
            header: "Older save restored",
            subHeader: "Some progress was lost.",
            message: `Day ${snapshot.colony.day} at ${snapshot.savedAt} was restored. Progress after that point is lost.`,
          },
  };
}
