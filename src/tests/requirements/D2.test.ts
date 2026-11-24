/**
 * Test for requirement D2 - Useful tools, weapons, and equipment
 *
 * Covers the following subtask classifications:
 *
 * [D2.1] Equipping and returning tools
 *        - an available tool can be equipped and the dwarf becomes its owner
 *        - an equipped tool can be returned to the shared storage
 *        - equipping is rejected when no tool is in storage (no negative stock)
 *        - unknown dwarves cannot equip or return tools (inventory stays unchanged)
 *
 * [D2.2] Ownership and limits
 *        - one dwarf may carry at most one tool
 *        - one tool cannot be shared by several dwarves
 *        - the number of owners never exceeds the number of existing tools
 *        - only the targeted dwarf changes
 *
 * [D2.3] Production benefit of tools
 *        - an equipped tool adds exactly +1 of the assigned resource per day
 *          (woodcutting 3 -> 4, mining 2 -> 3, farming 4 -> 5)
 *        - the bonus applies per dwarf, independent of the other dwarves
 *        - idle, resting, travelling and forging dwarves get no bonus
 *        - a tool in storage gives no bonus
 *        - the bonus combines with the famine modifier
 *        - a returned tool stops producing the bonus
 *
 * [D2.4] Inventory consistency
 *        - storage + equipped tools stay constant when equipping/returning
 *        - equipping and returning repeatedly leads back to the initial state
 *        - input state is never mutated
 *        - a crafted tool increases the storage by exactly one
 *
 * [D2.5] Weapon recipe
 *        - the weapon recipe has a team-defined cost (4 wood + 3 stone) and takes time
 *        - weapons are stored as a colony resource, not on individual dwarves
 *        - a finished weapon increases the weapon stock by exactly one
 *        - weapons never change the tool count and are not consumed by the day
 *        - insufficient materials / ineligible forger leave the state unchanged
 *
 * [D2.6] Interface
 *        - the roster shows who owns a tool
 *        - the tool checkbox is disabled when no tool is available
 *        - the forge page offers a weapon recipe with a visible cost
 *        - the resource bar shows tools and weapons
 *
 * The detailed positive, negative and edge cases are grouped below by
 * equipment, production benefit, inventory consistency and weapon behavior.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  completeCraftToolAction,
  completeCraftWeaponAction,
  craftToolAction,
  craftWeaponAction,
} from "../../domain/actions/crafting";
import { toggleToolAction } from "../../domain/actions/equipment";
import { advanceDay } from "../../domain/simulation/advanceDay";
import { FORGE_WEAPON_SECONDS } from "../../config/constants";
import { DwarfRoster } from "../../components/DwarfRoster";
import { ResourceBar } from "../../components/ResourceBar";
import { ForgePage } from "../../pages/ForgePage";
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

function makeState(
  dwarves: Dwarf[] = [makeDwarf("dwarf-1")],
  tools = 1,
): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools, weapons: 0 },
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

/** Equip a tool using the same call shape as the provider (toggleTool). */
const equip = (state: ColonyState, id: string): ColonyState =>
  toggleToolAction(state, id, dwarfOf(state, id).hasTool, "equip");

/** All existing tools: those in storage plus those carried by dwarves. */
const totalTools = (state: ColonyState) =>
  state.resources.tools + state.dwarves.filter((d) => d.hasTool).length;

function renderWithColony(
  colony: ColonyState,
  element: ReturnType<typeof createElement>,
) {
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
    createElement(ColonyContext.Provider, { value }, element),
  );
}

describe("D2 tools, weapons and equipment", () => {
  describe("equipping and returning tools", () => {
    it("equips an available tool and marks the dwarf as owner", () => {
      const next = equip(makeState(), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").hasTool).toBe(true);
      expect(next.resources.tools).toBe(0);
    });

    it("returns an equipped tool to the shared storage", () => {
      const state = makeState(
        [makeDwarf("dwarf-1", "mining", "working", { hasTool: true })],
        0,
      );
      const next = toggleToolAction(state, "dwarf-1", true, "return");

      expect(dwarfOf(next, "dwarf-1").hasTool).toBe(false);
      expect(next.resources.tools).toBe(1);
    });

    it("records equip and return in the chronicle", () => {
      const equipped = toggleToolAction(
        makeState(),
        "dwarf-1",
        false,
        "Dwarf equipped a tool.",
      );

      expect(equipped.log[0].message).toBe("Dwarf equipped a tool.");
    });

    it("rejects equipping when the storage holds no tool", () => {
      const state = makeState([makeDwarf("dwarf-1")], 0);
      const next = equip(state, "dwarf-1");

      expect(next.resources.tools).toBe(0);
      expect(dwarfOf(next, "dwarf-1").hasTool).toBe(false);
    });

    it("never lets the tool stock become negative", () => {
      let state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 1);
      state = equip(state, "dwarf-1");
      state = equip(state, "dwarf-2");

      expect(state.resources.tools).toBeGreaterThanOrEqual(0);
      expect(dwarfOf(state, "dwarf-2").hasTool).toBe(false);
    });

    it("ignores equip requests for an unknown dwarf without touching the stock", () => {
      const state = makeState();
      const next = toggleToolAction(state, "ghost", false, "equip");

      expect(next.resources.tools).toBe(1);
      expect(next.dwarves).toEqual(state.dwarves);
    });

    it("ignores return requests for an unknown dwarf without touching the stock", () => {
      const state = makeState();
      const next = toggleToolAction(state, "ghost", true, "return");

      expect(next.resources.tools).toBe(1);
    });

    it("does not return a tool that the dwarf does not own", () => {
      const state = makeState([makeDwarf("dwarf-1")], 1);
      const next = toggleToolAction(state, "dwarf-1", true, "return");

      expect(next.resources.tools).toBe(1);
      expect(dwarfOf(next, "dwarf-1").hasTool).toBe(false);
    });
  });

  describe("ownership and limits", () => {
    it("allows a dwarf to carry at most one tool - toggle twice returns the tool", () => {
      const state = makeState([makeDwarf("dwarf-1")], 3);
      const once = equip(state, "dwarf-1");
      const twice = equip(once, "dwarf-1");

      expect(once.dwarves[0].hasTool).toBe(true);
      expect(once.resources.tools).toBe(2);

      expect(twice.dwarves[0].hasTool).toBe(false);
      expect(twice.resources.tools).toBe(3);
      expect(totalTools(twice)).toBe(3);
    });

    it("does not let two dwarves share a single tool", () => {
      let state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 1);
      state = equip(state, "dwarf-1");
      state = equip(state, "dwarf-2");

      const owners = state.dwarves.filter((d) => d.hasTool);
      expect(owners).toHaveLength(1);
      expect(owners[0].id).toBe("dwarf-1");
    });

    it("lets two dwarves carry tools when two tools exist", () => {
      let state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 2);
      state = equip(equip(state, "dwarf-1"), "dwarf-2");

      expect(state.dwarves.every((d) => d.hasTool)).toBe(true);
      expect(state.resources.tools).toBe(0);
    });

    it("only changes the targeted dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 2);
      const next = equip(state, "dwarf-1");

      expect(dwarfOf(next, "dwarf-2")).toEqual(dwarfOf(state, "dwarf-2"));
    });

    it("keeps assignment and status when equipping", () => {
      const state = makeState([makeDwarf("dwarf-1", "farming", "working")], 1);
      const dwarf = dwarfOf(equip(state, "dwarf-1"), "dwarf-1");

      expect(dwarf.assignment).toBe("farming");
      expect(dwarf.status).toBe("working");
    });

    it("allows a returned tool to be taken over by another dwarf", () => {
      let state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 1);
      state = equip(state, "dwarf-1");
      state = toggleToolAction(state, "dwarf-1", true, "return");
      state = equip(state, "dwarf-2");

      expect(dwarfOf(state, "dwarf-1").hasTool).toBe(false);
      expect(dwarfOf(state, "dwarf-2").hasTool).toBe(true);
    });
  });

  describe("production benefit", () => {
    it.each([
      ["woodcutting", "wood", 3, 4],
      ["mining", "stone", 2, 3],
      ["farming", "food", 4, 5],
    ] as const)(
      "%s yields %i -> %i with a tool",
      (job, resource, normal, withTool) => {
        const base = makeState([makeDwarf("dwarf-1", job)]);
        const tooled = makeState([
          makeDwarf("dwarf-1", job, "working", { hasTool: true }),
        ]);
        // isolate the resource from the meal for the food case
        const meal = resource === "food" ? 1 : 0;

        expect(advanceDay(base).resources[resource]).toBe(
          base.resources[resource] + normal - meal,
        );
        expect(advanceDay(tooled).resources[resource]).toBe(
          tooled.resources[resource] + withTool - meal,
        );
      },
    );

    it("adds exactly one additional unit, not more", () => {
      const without = advanceDay(
        makeState([makeDwarf("dwarf-1", "woodcutting")]),
      );
      const withTool = advanceDay(
        makeState([
          makeDwarf("dwarf-1", "woodcutting", "working", { hasTool: true }),
        ]),
      );

      expect(withTool.resources.wood - without.resources.wood).toBe(1);
    });

    it("does not change other resources when a tool is equipped", () => {
      const without = advanceDay(makeState([makeDwarf("dwarf-1", "mining")]));
      const withTool = advanceDay(
        makeState([
          makeDwarf("dwarf-1", "mining", "working", { hasTool: true }),
        ]),
      );

      expect(withTool.resources.wood).toBe(without.resources.wood);
      expect(withTool.resources.food).toBe(without.resources.food);
    });

    it("applies the bonus per dwarf", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "woodcutting", "working", { hasTool: true }),
        makeDwarf("dwarf-2", "woodcutting"),
        makeDwarf("dwarf-3", "woodcutting", "working", { hasTool: true }),
      ]);

      // 4 + 3 + 4
      expect(advanceDay(state).resources.wood).toBe(14 + 11);
    });

    it("gives no bonus to an idle dwarf with a tool", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle", { hasTool: true }),
      ]);

      expect(advanceDay(state).resources).toMatchObject({ wood: 14, stone: 9 });
    });

    it.each([
      "expedition",
      "resting",
      "forging_Tool",
      "forging_Weapon",
    ] as const)("gives no bonus to a dwarf with status %s", (status) => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", status, { hasTool: true }),
      ]);

      expect(advanceDay(state).resources.stone).toBe(9);
    });

    it("gives no bonus for a tool that only lies in the storage", () => {
      const state = makeState([makeDwarf("dwarf-1", "mining")], 5);

      expect(advanceDay(state).resources.stone).toBe(11);
    });

    it("does not consume or damage the tool (no durability)", () => {
      let state = makeState(
        [makeDwarf("dwarf-1", "mining", "working", { hasTool: true })],
        0,
      );
      for (let i = 0; i < 10; i += 1) state = advanceDay(state);

      expect(dwarfOf(state, "dwarf-1").hasTool).toBe(true);
      // 10 days with bonus: 9 + 10 * 3
      expect(state.resources.stone).toBe(9 + 30);
    });

    it("combines its bonus with the famine modifier", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "working", { hasTool: true }),
      ]);
      state.resources.food = 0;

      expect(advanceDay(state).resources.stone).toBe(9 + 2);
    });

    it("stops producing the bonus after the tool was returned", () => {
      let state = makeState(
        [makeDwarf("dwarf-1", "mining", "working", { hasTool: true })],
        0,
      );
      state = toggleToolAction(state, "dwarf-1", true, "return");

      expect(advanceDay(state).resources.stone).toBe(9 + 2);
    });

    it("starts producing the bonus right after equipping", () => {
      const state = equip(makeState(), "dwarf-1");

      expect(advanceDay(state).resources.stone).toBe(9 + 3);
    });
  });

  describe("inventory consistency", () => {
    it("keeps storage plus equipped tools constant when equipping", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 4);
      const next = equip(state, "dwarf-1");

      expect(totalTools(next)).toBe(totalTools(state));
    });

    it("keeps storage plus equipped tools constant when returning", () => {
      const state = makeState(
        [makeDwarf("dwarf-1", "mining", "working", { hasTool: true })],
        2,
      );
      const next = toggleToolAction(state, "dwarf-1", true, "return");

      expect(totalTools(next)).toBe(totalTools(state));
    });

    it("returns to the initial state after equip followed by return", () => {
      const state = makeState();
      const roundTrip = toggleToolAction(
        equip(state, "dwarf-1"),
        "dwarf-1",
        true,
        "return",
      );

      expect(roundTrip.resources).toEqual(state.resources);
      expect(roundTrip.dwarves).toEqual(state.dwarves);
    });

    it("stays consistent over many alternating toggles", () => {
      let state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")], 1);
      for (let i = 0; i < 20; i += 1) {
        const id = i % 2 === 0 ? "dwarf-1" : "dwarf-2";
        state = toggleToolAction(
          state,
          id,
          dwarfOf(state, id).hasTool,
          "toggle",
        );
        expect(totalTools(state)).toBe(1);
        expect(state.resources.tools).toBeGreaterThanOrEqual(0);
        expect(
          state.dwarves.filter((d) => d.hasTool).length,
        ).toBeLessThanOrEqual(1);
      }
    });

    it("does not mutate the input state", () => {
      const state = makeState();
      const snapshot = structuredClone(state);

      equip(state, "dwarf-1");
      toggleToolAction(state, "dwarf-1", true, "return");

      expect(state).toEqual(snapshot);
    });

    it("does not change other resources while equipping", () => {
      const state = makeState();
      const next = equip(state, "dwarf-1");

      expect({ ...next.resources, tools: 0 }).toEqual({
        ...state.resources,
        tools: 0,
      });
    });

    it("adds exactly one tool to the storage when a tool is crafted", () => {
      const state = makeState([
        makeDwarf("dwarf-1", "mining", "forging_Tool", { specialty: "mining" }),
      ]);
      const next = completeCraftToolAction(state, "dwarf-1");

      expect(next.resources.tools).toBe(state.resources.tools + 1);
      expect(totalTools(next)).toBe(totalTools(state) + 1);
    });
  });

  describe("weapon recipe", () => {
    const forger = (status: DwarfStatus = "working") =>
      makeDwarf("dwarf-1", "mining", status, { specialty: "mining" });

    it("charges the team-defined cost of 4 wood and 3 stone", () => {
      const next = craftWeaponAction(makeState([forger()]), "dwarf-1");

      expect(next.resources.wood).toBe(14 - 4);
      expect(next.resources.stone).toBe(9 - 3);
    });

    it("does not produce the weapon immediately", () => {
      const next = craftWeaponAction(makeState([forger()]), "dwarf-1");

      expect(next.resources.weapons).toBe(0);
    });

    it("puts the forger into a weapon-forging state", () => {
      const next = craftWeaponAction(makeState([forger()]), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Weapon");
    });

    it("takes longer than zero seconds", () => {
      expect(FORGE_WEAPON_SECONDS).toBeGreaterThan(0);
    });

    it("stores a finished weapon as a colony resource", () => {
      const state = makeState([forger("forging_Weapon")]);
      const next = completeCraftWeaponAction(state, "dwarf-1");

      expect(next.resources.weapons).toBe(1);
      expect(dwarfOf(next, "dwarf-1")).not.toHaveProperty("weapon");
      expect(dwarfOf(next, "dwarf-1").hasTool).toBe(false);
    });

    it("accumulates several weapons", () => {
      let state = makeState([forger("forging_Weapon")]);
      state.resources.weapons = 2;
      state = completeCraftWeaponAction(state, "dwarf-1");

      expect(state.resources.weapons).toBe(3);
    });

    it("does not touch the tool count when a weapon is forged", () => {
      const state = makeState([forger("forging_Weapon")]);
      const next = completeCraftWeaponAction(state, "dwarf-1");

      expect(next.resources.tools).toBe(state.resources.tools);
    });

    it("does not consume weapons during the daily simulation", () => {
      const state = makeState([makeDwarf("dwarf-1", "mining")]);
      state.resources.weapons = 3;

      expect(advanceDay(state).resources.weapons).toBe(3);
    });

    it("allows forging with exactly the required materials", () => {
      const state = makeState([forger()]);
      state.resources.wood = 4;
      state.resources.stone = 3;
      const next = craftWeaponAction(state, "dwarf-1");

      expect(next.resources.wood).toBe(0);
      expect(next.resources.stone).toBe(0);
      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Weapon");
    });

    it("rejects forging with one wood too little", () => {
      const state = makeState([forger()]);
      state.resources.wood = 3;

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects forging with one stone too little", () => {
      const state = makeState([forger()]);
      state.resources.stone = 2;

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects forging for a dwarf without a specialty", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);

      expect(craftWeaponAction(state, "dwarf-1")).toBe(state);
    });

    it("rejects forging for an unknown dwarf", () => {
      const state = makeState([forger()]);

      expect(craftWeaponAction(state, "ghost")).toBe(state);
    });

    it("does not complete a weapon for a dwarf that is not forging a weapon", () => {
      const idle = makeState([forger("working")]);
      const toolForger = makeState([forger("forging_Tool")]);

      expect(completeCraftWeaponAction(idle, "dwarf-1")).toBe(idle);
      expect(completeCraftWeaponAction(toolForger, "dwarf-1")).toBe(toolForger);
    });

    it("does not complete a tool for a dwarf that is forging a weapon", () => {
      const state = makeState([forger("forging_Weapon")]);

      expect(completeCraftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("keeps tool and weapon recipes independent (tool cost 3 wood + 2 stone)", () => {
      const tool = craftToolAction(makeState([forger()]), "dwarf-1");
      const weapon = craftWeaponAction(makeState([forger()]), "dwarf-1");

      expect(14 - tool.resources.wood).toBe(3);
      expect(9 - tool.resources.stone).toBe(2);
      expect(14 - weapon.resources.wood).toBe(4);
      expect(9 - weapon.resources.stone).toBe(3);
    });
  });

  describe("interface", () => {
    const rosterProps = (state: ColonyState) =>
      ({
        dwarves: state.dwarves,
        state,
      }) as ComponentProps<typeof DwarfRoster>;

    it("shows the owner of a tool as a checked checkbox", () => {
      const state = makeState(
        [makeDwarf("dwarf-1", "mining", "working", { hasTool: true })],
        0,
      );
      const html = renderToStaticMarkup(
        createElement(DwarfRoster, rosterProps(state)),
      );

      expect(html).toContain('checked=""');
    });

    it("shows no tool ownership for a dwarf without a tool", () => {
      const state = makeState([makeDwarf("dwarf-1")], 1);
      const html = renderToStaticMarkup(
        createElement(DwarfRoster, rosterProps(state)),
      );

      expect(html).not.toContain('checked=""');
    });

    it("disables the tool checkbox when no tool is available", () => {
      const state = makeState([makeDwarf("dwarf-1")], 0);
      const html = renderToStaticMarkup(
        createElement(DwarfRoster, rosterProps(state)),
      );

      expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    });

    it("keeps the checkbox of the owner enabled so the tool can be returned", () => {
      const state = makeState(
        [makeDwarf("dwarf-1", "mining", "working", { hasTool: true })],
        0,
      );
      const html = renderToStaticMarkup(
        createElement(DwarfRoster, rosterProps(state)),
      );

      expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    });

    it("offers a weapon recipe with a visible cost on the forge page", () => {
      const html = renderWithColony(makeState(), createElement(ForgePage));

      expect(html).toContain("Forge weapon");
      expect(html).toContain("4 🪵");
      expect(html).toContain("3 🪨");
    });

    it("keeps the tool recipe on the forge page next to the weapon recipe", () => {
      const html = renderWithColony(makeState(), createElement(ForgePage));

      expect(html).toContain("Forge tool");
      expect(html).toContain("3 🪵");
      expect(html).toContain("2 🪨");
    });

    it("shows tool and weapon stock in the resource bar", () => {
      const state = makeState();
      state.resources.weapons = 7;
      const html = renderToStaticMarkup(
        createElement(ResourceBar, { resources: state.resources }),
      );

      expect(html).toContain("Tools");
      expect(html).toContain("Weapons");
      expect(html).toContain("<strong>7</strong>");
    });
  });
});
