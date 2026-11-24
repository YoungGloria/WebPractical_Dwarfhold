import {ColonyState, PopupNotice} from "../types";
import {log} from "../log";


export function raidAction(state: ColonyState): { ColonyState; PopupNotice } {
    if (state.resources.weapons >= 3) {
        state.resources.weapons -= 3;
        state = log(state, "You were raided. The raid was defeated.", "good");
        return {
            colony: state,
            notice: {
                header: "The Raid was defeated!",
                subHeader: `They appear to have followed your scout.`,
                message: `You defeated the raid! But your weapons are too dull to be used again.`,
            },
        };
    } else {
        const hadweapons = state.resources.weapons > 0 ? true : false;
        state.resources.weapons = 0;
        state.resources.wood = Math.round(state.resources.wood / 2);
        state.resources.stone = Math.round(state.resources.stone / 2);
        state.resources.food = Math.round(state.resources.food / 2);
        state.resources.tools = Math.round(state.resources.tools / 2);

        state = log(state, "You were raided!", "warning");

        return {
            colony: state,
            notice: {
                header: "You have been raided!",
                subHeader: `They appear to have followed your scout.`,
                message: `They stole half of your resources! ${hadweapons ? "Your weapons where not enough and they are to dull to be used again." : "You did not have any weapons to defend your self."}`,
            },
        };
    }
}