import { useEffect, useState } from "react";
import { Chronicle } from "../components/Chronicle";
import { DwarfRoster } from "../components/DwarfRoster";
import { jobLabel, production } from "../config/jobs";
import { isProducing } from "../domain/rules/availability";
import { useColony } from "../state/ColonyContext";
import type { ResourceKey } from "../domain/types";
import { isFamine } from "../domain/rules/famine";

export function ColonyPage() {
  const {
    colony,
    activities,
    expeditionPending,
    assignDwarf,
    sendExpedition,
    toggleTool,
  } = useColony();
  const isEligibleScout = (dwarf: (typeof colony.dwarves)[number]) =>
    dwarf.species !== "knight" &&
    dwarf.status !== "expedition" &&
    dwarf.status !== "resting" &&
    dwarf.status !== "forging_Tool" &&
    dwarf.status !== "forging_Weapon";

  const [destination, setDestination] = useState("crystal-cave");
  const [expeditionDwarf, setExpeditionDwarf] = useState(
    () => colony.dwarves.find(isEligibleScout)?.id ?? "",
  ); // Default to the first eligable scout

  // Ensure the selected dwarf is always valid and available - rection to updates in the colony state
  useEffect(() => {
    const current = colony.dwarves.find(
      (dwarf) => dwarf.id === expeditionDwarf,
    );
    if (!current || isEligibleScout(current) === false) {
      const next = colony.dwarves.find(isEligibleScout);
      if (next) {
        setExpeditionDwarf(next.id);
      }
    }
  }, [colony.dwarves, expeditionDwarf]);

  const selected = colony.dwarves.find((d) => d.id === expeditionDwarf);
  const blocked = !selected || !isEligibleScout(selected) || expeditionPending;
  const awayDwarf = colony.dwarves.find(
    (dwarf) => dwarf.status === "expedition",
  );

  const dailyOutput = colony.dwarves.reduce<Record<ResourceKey, number>>(
    (total, dwarf) => {
      if (dwarf.assignment && isProducing(dwarf)) {
        let resourceModifier = 0;
        if (isFamine(colony)) {
          resourceModifier -= 1;
        }
        if (dwarf.hasTool) {
          resourceModifier += 1;
        }
        if (dwarf.species === "knight") {
          resourceModifier += 1;
        }
        // ensure the dwarf has an assignment and is producing (ie not on an expedition)
        const output = production[dwarf.assignment];
        Object.entries(output).forEach(([resource, amount]) => {
          total[resource as ResourceKey] += amount
            ? amount + resourceModifier
            : 0;
        });
      }
      return total;
    },
    {
      wood: 0,
      stone: 0,
      food: -colony.dwarves.length,
      tools: 0,
    },
  );

  return (
    <div className="dashboard">
      <DwarfRoster
        dwarves={colony.dwarves}
        onAssign={assignDwarf}
        state={colony}
        onToggleTool={toggleTool}
      />

      <section className="center-stack">
        <section className="panel production">
          <header>
            <div>
              <small>SHIFT LEDGER</small>
              <h2>Daily Production</h2>
            </div>
            <span>updates each day</span>
          </header>

          <div className="job-grid">
            {(["woodcutting", "mining", "farming"] as const).map((job) => (
              <article key={job}>
                <b>
                  {job === "woodcutting"
                    ? "🌲"
                    : job === "mining"
                      ? "⛏️"
                      : "🍄"}
                </b>
                <h3>{jobLabel(job)}</h3>
                <p>
                  {
                    colony.dwarves.filter((dwarf) => dwarf.assignment === job)
                      .length
                  }{" "}
                  assigned
                </p>
                <strong>+{Object.values(production[job])[0]} / day</strong>
              </article>
            ))}
          </div>

          <div className="net-line">
            <span>NET FOOD AFTER MEALS</span>
            <strong className={dailyOutput.food >= 0 ? "gain" : "loss"}>
              {dailyOutput.food >= 0 ? "+" : ""}
              {dailyOutput.food}
            </strong>
          </div>
        </section>
      </section>

      <aside className="side-stack">
        <section className="panel expedition">
          <header>
            <div>
              <small>BEYOND THE GATE</small>
              <h2>Expedition</h2>
            </div>
            <b>🗺️</b>
          </header>

          <label>
            Scout
            <select
              value={expeditionDwarf}
              onChange={(event) => setExpeditionDwarf(event.target.value)}
            >
              {colony.dwarves.filter(isEligibleScout).map((dwarf) => (
                <option key={dwarf.id} value={dwarf.id}>
                  {dwarf.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Destination
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="crystal-cave">Crystal Cave</option>
              <option value="old-mine">The Old Mine</option>
              <option value="blocked-pass">Blocked Pass</option>
            </select>
          </label>

          <button
            disabled={blocked}
            onClick={() => sendExpedition(expeditionDwarf, destination)} // onClick expects a function that returns void
          >
            {expeditionPending ? "Beyond the gate…" : "Send expedition"}
          </button>
          <p>
            {awayDwarf
              ? `${awayDwarf.name} is away beyond the gate. A result returns in one request…`
              : selected
                ? `${selected.name} is ready. A result returns in one request…`
                : "No scout available. A result returns in one request…"}
          </p>
          {colony.dwarves
            .filter(
              (dwarf) =>
                dwarf.status === "expedition" &&
                typeof dwarf.countdown === "number",
            )
            .map((dwarf) => (
              <p className="craft-progress" key={dwarf.id}>
                Expedition ready in: {dwarf.countdown}s — {dwarf.name} is
                travelling
              </p>
            ))}
        </section>

        <Chronicle activities={activities} />
      </aside>
    </div>
  );
}
