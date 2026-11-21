import { Chronicle } from "../components/Chronicle";
import { useColony } from "../state/ColonyContext";
import { useEffect, useState } from "react";

export function ForgePage() {
  const { colony, activities, craftTool, craftCountdowns } = useColony();
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
    colony.resources.wood >= 3 && colony.resources.stone >= 2;
  const canForge = Boolean(specialistId) && hasMaterials;

  return (
    <div className="forge-layout">
      <section className="panel forge">
        <div>
          <small>EMBER FORGE</small>
          <h2>Craft a tool</h2>
          <p>Equip the hold for future work.</p>
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
            <span>3 🪵</span>
            <i>+</i>
            <span>2 🪨</span>
            <i>→</i>
            <span>1 ⚒️</span>
            <button
              disabled={!canForge}
              onClick={() => craftTool(specialistId)}
            >
              Forge tool
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
      </section>

      <Chronicle activities={activities} />
    </div>
  );
}
