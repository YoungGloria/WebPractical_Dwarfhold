import { NavLink, Outlet } from "react-router";
import { ResourceBar } from "../components/ResourceBar";
import { useColony } from "../state/ColonyContext";
import { Popup } from "../components/Popup";
import { isFamine } from "../utils";
import { dayPhaseLabel } from "../simulation";

export function Layout() {
  const {
    colony,
    paused,
    togglePaused,
    dayPhase,
    daySecondsLeft,
    craftCountdowns,
  } = useColony();

  const hasActiveCrafts = Object.keys(craftCountdowns).length > 0;

  return (
    <main>
      <header className="masthead">
        <div className="brand">
          <b>⛏</b>
          <div>
            <small>THE DEEP REALMS OF</small>
            <h1>
              Dwarf<span>hold</span>
            </h1>
          </div>
        </div>

        <div className="hold-title">
          <small>COLONY</small>
          <strong>STONEHOME</strong>
          <span>Founded beneath Emberpeak</span>
        </div>

        <div className="day">
          <small>{dayPhaseLabel(dayPhase)}</small>
          <strong>{colony.day}</strong>
          <button onClick={togglePaused}>
            {paused ? "Wake the hold" : "Pause"}
          </button>
        </div>
      </header>

      <nav className="main-nav" aria-label="Colony navigation">
        <NavLink to="/" end>
          Colony
        </NavLink>
        <NavLink to="/forge">Forge</NavLink>
      </nav>

      {isFamine(useColony().colony) ? (
        <Popup
          header="Famine"
          subHeader="It has been a long time since they have eaten."
          message={
            "Your people are starving. Feed them.\nYour workers output is cut in half."
          }
        />
      ) : (
        ""
      )}

      <ResourceBar resources={colony.resources} />
      <Outlet />

      <footer>
        <span>{hasActiveCrafts ? "🔥 Forge: burning" : "🪵 Forge: idle"}</span>
        <span>Next deep day in ~{daySecondsLeft} seconds</span>
        <span>{paused ? "The hold is resting" : "⚙ Simulation active"}</span>
      </footer>
    </main>
  );
}
