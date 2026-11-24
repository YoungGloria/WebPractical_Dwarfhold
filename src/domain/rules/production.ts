import type { Dwarf, Resources, ColonyState } from "../types";
import { production } from "../../config/jobs";
import { isFamine } from "./famine";
import { isProducing } from "./availability";

export type ProductionOutput = Partial<Resources>;

export function dailyYield(dwarf: Dwarf, famine: boolean): ProductionOutput {
  if (!dwarf.assignment || !isProducing(dwarf)) return {};

  const result: ProductionOutput = {};
  const baseOutput = production[dwarf.assignment];

  Object.entries(baseOutput).forEach(([resource, amount]) => {
    const key = resource as keyof Resources;

    let yieldAmount = amount ?? 0;

    // apply modifiers for tools and species and famine
    if (dwarf.hasTool) yieldAmount += 1;
    if (dwarf.species === "knight") yieldAmount += 1;
    if (famine) yieldAmount -= 1;

    /*// During famine, only food is produced
    if (famine && resource !== "food") return; 

    let yieldAmount = amount ?? 0;
    // apply modifiers for tools and species, but only for base output greater 0
    if (yieldAmount > 0){
      if (dwarf.hasTool) yieldAmount += 1;
      if (dwarf.species === "knight") yieldAmount += 1; 
    } 
      */
    // save the result, ensuring it doesn't go below 0 during famine
    result[key] = Math.max(0, yieldAmount);
  });

  return result;
}

export function projectedOutput(state: ColonyState): ProductionOutput {
  const famine = isFamine(state);
  const result: ProductionOutput = {};

  state.dwarves.forEach((dwarf) => {
    const yieldForDwarf = dailyYield(dwarf, famine);
    Object.entries(yieldForDwarf).forEach(([resource, amount]) => {
      const key = resource as keyof Resources;
      result[key] = (result[key] ?? 0) + (amount ?? 0);
    });
  });

  result.food = (result.food ?? 0) - state.dwarves.length;
  return result;
}
