/**
 * Test for requirement D3 - Crafting as colony work
 *
 * Covers the following subtask classifications:
 *
 * [D3.1] Materials
 *        - a tool costs 3 wood + 2 stone, a weapon costs 4 wood + 3 stone
 *        - materials are deducted when the work starts, exactly once
 *        - exact-fit materials are sufficient, one unit less is not
 *        - two crafts cannot be paid from materials that only suffice for one
 *
 * [D3.2] Eligible character
 *        - only a dwarf with a specialty may craft
 *        - unknown dwarves and generalists are rejected
 *        - travelling, resting and already forging dwarves are rejected
 *
 * [D3.3] Crafting takes time
 *        - starting a craft does not yet create the item (no immediate crafting)
 *        - the crafter is marked as forging and cannot work, travel or craft again
 *        - the forging durations are positive and the weapon takes longer
 *        - the result is created exactly once on completion
 *        - after completion the crafter rests until the next day
 *
 * [D3.4] Invalid attempts change nothing
 *        - missing materials, ineligible workers and busy workers leave the
 *          very same state object (no resources, workers or chronicle changed)
 *        - completing a craft for a dwarf that is not forging has no effect
 *        - completing twice does not duplicate the item
 *
 * [D3.5] Consistency with the daily simulation
 *        - a forging dwarf produces nothing but still eats
 *        - input state is never mutated
 *        - other dwarves and unrelated resources stay untouched
 *
 * [D3.6] Interface
 *        - the forge shows who is crafting and the remaining time until completion
 *        - the forge button is disabled until an eligible specialist is selected
 *        - the chronicle names the crafter on start and on completion
 *
 * The detailed positive, negative and edge cases are grouped below by
 * materials, eligibility, timing, invalid attempts and interface.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  completeCraftToolAction,
  completeCraftWeaponAction,
  craftToolAction,
  craftWeaponAction,
} from "../../colonyActions";
import {
  advanceDay,
  FORGE_TOOL_SECONDS,
  FORGE_WEAPON_SECONDS,
} from "../../simulation";
import { Recepie } from "../../components/Recepie";
import type {
  ColonyState,
  Dwarf,
  DwarfStatus,
  JobType,
} from "../../domain/types";

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

const specialist = (
  id = "dwarf-1",
  status: DwarfStatus = "working",
  extra: Partial<Dwarf> = {},
) => makeDwarf(id, "mining", status, { specialty: "mining", ...extra });

function makeState(dwarves: Dwarf[] = [specialist()]): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1, weapons: 0 },
    dwarves,
    log: [],
    logSeq: 0,
    sirOneUperJoined: false,
  };
}

const dwarfOf = (state: ColonyState, id: string): Dwarf => {
  const dwarf = state.dwarves.find((item) => item.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
};

const BUSY: DwarfStatus[] = [
  "expedition",
  "resting",
  "forging_Tool",
  "forging_Weapon",
];

const recipeProps = (colony: ColonyState) =>
  ({
    colony,
    name: "Craft a tool",
    subText: "Equip the hold for future work.",
    buttonText: "Forge tool",
    recepieResources: { wood: 3, stone: 2, output: 1, icon: "⚒️" as const },
  }) as ComponentProps<typeof Recepie>;

describe("D3 crafting as colony work", () => {
  describe("materials", () => {
    it("deducts 3 wood and 2 stone when a tool is started", () => {
      const next = craftToolAction(makeState(), "dwarf-1");

      expect(next.resources.wood).toBe(11);
      expect(next.resources.stone).toBe(7);
    });

    it("deducts 4 wood and 3 stone when a weapon is started", () => {
      const next = craftWeaponAction(makeState(), "dwarf-1");

      expect(next.resources.wood).toBe(10);
      expect(next.resources.stone).toBe(6);
    });

    it("does not touch food, tools or weapons when starting a craft", () => {
      const state = makeState();
      const next = craftToolAction(state, "dwarf-1");

      expect(next.resources.food).toBe(state.resources.food);
      expect(next.resources.tools).toBe(state.resources.tools);
      expect(next.resources.weapons).toBe(state.resources.weapons);
    });

    it("does not deduct materials again when the craft completes", () => {
      const started = craftToolAction(makeState(), "dwarf-1");
      const finished = completeCraftToolAction(started, "dwarf-1");

      expect(finished.resources.wood).toBe(started.resources.wood);
      expect(finished.resources.stone).toBe(started.resources.stone);
    });

    it("accepts exactly the required tool materials", () => {
      const state = makeState();
      state.resources.wood = 3;
      state.resources.stone = 2;
      const next = craftToolAction(state, "dwarf-1");

      expect(next.resources.wood).toBe(0);
      expect(next.resources.stone).toBe(0);
      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Tool");
    });

    it("rejects a tool with one wood too little", () => {
      const state = makeState();
      state.resources.wood = 2;

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects a tool with one stone too little", () => {
      const state = makeState();
      state.resources.stone = 1;

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects a tool when there are no materials at all", () => {
      const state = makeState();
      state.resources.wood = 0;
      state.resources.stone = 0;

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects a weapon with one wood too little", () => {
      const state = makeState();
      state.resources.wood = 3;

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects a weapon with one stone too little", () => {
      const state = makeState();
      state.resources.stone = 2;

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("accepts a tool with enough wood but a weapon would be rejected (4/3 vs 3/2)", () => {
      const state = makeState();
      state.resources.wood = 3;
      state.resources.stone = 2;

      expect(craftToolAction(state, "dwarf-1")).not.toBe(state);
      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("cannot pay two crafts from materials that only suffice for one", () => {
      const state = makeState([specialist("dwarf-1"), specialist("dwarf-2")]);
      state.resources.wood = 3;
      state.resources.stone = 2;

      const afterFirst = craftToolAction(state, "dwarf-1");
      const afterSecond = craftToolAction(afterFirst, "dwarf-2");

      expect(afterSecond).toBe(afterFirst);
      expect(dwarfOf(afterSecond, "dwarf-2").status).toBe("working");
      expect(afterSecond.resources.wood).toBe(0);
    });

    it("can pay two crafts when materials suffice for both", () => {
      const state = makeState([specialist("dwarf-1"), specialist("dwarf-2")]);
      state.resources.wood = 6;
      state.resources.stone = 4;

      const next = craftToolAction(
        craftToolAction(state, "dwarf-1"),
        "dwarf-2",
      );

      expect(next.resources.wood).toBe(0);
      expect(next.resources.stone).toBe(0);
      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Tool");
      expect(dwarfOf(next, "dwarf-2").status).toBe("forging_Tool");
    });
  });

  describe("eligible character", () => {
    it("lets a specialist start a tool", () => {
      const next = craftToolAction(makeState(), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Tool");
    });

    it("lets a specialist start a weapon", () => {
      const next = craftWeaponAction(makeState(), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Weapon");
    });

    it("lets an idle specialist craft", () => {
      const state = makeState([
        specialist("dwarf-1", "idle", { assignment: null }),
      ]);

      expect(dwarfOf(craftToolAction(state, "dwarf-1"), "dwarf-1").status).toBe(
        "forging_Tool",
      );
    });

    it("rejects a generalist without specialty (tool)", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects a generalist without specialty (weapon)", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects an unknown dwarf", () => {
      const state = makeState();

      expect(craftToolAction(state, "ghost")).toBe(state);
      expect(craftWeaponAction(state, "ghost")).toBe(state);
    });

    it("rejects any craft in a colony without dwarves", () => {
      const state = makeState([]);

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it.each(BUSY)("rejects a tool for a dwarf with status %s", (status) => {
      const state = makeState([specialist("dwarf-1", status)]);

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it.each(BUSY)("rejects a weapon for a dwarf with status %s", (status) => {
      const state = makeState([specialist("dwarf-1", status)]);

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("keeps the crafter's assignment so the job can resume afterwards", () => {
      const next = craftToolAction(makeState(), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").assignment).toBe("mining");
    });
  });

  describe("crafting takes time", () => {
    it("does not create a tool immediately", () => {
      const state = makeState();
      const next = craftToolAction(state, "dwarf-1");

      expect(next.resources.tools).toBe(state.resources.tools);
    });

    it("does not create a weapon immediately", () => {
      const next = craftWeaponAction(makeState(), "dwarf-1");

      expect(next.resources.weapons).toBe(0);
    });

    it("has positive forging durations", () => {
      expect(FORGE_TOOL_SECONDS).toBeGreaterThan(0);
      expect(FORGE_WEAPON_SECONDS).toBeGreaterThan(0);
    });

    it("makes weapons take at least as long as tools", () => {
      expect(FORGE_WEAPON_SECONDS).toBeGreaterThanOrEqual(FORGE_TOOL_SECONDS);
    });

    it("creates exactly one tool once the tool is completed", () => {
      const started = craftToolAction(makeState(), "dwarf-1");
      const finished = completeCraftToolAction(started, "dwarf-1");

      expect(finished.resources.tools).toBe(started.resources.tools + 1);
    });

    it("creates exactly one weapon once the weapon is completed", () => {
      const started = craftWeaponAction(makeState(), "dwarf-1");
      const finished = completeCraftWeaponAction(started, "dwarf-1");

      expect(finished.resources.weapons).toBe(1);
    });

    it("lets the crafter rest after a finished tool", () => {
      const started = craftToolAction(makeState(), "dwarf-1");
      const finished = completeCraftToolAction(started, "dwarf-1");

      expect(dwarfOf(finished, "dwarf-1").status).toBe("resting");
    });

    it("lets the crafter rest after a finished weapon", () => {
      const started = craftWeaponAction(makeState(), "dwarf-1");
      const finished = completeCraftWeaponAction(started, "dwarf-1");

      expect(dwarfOf(finished, "dwarf-1").status).toBe("resting");
    });

    it("returns the crafter to work on the day after completing", () => {
      const started = craftToolAction(makeState(), "dwarf-1");
      const finished = completeCraftToolAction(started, "dwarf-1");
      const nextDay = advanceDay(finished);

      expect(dwarfOf(nextDay, "dwarf-1").status).toBe("working");
    });

    it("blocks a second craft while the first one is still running", () => {
      const started = craftToolAction(makeState(), "dwarf-1");

      expect(craftToolAction(started, "dwarf-1")).toBe(started);
      expect(craftWeaponAction(started, "dwarf-1")).toBe(started);
    });

    it("lets several dwarves craft in parallel", () => {
      const state = makeState([specialist("dwarf-1"), specialist("dwarf-2")]);
      state.resources.wood = 20;
      state.resources.stone = 20;
      const next = craftWeaponAction(
        craftToolAction(state, "dwarf-1"),
        "dwarf-2",
      );

      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Tool");
      expect(dwarfOf(next, "dwarf-2").status).toBe("forging_Weapon");
    });

    it("delivers each result to the right resource when crafts finish together", () => {
      const state = makeState([specialist("dwarf-1"), specialist("dwarf-2")]);
      state.resources.wood = 20;
      state.resources.stone = 20;
      let next = craftWeaponAction(
        craftToolAction(state, "dwarf-1"),
        "dwarf-2",
      );
      next = completeCraftToolAction(next, "dwarf-1");
      next = completeCraftWeaponAction(next, "dwarf-2");

      expect(next.resources.tools).toBe(state.resources.tools + 1);
      expect(next.resources.weapons).toBe(1);
    });
  });

  describe("invalid attempts change nothing", () => {
    it("leaves resources, workers and chronicle untouched on rejection", () => {
      const state = makeState();
      state.resources.wood = 1;
      const snapshot = structuredClone(state);
      const next = craftToolAction(state, "dwarf-1");

      expect(next).toEqual(snapshot);
      expect(next.log).toHaveLength(0);
      expect(next.logSeq).toBe(0);
    });

    it("does not complete a craft for a dwarf that is not forging", () => {
      const state = makeState();

      expect(completeCraftToolAction(state, "dwarf-1")).toBe(state);
      expect(completeCraftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("does not complete a craft for an unknown dwarf", () => {
      const state = makeState();

      expect(completeCraftToolAction(state, "ghost")).toBe(state);
      expect(completeCraftWeaponAction(state, "ghost")).toBe(state);
    });

    it("does not duplicate the item when completion is delivered twice", () => {
      const started = craftToolAction(makeState(), "dwarf-1");
      const once = completeCraftToolAction(started, "dwarf-1");
      const twice = completeCraftToolAction(once, "dwarf-1");

      expect(twice.resources.tools).toBe(once.resources.tools);
      expect(twice).toBe(once);
    });

    it("does not complete a craft for a resting dwarf", () => {
      const state = makeState([specialist("dwarf-1", "resting")]);

      expect(completeCraftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("does not complete a craft for a travelling dwarf", () => {
      const state = makeState([specialist("dwarf-1", "expedition")]);

      expect(completeCraftWeaponAction(state, "dwarf-1")).toBe(state);
    });
  });

  describe("consistency with the daily simulation", () => {
    it("lets a forging dwarf produce nothing", () => {
      const forging = craftToolAction(makeState(), "dwarf-1");
      const next = advanceDay(forging);

      expect(next.resources.stone).toBe(forging.resources.stone);
    });

    it("still feeds a forging dwarf", () => {
      const forging = craftToolAction(makeState(), "dwarf-1");

      expect(advanceDay(forging).resources.food).toBe(
        forging.resources.food - 1,
      );
    });

    it("keeps a dwarf forging across the day change", () => {
      const forging = craftWeaponAction(makeState(), "dwarf-1");

      expect(dwarfOf(advanceDay(forging), "dwarf-1").status).toBe(
        "forging_Weapon",
      );
    });

    it("does not mutate the input state when starting a craft", () => {
      const state = makeState();
      const snapshot = structuredClone(state);

      craftToolAction(state, "dwarf-1");
      craftWeaponAction(state, "dwarf-1");

      expect(state).toEqual(snapshot);
    });

    it("does not mutate the input state when completing a craft", () => {
      const state = makeState([specialist("dwarf-1", "forging_Tool")]);
      const snapshot = structuredClone(state);

      completeCraftToolAction(state, "dwarf-1");

      expect(state).toEqual(snapshot);
    });

    it("leaves other dwarves untouched", () => {
      const state = makeState([specialist("dwarf-1"), specialist("dwarf-2")]);
      const next = craftToolAction(state, "dwarf-1");

      expect(dwarfOf(next, "dwarf-2")).toEqual(dwarfOf(state, "dwarf-2"));
    });
  });

  describe("interface", () => {
    it("names who is crafting together with the remaining time", () => {
      const state = makeState([
        specialist("dwarf-1", "forging_Tool", { countdown: 3, name: "Yrsa" }),
      ]);
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(state)),
      );

      expect(html).toContain("Yrsa");
      expect(html).toContain("is crafting");
      expect(html).toContain("Ready in: 3s");
    });

    it("also shows weapon forging progress", () => {
      const state = makeState([
        specialist("dwarf-1", "forging_Weapon", { countdown: 6, name: "Dori" }),
      ]);
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(state)),
      );

      expect(html).toContain("Dori");
      expect(html).toContain("Ready in: 6s");
    });

    it("shows every crafter when several dwarves are forging", () => {
      const state = makeState([
        specialist("dwarf-1", "forging_Tool", { countdown: 2, name: "Yrsa" }),
        specialist("dwarf-2", "forging_Weapon", { countdown: 5, name: "Dori" }),
      ]);
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(state)),
      );

      expect(html).toContain("Yrsa");
      expect(html).toContain("Dori");
    });

    it("shows no progress line when nobody is forging", () => {
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(makeState())),
      );

      expect(html).not.toContain("is crafting");
    });

    it("disables the forge button until a specialist is selected", () => {
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(makeState())),
      );

      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Forge tool/);
    });

    it("does not offer a forging or resting dwarf as selectable specialist", () => {
      const state = makeState([
        specialist("dwarf-1", "forging_Tool", { countdown: 2, name: "Yrsa" }),
        specialist("dwarf-2", "resting", { name: "Dori" }),
        specialist("dwarf-3", "working", { name: "Bromli" }),
      ]);
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(state)),
      );
      const options = html.match(/<option[^>]*>[^<]*<\/option>/g) ?? [];

      expect(options.join("")).toContain("Bromli");
      expect(options.join("")).not.toContain("Dori");
      expect(options.join("")).not.toContain("Yrsa");
    });

    it("does not offer a generalist as specialist", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle", { name: "Generalist" }),
      ]);
      const html = renderToStaticMarkup(
        createElement(Recepie, recipeProps(state)),
      );
      const options = (html.match(/<option[^>]*>[^<]*<\/option>/g) ?? []).join(
        "",
      );

      expect(options).not.toContain("Generalist");
    });

    it("names the crafter in the chronicle when a craft starts and completes", () => {
      const state = makeState([
        specialist("dwarf-1", "working", { name: "Yrsa" }),
      ]);
      const started = craftToolAction(state, "dwarf-1");
      const finished = completeCraftToolAction(started, "dwarf-1");

      expect(started.log[0].message).toContain("Yrsa");
      expect(finished.log[0].message).toContain("Yrsa");
      expect(finished.log).toHaveLength(2);
    });

    it("names the crafter in the chronicle for weapons too", () => {
      const state = makeState([
        specialist("dwarf-1", "working", { name: "Yrsa" }),
      ]);
      const started = craftWeaponAction(state, "dwarf-1");
      const finished = completeCraftWeaponAction(started, "dwarf-1");

      expect(started.log[0].message).toContain("Yrsa");
      expect(finished.log[0].message).toContain("Yrsa");
    });
  });
});
