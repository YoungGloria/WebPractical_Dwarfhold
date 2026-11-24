/**
 * Test for requirement D1 - Consistent daily simulation
 *
 * Covers the following subtask classifications:
 *
 * [D1.1] Work assignments
 *        - working and idle dwarves can receive exactly one job
 *        - re-assigning the same job and changing between jobs works
 *        - a dwarf can be unassigned
 *        - only the targeted dwarf changes (tool, specialty, others untouched)
 *        - unavailable (expedition, resting, forging tool/weapon) and unknown
 *          dwarves cannot receive or change jobs
 *
 * [D1.2] Production
 *        - assigned woodcutting, mining and farming jobs produce normally
 *        - idle, expedition, resting and forging (tool/weapon) dwarves produce nothing
 *        - resting dwarves recover for the next day but skip the current day
 *        - all productive dwarves are counted once and input state stays unchanged
 *        - the day counter increases by exactly one
 *
 * [D1.3] Food consumption
 *        - every dwarf consumes exactly one food per day
 *        - available and unavailable dwarves are all included in meal consumption
 *        - food never becomes negative
 *        - an empty colony consumes nothing
 *
 * [D1.4] Worker availability and consistent daily simulation
 *        - work status and unavailable statuses remain consistent
 *        - assignment and status changes do not mutate the input state
 *        - resting status is reset only after its production day has been skipped
 *        - an unassigned resting dwarf returns to idle, an assigned one to working
 *
 * [D1.5] At most one activity at a time
 *        - assignment changes are rejected while travelling, resting or forging
 *        - unavailable dwarves contribute no production
 *        - a rejected change leaves the very same state object (no side effect, no log)
 *
 * [D1.6] Food shortage consequence
 *        - famine is detected only when rations are insufficient (boundary: exact fit)
 *        - all productive jobs receive exactly the deterministic famine modifier (-1)
 *        - the famine modifier combines correctly with an equipped tool
 *        - famine is announced in the chronicle exactly once per affected day
 *        - food never drops below zero
 *
 * [D1.7] Interface and determinism
 *        - expected production values remain stable
 *        - repeated famine calculations produce the same resources
 *        - the interface uses a visible famine popup to explain the consequence
 *        - no famine popup is shown while the food is sufficient
 *
 * The detailed positive, negative and edge cases are grouped below by
 * assignment/availability, production, food consumption and shortage behavior.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { assignJob } from "../../domain/actions/assignment";
import { advanceDay } from "../../domain/simulation/advanceDay";
import { isProducing } from "../../domain/rules/availability";
import { production } from "../../config/jobs";
import { Layout } from "../../pages/Layout";
import {
  ColonyContext,
  type ColonyContextValue,
} from "../../state/ColonyContext";
import type {
  ColonyState,
  Dwarf,
  DwarfStatus,
  JobType,
} from "../../domain/types";
import { isFamine } from "../../domain/rules/famine";

const UNAVAILABLE: DwarfStatus[] = [
  "expedition",
  "resting",
  "forging_Tool",
  "forging_Weapon",
];

function makeDwarf(
  id: string,
  assignment: JobType = "mining",
  status: DwarfStatus = "working",
  extra: Partial<Dwarf> = {},
): Dwarf {
  return {
    id,
    species: "dwarf",
    name: `Dwarf ${id}`,
    title: "",
    icon: "",
    assignment,
    status,
    hasTool: false,
    ...extra,
  };
}

function makeState(dwarves: Dwarf[] = [makeDwarf("dwarf-1")]): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1, weapons: 0 },
    dwarves,
    log: [],
    logSeq: 0,
    sirOneUperJoined: false,
  };
}

function dwarfOf(state: ColonyState, id: string): Dwarf {
  const dwarf = state.dwarves.find((item) => item.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
}

function renderLayout(colony: ColonyState): string {
  const value = {
    colony,
    paused: false,
    activities: colony.log,
    expeditionPending: false,
    dayPhase: "EARLY MORNING",
    daySecondsLeft: 8,
    restoreNotice: null,
  } as ColonyContextValue;

  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ColonyContext.Provider, { value }, createElement(Layout)),
    ),
  );
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

    it("keeps a single assignment value after several consecutive changes", () => {
      let state = makeState();
      state = assignJob(state, "dwarf-1", "farming");
      state = assignJob(state, "dwarf-1", "woodcutting");
      state = assignJob(state, "dwarf-1", "mining");

      expect(dwarfOf(state, "dwarf-1").assignment).toBe("mining");
      expect(state.dwarves).toHaveLength(1);
    });

    it("accepts re-assigning the job a dwarf already has", () => {
      const state = assignJob(makeState(), "dwarf-1", "mining");
      const dwarf = dwarfOf(state, "dwarf-1");

      expect(dwarf.assignment).toBe("mining");
      expect(dwarf.status).toBe("working");
    });

    it("can unassign a dwarf", () => {
      const reassigned = assignJob(makeState(), "dwarf-1", null);
      const dwarf = dwarfOf(reassigned, "dwarf-1");

      expect(dwarf.assignment).toBeNull();
      expect(dwarf.status).toBe("idle");
    });

    it("unassigning an already idle dwarf keeps it idle", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);
      const dwarf = dwarfOf(assignJob(state, "dwarf-1", null), "dwarf-1");

      expect(dwarf.assignment).toBeNull();
      expect(dwarf.status).toBe("idle");
    });

    it("only changes the targeted dwarf and keeps its other properties", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "working", {
          hasTool: true,
          specialty: "mining",
          name: "Bromli",
        }),
        makeDwarf("dwarf-2", "woodcutting"),
      ]);
      const next = assignJob(state, "dwarf-1", "farming");

      expect(dwarfOf(next, "dwarf-1")).toMatchObject({
        name: "Bromli",
        hasTool: true,
        specialty: "mining",
        assignment: "farming",
      });
      expect(dwarfOf(next, "dwarf-2")).toEqual(dwarfOf(state, "dwarf-2"));
      expect(next.resources).toEqual(state.resources);
    });

    it("records the assignment in the chronicle", () => {
      const next = assignJob(makeState(), "dwarf-1", "farming");

      expect(next.log).toHaveLength(1);
      expect(next.log[0].message).toContain("Dwarf dwarf-1");
    });

    it.each(UNAVAILABLE)(
      "rejects assignment changes for a dwarf with status %s",
      (status) => {
        const state = makeState([makeDwarf("dwarf-1", "mining", status)]);

        expect(assignJob(state, "dwarf-1", "farming")).toBe(state);
        expect(assignJob(state, "dwarf-1", null)).toBe(state);
      },
    );

    it("rejects assignment changes for an unknown dwarf", () => {
      const state = makeState();

      expect(assignJob(state, "missing-dwarf", "farming")).toBe(state);
    });

    it("rejects assignment changes in an empty colony", () => {
      const state = makeState([]);

      expect(assignJob(state, "dwarf-1", "farming")).toBe(state);
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

    it("only changes the resource of the assigned job", () => {
      const next = advanceDay(makeState([makeDwarf("dwarf-1", "woodcutting")]));

      expect(next.resources).toEqual({
        wood: 17,
        stone: 9,
        food: 17,
        tools: 1,
        weapons: 0,
      });
    });

    it("does not produce for an unassigned idle dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);
      const next = advanceDay(state);

      expect(next.resources).toEqual({
        wood: 14,
        stone: 9,
        food: 17,
        tools: 1,
        weapons: 0,
      });
    });

    it.each(UNAVAILABLE)(
      "does not produce while the dwarf has status %s",
      (status) => {
        const state = makeState([makeDwarf("dwarf-1", "mining", status)]);

        expect(isProducing(dwarfOf(state, "dwarf-1"))).toBe(false);
        expect(advanceDay(state).resources.stone).toBe(state.resources.stone);
      },
    );

    it("treats working and idle-with-job statuses as productive", () => {
      expect(isProducing(makeDwarf("d", "mining", "working"))).toBe(true);
      expect(isProducing(makeDwarf("d", null, "working"))).toBe(false);
      expect(isProducing(makeDwarf("d", null, "idle"))).toBe(false);
    });

    it("restores a resting dwarf only after it skipped the current activity", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting", "resting")]);
      const next = advanceDay(state);

      expect(next.resources.wood).toBe(state.resources.wood);
      expect(dwarfOf(next, "dwarf-1").status).toBe("working");
    });

    it("produces again on the day after a resting dwarf recovered", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting", "resting")]);
      const dayTwo = advanceDay(advanceDay(state));

      expect(dayTwo.resources.wood).toBe(state.resources.wood + 3);
    });

    it("adds production for all productive dwarves without duplication", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "woodcutting"),
      ]);
      const next = advanceDay(state);

      expect(next.resources.wood).toBe(20);
    });

    it("mixes productive and unavailable dwarves correctly", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "mining", "expedition"),
        makeDwarf("dwarf-3", "farming", "forging_Tool"),
        makeDwarf("dwarf-4", "mining", "forging_Weapon"),
      ]);
      const next = advanceDay(state);

      expect(next.resources).toMatchObject({
        wood: 17,
        stone: 9,
        food: 14,
      });
    });

    it("advances the day counter by exactly one", () => {
      expect(advanceDay(makeState()).day).toBe(13);
    });

    it("does not mutate the input state", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting", "working")]);
      const snapshot = structuredClone(state);

      advanceDay(state);

      expect(state).toEqual(snapshot);
    });

    it("does not mutate the input state during famine", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "mining", "resting"),
      ]);
      state.resources.food = 0;
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

    it("keeps food at zero when there is nothing to eat", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);
      state.resources.food = 0;

      expect(advanceDay(state).resources.food).toBe(0);
    });

    it("leaves food exactly at zero when rations match the company", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle"),
        makeDwarf("dwarf-2", null, "idle"),
      ]);
      state.resources.food = 2;

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

    it("feeds forging dwarves as well", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "forging_Tool"),
        makeDwarf("dwarf-2", "mining", "forging_Weapon"),
      ]);
      state.resources.food = 10;

      expect(advanceDay(state).resources.food).toBe(8);
    });

    it("adds farming output before the meals are deducted", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "farming"),
        makeDwarf("dwarf-2", null, "idle"),
      ]);
      state.resources.food = 5;

      expect(advanceDay(state).resources.food).toBe(5 + 4 - 2);
    });

    it("consumes nothing and only advances the day in an empty colony", () => {
      const next = advanceDay(makeState([]));

      expect(next.day).toBe(13);
      expect(next.resources).toEqual(makeState([]).resources);
    });
  });

  describe("worker availability consistency", () => {
    it("keeps working dwarves working and idle dwarves idle across a day", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "working"),
        makeDwarf("dwarf-2", null, "idle"),
      ]);
      const next = advanceDay(state);

      expect(dwarfOf(next, "dwarf-1").status).toBe("working");
      expect(dwarfOf(next, "dwarf-2").status).toBe("idle");
    });

    it("sends an unassigned resting dwarf back to idle, not to working", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "resting")]);

      expect(dwarfOf(advanceDay(state), "dwarf-1").status).toBe("idle");
    });

    it.each(["expedition", "forging_Tool", "forging_Weapon"] as const)(
      "does not release a %s dwarf at the end of the day",
      (status) => {
        const state = makeState([makeDwarf("dwarf-1", "mining", status)]);

        expect(dwarfOf(advanceDay(state), "dwarf-1").status).toBe(status);
      },
    );

    it("keeps dwarf assignment, tool and specialty untouched by the day change", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "resting", {
          hasTool: true,
          specialty: "mining",
        }),
      ]);
      const dwarf = dwarfOf(advanceDay(state), "dwarf-1");

      expect(dwarf).toMatchObject({
        assignment: "mining",
        hasTool: true,
        specialty: "mining",
      });
    });

    it("does not mutate the input state when changing assignments", () => {
      const state = makeState();
      const snapshot = structuredClone(state);

      assignJob(state, "dwarf-1", "farming");

      expect(state).toEqual(snapshot);
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

    it("does not detect famine when rations exceed the need", () => {
      const state = makeState([makeDwarf("dwarf-1")]);
      state.resources.food = 50;

      expect(isFamine(state)).toBe(false);
    });

    it("detects famine with zero food and at least one dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1")]);
      state.resources.food = 0;

      expect(isFamine(state)).toBe(true);
    });

    it("never detects famine in an empty colony, even without food", () => {
      const state = makeState([]);
      state.resources.food = 0;

      expect(isFamine(state)).toBe(false);
    });

    it("counts unavailable dwarves when checking whether food is sufficient", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle"),
        makeDwarf("dwarf-2", "mining", "expedition"),
        makeDwarf("dwarf-3", "mining", "resting"),
      ]);
      state.resources.food = 2;

      expect(isFamine(state)).toBe(true);
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

    it("does not reduce production when rations exactly cover the company", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting")]);
      state.resources.food = 1;

      expect(advanceDay(state).resources.wood).toBe(state.resources.wood + 3);
    });

    it("applies the famine modifier to every productive dwarf of the same job", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting"),
        makeDwarf("dwarf-2", "woodcutting"),
        makeDwarf("dwarf-3", "woodcutting"),
      ]);
      state.resources.food = 0;

      expect(advanceDay(state).resources.wood).toBe(state.resources.wood + 6);
    });

    it("does not give unavailable dwarves a famine bonus or penalty", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "expedition"),
        makeDwarf("dwarf-2", "mining", "resting"),
      ]);
      state.resources.food = 0;

      expect(advanceDay(state).resources.stone).toBe(state.resources.stone);
    });

    it("combines the famine modifier with an equipped tool (+1 -1)", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting", "working", { hasTool: true }),
      ]);
      state.resources.food = 0;

      expect(advanceDay(state).resources.wood).toBe(state.resources.wood + 3);
    });

    it("never produces a negative resource amount during famine", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining"),
        makeDwarf("dwarf-2", "farming"),
      ]);
      state.resources = { wood: 0, stone: 0, food: 0, tools: 0, weapons: 0 };

      const next = advanceDay(state);

      for (const value of Object.values(next.resources)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    });

    it("keeps food from dropping below zero during famine", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle"),
        makeDwarf("dwarf-2", null, "idle"),
        makeDwarf("dwarf-3", null, "idle"),
      ]);
      state.resources.food = 1;

      expect(advanceDay(state).resources.food).toBe(0);
    });

    it("announces famine once as a warning in the chronicle", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      state.resources.food = 0;
      const next = advanceDay(state);
      const famineEntries = next.log.filter((entry) =>
        entry.message.toLowerCase().includes("famine"),
      );

      expect(famineEntries).toHaveLength(1);
      expect(famineEntries[0].tone).toBe("warning");
    });

    it("does not write a famine message when food is sufficient", () => {
      const next = advanceDay(makeState());

      expect(next.log).toHaveLength(0);
    });

    it("recovers from famine when the farmers rebuild the stores", () => {
      let state = makeState([
        makeDwarf("dwarf-1", "farming"),
        makeDwarf("dwarf-2", "farming"),
      ]);
      state.resources.food = 0;

      state = advanceDay(state);
      expect(state.resources.food).toBe(4);
      expect(isFamine(state)).toBe(false);

      state = advanceDay(state);
      expect(state.resources.food).toBe(10);
    });
  });

  describe("interface and determinism", () => {
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

    it("produces identical results for identical input over several days", () => {
      const make = () =>
        makeState([
          makeDwarf("dwarf-1", "woodcutting"),
          makeDwarf("dwarf-2", "farming", "resting"),
          makeDwarf("dwarf-3", "mining"),
        ]);
      const run = (state: ColonyState) =>
        [1, 2, 3, 4, 5].reduce((s) => advanceDay(s), state);

      expect(run(make())).toEqual(run(make()));
    });

    it("shows a visible famine popup that explains the consequence", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      state.resources.food = 1;
      const html = renderLayout(state);

      expect(html).toContain("Famine");
      expect(html).toContain("starving");
      expect(html).toContain("reduced by 1");
    });

    it("shows the famine popup while food is exactly zero with dwarves present", () => {
      const state = makeState([makeDwarf("dwarf-1")]);
      state.resources.food = 0;

      expect(renderLayout(state)).toContain("Famine");
    });

    it("does not show the famine popup when rations cover everyone", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      state.resources.food = 2;

      expect(renderLayout(state)).not.toContain("Famine");
    });

    it("announced famine penalty matches the simulated penalty", () => {
      const state = makeState([makeDwarf("dwarf-1", "woodcutting")]);
      state.resources.food = 0;
      const normal = makeState([makeDwarf("dwarf-1", "woodcutting")]);

      const penalty =
        advanceDay(normal).resources.wood - advanceDay(state).resources.wood;

      expect(penalty).toBe(1);
      expect(renderLayout(state)).toContain(`reduced by ${penalty}`);
    });
  });
});
