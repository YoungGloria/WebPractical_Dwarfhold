import type { JobType, Resources } from "../domain/types";

export const production: Record<Exclude<JobType, null>, Partial<Resources>> = {
  woodcutting: { wood: 3 },
  mining: { stone: 2 },
  farming: { food: 4 },
};

export const jobLabel = (job: JobType): string =>
  job
    ? {
        woodcutting: "Woodcutting",
        mining: "Deep Mining",
        farming: "Mushroom Farm",
      }[job]
    : "Unassigned";
