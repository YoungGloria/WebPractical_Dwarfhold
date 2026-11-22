export type ResourceKey = "wood" | "stone" | "food" | "tools";
export type JobType = "woodcutting" | "mining" | "farming" | null;
export type DwarfStatus =
  "idle" | "working" | "expedition" | "resting" | "forging";
export interface Resources {
  wood: number;
  stone: number;
  food: number;
  tools: number;
}

export interface Dwarf {
  id: string;
  name: string;
  title: string;
  icon: string;
  assignment: JobType;
  status: DwarfStatus;
  specialty?: Exclude<JobType, null>;
  wasOnExpedition: boolean;
}

export interface ColonyState {
  day: number;
  resources: Resources;
  dwarves: Dwarf[];
  log: Activity[];
  logSeq: number;
}

export interface ExpeditionResult {
  expeditionId: string;
  status: "completed";
  rewards: Partial<Resources>;
  message: string;
}

export interface Activity {
  id: string;
  day: number;
  message: string;
  tone?: "good" | "warning";
}
