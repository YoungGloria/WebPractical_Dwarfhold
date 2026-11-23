import { Chronicle } from "../components/Chronicle";
import { useColony } from "../state/ColonyContext";
import { Recepie } from "../components/Recepie";

export function ForgePage() {
  const { colony, activities, craftTool, craftWeapon } = useColony();

  return (
    <div className="forge-layout">
      <section className="panel forge">
        <Recepie
          colony={colony}
          recepieMethod={craftTool}
          name={"Craft a tool"}
          subText={"Equip the hold for future work."}
          buttonText={"Forge tool"}
          recepieResources={{ wood: 3, stone: 2, output: 1, icon: "⚒️" }}
        />
        <Recepie
          colony={colony}
          recepieMethod={craftWeapon}
          name={"Craft a Weapon"}
          subText={"Equip the hold to protect against future attacks."}
          buttonText={"Forge weapon"}
          recepieResources={{ wood: 4, stone: 3, output: 1, icon: "⚔️" }}
        />
      </section>

      <Chronicle activities={activities} />
    </div>
  );
}
