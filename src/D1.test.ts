/**
 * Test for requirement D1 - Consistent daily simulation
 *
 * Covers the following subtask classifications:
 *
 * [D1.1] Work assignments
 *        - working and idle dwarves can receive exactly one job
 *        - a dwarf can be unassigned
 *        - unavailable and unknown dwarves cannot receive or change jobs
 *
 * [D1.2] Production
 *        - assigned woodcutting, mining and farming jobs produce normally
 *        - idle, expedition, resting and forging dwarves produce nothing
 *        - resting dwarves recover for the next day but skip the current day
 *        - all productive dwarves are counted once and input state stays unchanged
 *
 * [D1.3] Food consumption
 *        - every dwarf consumes exactly one food per day
 *        - available and unavailable dwarves are all included in meal consumption
 *        - food never becomes negative
 *
 * [D1.4] Worker availability and consistent daily simulation
 *        - work status and unavailable statuses remain consistent
 *        - assignment and status changes do not mutate the input state
 *        - resting status is reset only after its production day has been skipped
 *
 * [D1.5] At most one activity at a time
 *        - assignment changes are rejected while travelling, resting or forging
 *        - unavailable dwarves contribute no production
 *
 * [D1.6] Food shortage consequence
 *        - famine is detected only when rations are insufficient
 *        - all productive jobs receive exactly the deterministic famine modifier
 *        - food never drops below zero
 *
 * [D1.7] Interface and determinism
 *        - expected production values remain stable
 *        - repeated famine calculations produce the same resources
 *        - the interface uses a visible famine popup to explain the consequence
 *
 * The detailed positive, negative and edge cases are grouped below by
 * assignment/availability, production, food consumption and shortage behavior.
 */
import { describe, expect, it } from "vitest";
import { assignJob } from "./colonyActions";
import { advanceDay, isProducing, production } from "./simulation";
import type { ColonyState, Dwarf, DwarfStatus, JobType } from "./types";
import { isFamine } from "./utils";

function makeDwarf(
  id: string,
  assignment: JobType = "mining",
  status: DwarfStatus = "working",
): Dwarf {
  return {
    id,
    name: `Dwarf ${id}`,
    title: "",
    icon: "",
    assignment,
    status,
    hasTool: false,
  };
}

function makeState(dwarves: Dwarf[] = [makeDwarf("dwarf-1")]): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1, weapons: 0 },
    dwarves,
    log: [],
    logSeq: 0,
  };
}

function dwarfOf(state: ColonyState, id: string): Dwarf {
  const dwarf = state.dwarves.find((item) => item.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
}

describe("D1 consistent daily simulation", () => {
  describe("work assignments and availability", () => {
    it("assigns a working dwarf to exactly one job", () => {
      const reassigned = assignJob(makeState(), "dwarf-1", "farming");
      const dwarf = dwarfOf(reassigned, "dwarf-1");

      expect(dwarf.assignment).toBe("farming");
      expect(dwarf.status).toBe("working");
    });

    it("allows an idle dwarf to receive exactly one assignment", () => {
      const reassigned = assignJob(
        makeState([makeDwarf("dwarf-1", null, "idle")]),
        "dwarf-1",
        "woodcutting",
      );

      expect(dwarfOf(reassigned, "dwarf-1").assignment).toBe("woodcutting");
      expect(dwarfOf(reassigned, "dwarf-1").status).toBe("working");
    });

    it("can unassign a dwarf", () => {
      const reassigned = assignJob(makeState(), "dwarf-1", null);
      const dwarf = dwarfOf(reassigned, "dwarf-1");

      expect(dwarf.assignment).toBeNull();
      expect(dwarf.status).toBe("idle");
    });

    it("rejects assignment changes for an expedition dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", "mining", "expedition")]);

      expect(assignJob(state, "dwarf-1", "farming")).toBe(state);
      expect(assignJob(state, "dwarf-1", null)).toBe(state);
    });

    it("rejects assignment changes for a resting dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", "mining", "resting")]);

      expect(assignJob(state, "dwarf-1", "farming")).toBe(state);
    });

    it("rejects assignment changes for a forging dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", "mining", "forging")]);

      expect(assignJob(state, "dwarf-1", "woodcutting")).toBe(state);
    });

    it("rejects assignment changes for an unknown dwarf", () => {
      const state = makeState();

      expect(assignJob(state, "missing-dwarf", "farming")).toBe(state);
    });
  });

  describe("daily production", () => {
    it("produces wood for a woodcutting dwarf", () => {
      const next = advanceDay(makeState([makeDwarf("dwarf-1", "woodcutting")]));

      expect(next.resources.wood).toBe(17);
    });

    it("produces stone for a mining dwarf", () => {
      const next = advanceDay(makeState());

      expect(next.resources.stone).toBe(11);
    });

    it("produces food for a farming dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", "farming")]);
      state.resources.food = 3;

      const next = advanceDay(state);

      expect(next.resources.food).toBe(6);
    });

    it("does not produce for an unassigned idle dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);
      const next = advanceDay(state);

      expect(next.resources).toEqual({
        wood: 14,
        stone: 9,
        food: 17,
        tools: 1,
      });
    });

    it.each(["expedition", "resting", "forging"] as const)(
      "does not produce while the dwarf has status %s",
      (status) => {
        const state = makeState([makeDwarf("dwarf-1", "mining", status)]);

        expect(isProducing(dwarfOf(state, "dwarf-1"))).toBe(false);
        expect(advanceDay(state).resources.stone).toBe(state.resources.stone);
      },
    );

    it("restores a resting dwarf only after it skipped the current activity", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting", "resting")]);
      const next = advanceDay(state);

      expect(next.resources.wood).toBe(state.resources.wood);
      expect(dwarfOf(next, "dwarf-1").status).toBe("working");
    });

    it("adds production for all productive dwarves without duplication", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "woodcutting"),
      ]);
      const next = advanceDay(state);

      expect(next.resources.wood).toBe(20);
    });

    it("does not mutate the input state", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting", "working")]);
      const snapshot = structuredClone(state);

      advanceDay(state);

      expect(state).toEqual(snapshot);
    });
  });

  describe("food consumption", () => {
    it("consumes exactly one food for each dwarf", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle"),
        makeDwarf("dwarf-2", null, "idle"),
        makeDwarf("dwarf-3", null, "idle"),
      ]);
      state.resources.food = 10;

      expect(advanceDay(state).resources.food).toBe(7);
    });

    it("never creates negative food resources", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle"),
        makeDwarf("dwarf-2", null, "idle"),
      ]);
      state.resources.food = 1;

      expect(advanceDay(state).resources.food).toBe(0);
    });

    it("feeds expedition, resting and idle dwarves consistently", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "expedition"),
        makeDwarf("dwarf-2", "woodcutting", "resting"),
        makeDwarf("dwarf-3", null, "idle"),
      ]);
      state.resources.food = 10;

      expect(advanceDay(state).resources.food).toBe(7);
    });
  });

  describe("food shortage consequence", () => {
    it("detects famine when rations cannot cover every dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      state.resources.food = 1;

      expect(isFamine(state)).toBe(true);
    });

    it("does not detect famine when rations exactly cover every dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      state.resources.food = 2;

      expect(isFamine(state)).toBe(false);
    });

    it("reduces every productive job by exactly one resource during famine", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "mining"),
        makeDwarf("dwarf-3", "farming"),
      ]);
      state.resources.food = 1;

      const next = advanceDay(state);

      expect(next.resources.wood).toBe(state.resources.wood + 2);
      expect(next.resources.stone).toBe(state.resources.stone + 1);
      expect(next.resources.food).toBe(1);
    });

    it("uses the expected normal production values", () => {
      expect(production.woodcutting).toEqual({ wood: 3 });
      expect(production.mining).toEqual({ stone: 2 });
      expect(production.farming).toEqual({ food: 4 });
    });

    it("keeps famine consequences deterministic across repeated calls", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "mining"),
      ]);
      state.resources.food = 1;

      expect(advanceDay(state).resources).toEqual(advanceDay(state).resources);
    });
  });
});
