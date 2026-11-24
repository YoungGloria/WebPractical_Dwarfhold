import type { Dwarf } from "../types";

export const isBusy = (dwarf: Dwarf): boolean =>
  dwarf.status === "expedition" ||
  dwarf.status === "resting" ||
  dwarf.status === "forging_Tool" ||
  dwarf.status === "forging_Weapon";

export const canAssignJob = (dwarf: Dwarf): boolean => !isBusy(dwarf);

export const canScout = (dwarf: Dwarf): boolean =>
  dwarf.species !== "knight" && !isBusy(dwarf);

export const canForge = (dwarf: Dwarf): boolean =>
  dwarf.species !== "knight" && !isBusy(dwarf) && Boolean(dwarf.specialty);
