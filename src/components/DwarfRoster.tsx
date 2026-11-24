import { jobLabel } from "../simulation";
import type { ColonyState, Dwarf, JobType } from "../domain/types";

const jobs: Exclude<JobType, null>[] = ["woodcutting", "mining", "farming"];

interface Props {
  dwarves: Dwarf[];
  onAssign: (id: string, job: JobType) => void;
  state: ColonyState;
  onToggleTool: (dwarf: Dwarf) => void;
}

export function DwarfRoster({ dwarves, onAssign, state, onToggleTool }: Props) {
  const presentDwarves = dwarves.filter(
    (dwarf) => dwarf.status !== "expedition",
  ).length;

  return (
    <section className="panel roster">
      <header>
        <div>
          <small>THE COMPANY</small>
          <h2>Holdfolk</h2>
        </div>
        <span>
          {presentDwarves} / {dwarves.length} present
        </span>
      </header>

      <div className="dwarf-list">
        {dwarves.map((dwarf) => {
          const isAway = dwarf.status === "expedition";
          const isUnavailable =
            dwarf.status === "expedition" ||
            dwarf.status === "resting" ||
            dwarf.status === "forging_Tool" ||
            dwarf.status === "forging_Weapon";
          const specialty =
            dwarf.species === "knight"
              ? "Knight (+1 basic yield)"
              : dwarf.specialty
                ? `Skilled in ${jobLabel(dwarf.specialty)}`
                : "Generalist";

          return (
            <article className={isAway ? "dwarf away" : "dwarf"} key={dwarf.id}>
              <div className="portrait">
                {dwarf.icon}
                <i className={dwarf.status} />
              </div>

              <div className="dwarf-details">
                <h3>{dwarf.name}</h3>
                <p>
                  {dwarf.title} · {specialty}
                </p>

                <label>
                  Has Tool:{" "}
                  <input
                    type="checkbox"
                    name="toolCheckbox"
                    checked={dwarf.hasTool}
                    disabled={!dwarf.hasTool && state.resources.tools <= 0}
                    onChange={() => onToggleTool(dwarf)}
                  />
                </label>

                <select
                  value={dwarf.assignment ?? ""}
                  disabled={isUnavailable}
                  onChange={(event) =>
                    onAssign(dwarf.id, (event.target.value || null) as JobType)
                  }
                >
                  <option value="">Unassigned</option>
                  {jobs.map((job) => (
                    <option value={job} key={job}>
                      {jobLabel(job)}
                    </option>
                  ))}
                </select>
              </div>

              <span className="status">{dwarf.status}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
