import {
  FORGE_TOOL_SECONDS,
  FORGE_WEAPON_SECONDS,
} from "./constants";

export type RecipeId = "tool" | "weapon";

export interface RecipeDefinition {
  name: string;
  subText: string;
  buttonText: string;
  wood: number;
  stone: number;
  output: number;
  icon: "⚒️" | "⚔️";
  durationSeconds: number;
}

export const recipes: Record<RecipeId, RecipeDefinition> = {
  tool: {
    name: "Craft a tool",
    subText: "Equip the hold for future work.",
    buttonText: "Forge tool",
    wood: 3,
    stone: 2,
    output: 1,
    icon: "⚒️",
    durationSeconds: FORGE_TOOL_SECONDS,
  },
  weapon: {
    name: "Craft a Weapon",
    subText: "Equip the hold to protect against future attacks.",
    buttonText: "Forge weapon",
    wood: 4,
    stone: 3,
    output: 1,
    icon: "⚔️",
    durationSeconds: FORGE_WEAPON_SECONDS,
  },
};