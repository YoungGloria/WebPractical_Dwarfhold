import { useEffect, useState } from "react";
import { recipes, type RecipeId } from "../../config/recipes";
import type { ColonyState } from "../../domain/types";
import { canForge } from "../../domain/rules/availability";

interface RecipePanelProps {
  colony: ColonyState;
  recipeId: RecipeId;
  onCraft: (dwarfId: string) => void;
}

export function RecipePanel({ colony, recipeId, onCraft }: RecipePanelProps) {
  const [specialistId, setSpecialistId] = useState("");
  const recipe = recipes[recipeId];

  const availableSpecialists = colony.dwarves.filter(canForge);

  useEffect(() => {
    const selected = colony.dwarves.find(
      (dwarf) => dwarf.id === specialistId && canForge(dwarf),
    );
    if (!selected) setSpecialistId("");
  }, [colony.dwarves, specialistId]);

  const hasMaterials =
    colony.resources.wood >= recipe.wood &&
    colony.resources.stone >= recipe.stone;
  const canStart = Boolean(specialistId) && hasMaterials;
  const craftingStatus =
    recipeId === "tool" ? "forging_Tool" : "forging_Weapon";

  return (
    <div className="forge-option">
      <div>
        <small>EMBER FORGE</small>
        <h2>{recipe.name}</h2>
        <p>{recipe.subText}</p>
      </div>
      <div className="forge-controls">
        <label>
          Specialist
          <select
            value={specialistId}
            onChange={(event) => setSpecialistId(event.target.value)}
          >
            <option value="">Select specialist</option>
            {availableSpecialists.map((dwarf) => (
              <option key={dwarf.id} value={dwarf.id}>
                {dwarf.name}
              </option>
            ))}
          </select>
        </label>
        <div className="recipe">
          <span>{recipe.wood} 🪵</span>
          <i>+</i>
          <span>{recipe.stone} 🪨</span>
          <i>→</i>
          <span>
            {recipe.output} {recipe.icon}
          </span>
          <button disabled={!canStart} onClick={() => onCraft(specialistId)}>
            {recipe.buttonText}
          </button>
        </div>
        {colony.dwarves
          .filter(
            (dwarf) =>
              dwarf.status === craftingStatus &&
              typeof dwarf.countdown === "number",
          )
          .map((dwarf) => (
            <p className="craft-progress" key={dwarf.id}>
              Ready in: {dwarf.countdown}s — {dwarf.name} is crafting
            </p>
          ))}
      </div>
    </div>
  );
}
