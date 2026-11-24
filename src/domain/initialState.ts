import type { ColonyState } from "./types.js";

export function createInitialState(): ColonyState {
  return {
    day: 12,
    resources: {
      wood: 14,
      stone: 9,
      food: 18,
      tools: 1,
      weapons: 0,
    },
    dwarves: [
      {
        id: "dwarf-1",
        species: "dwarf",
        name: "Bromli Copperkeg",
        title: "Hold Warden",
        icon: "🧔🏻",
        assignment: "mining",
        status: "working",
        specialty: "mining",
        hasTool: false,
      },
      {
        id: "dwarf-2",
        species: "dwarf",
        name: "Yrsa Flintbraid",
        title: "Trail Scout",
        icon: "🧔🏼‍♀️",
        assignment: "woodcutting",
        status: "working",
        specialty: "woodcutting",
        hasTool: false,
      },
      {
        id: "dwarf-3",
        species: "dwarf",
        name: "Dori Ashmantle",
        title: "Stone Singer",
        icon: "🧔🏽",
        assignment: null,
        status: "idle",
        hasTool: false,
      },
    ],
    log: [],
    logSeq: 0,
    sirOneUperJoined: false,
  };
}
