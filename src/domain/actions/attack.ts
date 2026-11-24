import { ColonyState, PopupNotice } from "../types";
import { log } from "../log";
import { RAID_DEFENSE_WEAPONS } from "../../config/constants";

interface RaidActionResult {
  colony: ColonyState;
  notice: PopupNotice;
}

export function raidAction(state: ColonyState): RaidActionResult {
  if (state.resources.weapons >= RAID_DEFENSE_WEAPONS) {
    const defended: ColonyState = {
      ...state,
      resources: {
        ...state.resources,
        weapons: state.resources.weapons - RAID_DEFENSE_WEAPONS,
      },
    };

    return {
      colony: log(defended, "You were raided. The raid was defeated.", "good"),
      notice: {
        header: "The Raid was defeated!",
        subHeader: `They appear to have followed your scout.`,
        message: `You defeated the raid! But your weapons are too dull to be used again.`,
      },
    };
  } else {
    const hadWeapons = state.resources.weapons > 0;
    const looted: ColonyState = {
      ...state,
      resources: {
        wood: Math.round(state.resources.wood / 2),
        stone: Math.round(state.resources.stone / 2),
        food: Math.round(state.resources.food / 2),
        tools: Math.round(state.resources.tools / 2),
        weapons: 0,
      },
    };
    return {
      colony: log(
        looted,
        "You were raided. They stole half of your resources.",
        "warning",
      ),
      notice: {
        header: "You have been raided!",
        subHeader: `They appear to have followed your scout.`,
        message: `They stole half of your resources! ${hadWeapons ? "Your weapons where not enough and they are to dull to be used again." : "You did not have any weapons to defend your self."}`,
      },
    };
  }
}
