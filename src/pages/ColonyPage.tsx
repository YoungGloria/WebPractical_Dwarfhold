import { useEffect, useState } from "react";
import { Chronicle } from "../components/Chronicle";
import { DwarfRoster } from "../components/DwarfRoster";
import { jobLabel, production, isProducing } from "../simulation";
import { useColony } from "../state/ColonyContext";
import type { ResourceKey } from "../types";
import { isFamine } from "../utils";

export function ColonyPage() {
  const {
    colony,
    activities,
    expeditionPending,
    assignDwarf,
    sendExpedition,
    toggleTool,
  } = useColony();
  const [destination, setDestination] = useState("crystal-cave");
  const [expeditionDwarf, setExpeditionDwarf] = useState(
    () => colony.dwarves.find((d) => d.status !== "expedition")?.id ?? "", // Default to the first available dwarf
  );

  // Ensure the selected dwarf is always valid and available - rection to updates in the colony state
  useEffect(() => {
    const current = colony.dwarves.find(
      (dwarf) => dwarf.id === expeditionDwarf,
    );
    if (
      !current ||
      current.status === "expedition" ||
      current.status === "resting" ||
      current.status === "forging"
    ) {
      const next = colony.dwarves.find(
        (dwarf) =>
          dwarf.status !== "expedition" &&
          dwarf.status !== "resting" &&
          dwarf.status !== "forging",
      );
      if (next) {
        setExpeditionDwarf(next.id);
      }
    }
  }, [colony.dwarves, expeditionDwarf]);

  const selected = colony.dwarves.find((d) => d.id === expeditionDwarf);
  const blocked =
    !selected ||
    selected.status === "expedition" ||
    selected.status === "resting" ||
    selected.status === "forging" ||
    expeditionPending;
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
              {colony.dwarves
                .filter(
                  (dwarf) =>
                    dwarf.status !== "expedition" &&
                    dwarf.status !== "resting" &&
                    dwarf.status !== "forging",
                )
                .map((dwarf) => (
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
              <option value="abandoned-fortifications">Abandoned Fortifications</option>
            </select>
          </label>

          <button
            disabled={blocked}
            onClick={() =>
              void sendExpedition(expeditionDwarf, destination).catch((error) =>
                console.error("Failed to send expedition:", error),
              )
            } // onClick expects a function that returns void
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
        </section>

        <Chronicle activities={activities} />
      </aside>
    </div>
  );
}
