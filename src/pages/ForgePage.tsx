import { Chronicle } from "../components/Chronicle";
import { useColony } from "../state/ColonyContext";

export function ForgePage() {
  const { activities, craftTool } = useColony();

  return (
    <div className="forge-layout">
      <section className="panel forge">
        <div>
          <small>EMBER FORGE</small>
          <h2>Craft a tool</h2>
          <p>Equip the hold for future work.</p>
        </div>
        <div className="recipe">
          <span>3 🪵</span>
          <i>+</i>
          <span>2 🪨</span>
          <i>→</i>
          <span>1 ⚒️</span>
          <button onClick={craftTool}>Forge tool</button>
        </div>
      </section>

      <Chronicle activities={activities} />
    </div>
  );
}
