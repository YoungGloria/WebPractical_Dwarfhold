import { Chronicle } from "../components/Chronicle";
import { useColony } from "../state/ColonyContext";
import { RecipePanel } from "../components/forge/RecipePanel";

export function ForgePage() {
  const { colony, activities, craftTool, craftWeapon } = useColony();

  return (
    <div className="forge-layout">
      <section className="panel forge">
        <RecipePanel
          colony={colony}
          recipeId="tool"
          onCraft={craftTool}
        />
        <RecipePanel
          colony={colony}
          recipeId="weapon"
          onCraft={craftWeapon}
        />
      </section>

      <Chronicle activities={activities} />
    </div>
  );
}
