import { failExpeditionAction } from "../domain/actions/expedition";
import type { ColonyState } from "../domain/types";
import { FORGE_TOOL_SECONDS, FORGE_WEAPON_SECONDS } from "../config/constants";
import type { PendingExpedition } from "./schema";

function withCountdown(
  colony: ColonyState,
  dwarfId: string,
  countdown: number,
): ColonyState {
  const current = colony.dwarves.find((d) => d.id === dwarfId);
  if (!current || current.countdown === countdown) return colony;

  return {
    ...colony,
    dwarves: colony.dwarves.map((d) =>
      d.id === dwarfId ? { ...d, countdown } : d,
    ),
  };
}

export function reconcile(
  colony: ColonyState,
  pending: Record<string, PendingExpedition>,
) {
  let next = colony;
  const pendingExpeditions: Record<string, PendingExpedition> = {};

  for (const dwarf of colony.dwarves) {
    if (dwarf.status === "forging_Weapon") {
      next = withCountdown(
        next,
        dwarf.id,
        dwarf.countdown ?? FORGE_WEAPON_SECONDS,
      );
      continue;
    }

    if (dwarf.status === "forging_Tool") {
      next = withCountdown(
        next,
        dwarf.id,
        dwarf.countdown ?? FORGE_TOOL_SECONDS,
      );
      continue;
    }

    if (dwarf.status === "expedition") {
      const request = pending[dwarf.id];
      if (!request) {
        next = failExpeditionAction(
          next,
          dwarf.id,
          `${dwarf.name}'s expedition lost its trail during the reload.`,
        );
        continue;
      }

      const countdown = dwarf.countdown ?? request.seconds;
      pendingExpeditions[dwarf.id] = { ...request, seconds: countdown };
      next = withCountdown(next, dwarf.id, countdown);
    }
  }

  return { colony: next, pendingExpeditions };
}
