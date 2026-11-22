import { useEffect, useState } from "react";
import { ColonyState, Recepies } from "../types";

interface RecepieProps {
  colony: ColonyState;
  recepieMethod: (dwarfId: string) => void;
  craftCountdowns: Record<string, number>;
  name: string;
  subText: string;
  buttonText: string;
  recepieResources: Recepies;
}

export function Recepie({
  colony,
  recepieMethod,
  craftCountdowns,
  name,
  subText,
  buttonText,
  recepieResources,
}: RecepieProps) {
  const [specialistId, setSpecialistId] = useState("");

  const availableSpecialists = colony.dwarves.filter(
    (dwarf) =>
      Boolean(dwarf.specialty) &&
      dwarf.status !== "expedition" &&
      dwarf.status !== "resting" &&
      dwarf.status !== "forging",
  );

  useEffect(() => {
    const selected = availableSpecialists.find(
      (dwarf) => dwarf.id === specialistId,
    );
    if (!selected) {
      setSpecialistId("");
    }
  }, [colony.dwarves, specialistId]);

  const hasMaterials =
    colony.resources.wood >= recepieResources.wood &&
    colony.resources.stone >= recepieResources.stone;
  const canForge = Boolean(specialistId) && hasMaterials;

  return (
    <div className={"forge-option"}>
      <div>
        <small>EMBER FORGE</small>
        <h2>{name}</h2>
        <p>{subText}</p>
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
          <span>{recepieResources.wood} 🪵</span>
          <i>+</i>
          <span>{recepieResources.stone} 🪨</span>
          <i>→</i>
          <span>
            {recepieResources.output} {recepieResources.icon}
          </span>
          <button
            disabled={!canForge}
            onClick={() => recepieMethod(specialistId)}
          >
            {buttonText}
          </button>
        </div>
        {Object.entries(craftCountdowns).map(([dwarfId, seconds]) => {
          const dwarf = colony.dwarves.find((item) => item.id === dwarfId);
          if (!dwarf) return null;
          return (
            <p className="craft-progress" key={dwarfId}>
              Ready in: {seconds}s — {dwarf.name} is crafting
            </p>
          );
        })}
      </div>
    </div>
  );
}
