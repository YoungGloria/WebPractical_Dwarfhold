import { describe, expect, it } from "vitest";
import {
  assignJob,
  completeExpeditionAction,
  failExpeditionAction,
  startExpeditionAction,
} from "./colonyActions";
import type { ColonyState, DwarfStatus, JobType } from "./types";

function createExpeditionState(
  assignment: JobType = "mining",
  status: DwarfStatus = "working",
): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1 },
    dwarves: [
      {
        id: "dwarf-1",
        name: "Bromli Copperkeg",
        title: "Hold Warden",
        icon: "",
        assignment,
        status,
      },
    ],
    log: [],
    logSeq: 0,
  };
}

describe("D4 expeditions", () => {
  describe("D4.1 send an eligible dwarf", () => {
    it("starts an expedition for an idle dwarf", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(null, "idle"),
        "dwarf-1",
        "crystal-cave",
      );

      expect(travelling.dwarves[0]?.status).toBe("expedition");
      expect(travelling.log[0]?.message).toContain("crystal cave");
    });

    it("starts an expedition for a working dwarf", () => {
      const travelling = startExpeditionAction(
        createExpeditionState("mining", "working"),
        "dwarf-1",
        "old-mine",
      );

      expect(travelling.dwarves[0]?.status).toBe("expedition");
      expect(travelling.dwarves[0]?.assignment).toBe("mining");
    });

    it("rejects an unknown dwarf without changing state", () => {
      const state = createExpeditionState();

      expect(
        startExpeditionAction(state, "missing-dwarf", "crystal-cave"),
      ).toBe(state);
    });
  });

  describe("D4.2 unavailable while travelling", () => {
    it("changes the dwarf status to expedition", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(),
        "dwarf-1",
        "old-mine",
      );

      expect(travelling.dwarves[0]?.status).toBe("expedition");
    });

    it("rejects a second start while the dwarf is travelling", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(),
        "dwarf-1",
        "old-mine",
      );

      expect(
        startExpeditionAction(travelling, "dwarf-1", "crystal-cave"),
      ).toBe(travelling);
    });

    it("does not allow a job assignment while travelling", () => {
      const travelling = startExpeditionAction(
        createExpeditionState("mining", "working"),
        "dwarf-1",
        "old-mine",
      );

      expect(assignJob(travelling, "dwarf-1", "farming")).toBe(travelling);
    });
  });

  describe("D4.3 success rewards exactly once", () => {
    it("applies each successful reward once", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(),
        "dwarf-1",
        "crystal-cave",
      );

      const completed = completeExpeditionAction(
        travelling,
        "dwarf-1",
        { stone: 8, tools: 1 },
        "Crystal seam found.",
      );

      expect(completed.resources).toMatchObject({ stone: 17, tools: 2 });
    });

    it("ignores a repeated completion response", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(),
        "dwarf-1",
        "crystal-cave",
      );
      const completed = completeExpeditionAction(
        travelling,
        "dwarf-1",
        { stone: 8 },
        "Crystal seam found.",
      );

      expect(
        completeExpeditionAction(
          completed,
          "dwarf-1",
          { stone: 8 },
          "Duplicate response.",
        ),
      ).toBe(completed);
    });

    it("ignores completion for a dwarf that did not start travelling", () => {
      const state = createExpeditionState();

      expect(
        completeExpeditionAction(
          state,
          "dwarf-1",
          { stone: 8 },
          "Unexpected result.",
        ),
      ).toBe(state);
    });
  });

  describe("D4.4 failed requests award no resources", () => {
    it("preserves resources after failure", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(),
        "dwarf-1",
        "blocked-pass",
      );

      const failed = failExpeditionAction(
        travelling,
        "dwarf-1",
        "Rockfall sealed the route.",
      );

      expect(failed.resources).toEqual(travelling.resources);
      expect(failed.log[0]?.tone).toBe("warning");
    });

    it("ignores a failure for a dwarf that never started travelling", () => {
      const state = createExpeditionState();

      expect(
        failExpeditionAction(state, "dwarf-1", "Stale failure"),
      ).toBe(state);
    });
  });

  describe("D4.5 failure restores availability", () => {
    it("returns a working dwarf to its previous job", () => {
      const travelling = startExpeditionAction(
        createExpeditionState("mining", "working"),
        "dwarf-1",
        "blocked-pass",
      );

      const failed = failExpeditionAction(
        travelling,
        "dwarf-1",
        "Rockfall sealed the route.",
      );

      expect(failed.dwarves[0]?.status).toBe("working");
      expect(failed.dwarves[0]?.assignment).toBe("mining");
    });

    it("returns an idle dwarf to idle", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(null, "idle"),
        "dwarf-1",
        "blocked-pass",
      );

      const failed = failExpeditionAction(
        travelling,
        "dwarf-1",
        "Rockfall sealed the route.",
      );

      expect(failed.resources).toEqual(travelling.resources);
      expect(failed.dwarves[0]?.status).toBe("idle");
      expect(failed.dwarves[0]?.assignment).toBeNull();
    });
  });

  describe("D4.6 slow and repeated actions", () => {
    it("ignores a late failure after success", () => {
      const travelling = startExpeditionAction(
        createExpeditionState("farming", "working"),
        "dwarf-1",
        "old-mine",
      );
      const completed = completeExpeditionAction(
        travelling,
        "dwarf-1",
        { stone: 12, wood: 2 },
        "The old mine yielded supplies.",
      );

      expect(
        failExpeditionAction(completed, "dwarf-1", "Late failure"),
      ).toBe(completed);
    });

    it("allows a new expedition only after the first has finished", () => {
      const travelling = startExpeditionAction(
        createExpeditionState("farming", "working"),
        "dwarf-1",
        "old-mine",
      );
      const completed = completeExpeditionAction(
        travelling,
        "dwarf-1",
        { stone: 12, wood: 2 },
        "The old mine yielded supplies.",
      );
      const nextExpedition = startExpeditionAction(
        completed,
        "dwarf-1",
        "crystal-cave",
      );

      expect(completed.dwarves[0]?.assignment).toBe("farming");
      expect(completed.dwarves[0]?.status).toBe("working");
      expect(nextExpedition.dwarves[0]?.status).toBe("expedition");
    });
  });

  describe("D4.7 equipped-tool policy", () => {
    it("keeps existing tools in colony inventory during travel", () => {
      const state = createExpeditionState();

      const travelling = startExpeditionAction(
        state,
        "dwarf-1",
        "crystal-cave",
      );

      expect(travelling.resources.tools).toBe(state.resources.tools);
    });

    it("adds a tool reward without first subtracting a tool", () => {
      const travelling = startExpeditionAction(
        createExpeditionState(),
        "dwarf-1",
        "crystal-cave",
      );
      const completed = completeExpeditionAction(
        travelling,
        "dwarf-1",
        { tools: 1 },
        "An abandoned mason's tool was found.",
      );

      expect(completed.resources.tools).toBe(2);
    });
  });

});
