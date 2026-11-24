/**
 * Test for requirement D6 - Non-dwarf resident (Sir One Uper, knight)
 *
 * Covers the following subtask classifications:
 *
 * [D6.1] Joining after a successful expedition
 *        - the first successful expedition with recruitment adds exactly one knight
 *        - no recruitment flag, a failed expedition or an unknown scout adds nobody
 *        - the knight joins only once (flag and head count stay stable)
 *        - the expedition result (rewards, scout resting, chronicle) is not affected
 *        - the input state is never mutated
 *
 * [D6.2] Recognisably different from a dwarf
 *        - own species, id, name, title and icon
 *        - the roster shows a knight-specific label instead of "Generalist"/"Skilled in"
 *
 * [D6.3] Own production capability
 *        - the knight produces +1 on every basic job (woodcutting, mining, farming)
 *        - the bonus combines with equipped tools and with the famine modifier
 *        - the UI net food line includes the knight bonus
 *
 * [D6.4] Own crafting/expedition limitation
 *        - the knight cannot forge tools or weapons (even with a specialty)
 *        - the knight cannot be sent on expeditions and is not offered as a scout
 *        - the knight is not offered as a specialist in the forge
 *
 * [D6.5] Consistency with the colony rules
 *        - the knight eats one food per day (and counts for famine detection)
 *        - exactly one job at a time, idle/unassigned and resting rules
 *        - tool equip/unequip uses the shared inventory
 *
 * [D6.6] Persistence
 *        - save and load keep species, status and the one-time join flag
 *        - the knight cannot join a second time after a reload
 *        - legacy saves and invalid species/flags are handled
 *
 * The decision "destination === crystal-cave" lives in ColonyProvider.runExpedition
 * and is therefore not testable as a pure function (see it.todo below).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { assignJob } from "../../domain/actions/assignment";
import {
  craftToolAction,
  craftWeaponAction,
} from "../../domain/actions/crafting";
import {
  completeExpeditionAction,
  failExpeditionAction,
  startExpeditionAction,
} from "../../domain/actions/expedition";
import { toggleToolAction } from "../../domain/actions/equipment";
import { advanceDay, isProducing } from "../../simulation";
import { createInitialState } from "../../domain/initialState";
import {
  bootstrapColony,
  loadSnapshot,
  saveSnapshot,
  SAVE_VERSION,
  validateSnapshot,
  type Snapshot,
  type StorageLike,
} from "../../persistence";
import { DwarfRoster } from "../../components/DwarfRoster";
import { Recepie } from "../../components/Recepie";
import { ColonyPage } from "../../pages/ColonyPage";
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
import { isFamine } from "../../utils";

const KNIGHT_ID = "sir-one-uper";

const noop = (): void => undefined;

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

function makeKnight(extra: Partial<Dwarf> = {}): Dwarf {
  return {
    id: KNIGHT_ID,
    species: "knight",
    name: "Sir One Uper",
    title: "Produces 1 extra",
    icon: "🤴",
    assignment: null,
    status: "idle",
    hasTool: false,
    ...extra,
  };
}

function makeState(
  dwarves: Dwarf[] = [makeDwarf("dwarf-1")],
  overrides: Partial<ColonyState> = {},
): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1, weapons: 0 },
    dwarves,
    log: [],
    logSeq: 0,
    sirOneUperJoined: false,
    ...overrides,
  };
}

function dwarfOf(state: ColonyState, id: string): Dwarf {
  const dwarf = state.dwarves.find((item) => item.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
}

const knightsOf = (state: ColonyState) =>
  state.dwarves.filter((d) => d.species === "knight");

/** State where dwarf-1 is travelling and a successful expedition can complete. */
function expeditionState(overrides: Partial<ColonyState> = {}): ColonyState {
  return makeState(
    [
      makeDwarf("dwarf-1", "mining", "expedition"),
      makeDwarf("dwarf-2", "woodcutting", "working"),
    ],
    overrides,
  );
}

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function makeSnapshot(colony: ColonyState): Snapshot {
  return {
    version: SAVE_VERSION,
    savedAt: 1,
    colony,
    dayElapsedMs: 0,
    pendingExpeditions: {},
  };
}

type RawRecord = Record<string, unknown>;
interface RawSnapshot extends RawRecord {
  colony: RawRecord & { dwarves: RawRecord[] };
}

/** Plain JSON copy, as it would come out of localStorage. */
const toRaw = (snapshot: Snapshot): RawSnapshot =>
  JSON.parse(JSON.stringify(snapshot)) as RawSnapshot;

function rawDwarf(raw: RawSnapshot, index: number): RawRecord {
  const dwarf = raw.colony.dwarves[index];
  if (!dwarf) throw new Error(`test setup: raw dwarf ${index} missing`);
  return dwarf;
}

function renderColonyPage(colony: ColonyState): string {
  const value = {
    colony,
    paused: false,
    activities: colony.log,
    expeditionPending: false,
    dayPhase: "EARLY MORNING",
    daySecondsLeft: 8,
    restoreNotice: null,
    assignDwarf: noop,
    sendExpedition: noop,
    toggleTool: noop,
  } as unknown as ColonyContextValue;

  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        ColonyContext.Provider,
        { value },
        createElement(ColonyPage),
      ),
    ),
  );
}

function renderRoster(colony: ColonyState): string {
  return renderToStaticMarkup(
    createElement(DwarfRoster, {
      dwarves: colony.dwarves,
      onAssign: noop,
      state: colony,
      onToggleTool: noop,
    }),
  );
}

function renderForge(colony: ColonyState): string {
  return renderToStaticMarkup(
    createElement(Recepie, {
      colony,
      recepieMethod: noop,
      name: "Craft a tool",
      subText: "",
      buttonText: "Forge tool",
      recepieResources: { wood: 3, stone: 2, output: 1, icon: "⚒️" },
    }),
  );
}

describe("D6 non-dwarf resident", () => {
  describe("[D6.1] joining after a successful expedition", () => {
    it("starts without a knight and with the join flag unset", () => {
      const initial = createInitialState();

      expect(knightsOf(initial)).toHaveLength(0);
      expect(initial.sirOneUperJoined).toBe(false);
      expect(initial.dwarves.every((d) => d.species === "dwarf")).toBe(true);
    });

    it("adds exactly one knight after a successful recruiting expedition", () => {
      const state = expeditionState();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        { stone: 3 },
        "The scout returned.",
        true,
      );

      expect(next.dwarves).toHaveLength(state.dwarves.length + 1);
      expect(knightsOf(next)).toHaveLength(1);
      expect(dwarfOf(next, KNIGHT_ID).species).toBe("knight");
      expect(next.sirOneUperJoined).toBe(true);
    });

    it("lets the knight arrive idle, unassigned and without a tool", () => {
      const next = completeExpeditionAction(
        expeditionState(),
        "dwarf-1",
        {},
        "The scout returned.",
        true,
      );
      const knight = dwarfOf(next, KNIGHT_ID);

      expect(knight.status).toBe("idle");
      expect(knight.assignment).toBeNull();
      expect(knight.hasTool).toBe(false);
      expect(isProducing(knight)).toBe(false);
    });

    it("keeps the normal expedition result when the knight joins", () => {
      const state = expeditionState();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        { stone: 3, wood: 2 },
        "Crystals everywhere.",
        true,
      );

      expect(next.resources.stone).toBe(state.resources.stone + 3);
      expect(next.resources.wood).toBe(state.resources.wood + 2);
      expect(dwarfOf(next, "dwarf-1").status).toBe("resting");
      expect(next.log[0].message).toBe("Crystals everywhere.");
      expect(next.log[0].tone).toBe("good");
    });

    it("adds nobody when recruitment is not requested", () => {
      const next = completeExpeditionAction(
        expeditionState(),
        "dwarf-1",
        {},
        "The scout returned.",
        false,
      );

      expect(knightsOf(next)).toHaveLength(0);
      expect(next.sirOneUperJoined).toBe(false);
      expect(dwarfOf(next, "dwarf-1").status).toBe("resting");
    });

    it("adds nobody when the expedition fails", () => {
      const next = failExpeditionAction(
        expeditionState(),
        "dwarf-1",
        "The scout got lost.",
      );

      expect(knightsOf(next)).toHaveLength(0);
      expect(next.sirOneUperJoined).toBe(false);
      expect(next.log[0].tone).toBe("warning");
    });

    it("adds nobody for an unknown or non-travelling scout and returns the same state", () => {
      const state = expeditionState();

      expect(completeExpeditionAction(state, "ghost", {}, "x", true)).toBe(
        state,
      );
      expect(completeExpeditionAction(state, "dwarf-2", {}, "x", true)).toBe(
        state,
      );
    });

    it("lets the knight join only once", () => {
      const first = completeExpeditionAction(
        expeditionState(),
        "dwarf-1",
        {},
        "First success.",
        true,
      );

      // second scout travels and also succeeds at the recruiting destination
      const second = completeExpeditionAction(
        {
          ...first,
          dwarves: first.dwarves.map((d) =>
            d.id === "dwarf-2" ? { ...d, status: "expedition" as const } : d,
          ),
        },
        "dwarf-2",
        {},
        "Second success.",
        true,
      );

      expect(knightsOf(second)).toHaveLength(1);
      expect(second.dwarves).toHaveLength(first.dwarves.length);
      expect(second.sirOneUperJoined).toBe(true);
    });

    it("does not add a second knight when the flag is already set", () => {
      const state = makeState(
        [makeDwarf("dwarf-1", "mining", "expedition"), makeKnight()],
        { sirOneUperJoined: true },
      );
      const next = completeExpeditionAction(state, "dwarf-1", {}, "x", true);

      expect(knightsOf(next)).toHaveLength(1);
      expect(next.dwarves).toHaveLength(2);
    });

    it("does not mutate the input state", () => {
      const state = expeditionState();
      const before = structuredClone(state);

      completeExpeditionAction(state, "dwarf-1", { stone: 1 }, "x", true);

      expect(state).toEqual(before);
    });

    it.todo(
      "only the crystal-cave destination triggers recruitment (condition lives in ColonyProvider.runExpedition; extract it into a pure function to test it)",
    );
  });

  describe("[D6.2] recognisably different from a dwarf", () => {
    it("has its own species, identity and icon", () => {
      const next = completeExpeditionAction(
        expeditionState(),
        "dwarf-1",
        {},
        "x",
        true,
      );
      const knight = dwarfOf(next, KNIGHT_ID);
      const dwarf = dwarfOf(next, "dwarf-2");

      expect(knight.species).not.toBe(dwarf.species);
      expect(knight.name).toBe("Sir One Uper");
      expect(knight.title).toBe("Produces 1 extra");
      expect(knight.icon).toBe("🤴");
      expect(knight.specialty).toBeUndefined();
    });

    it("shows a knight-specific label in the roster", () => {
      const html = renderRoster(
        makeState([
          makeDwarf("dwarf-1", "mining", "working", {
            name: "Bromli",
            specialty: "mining",
          }),
          makeKnight(),
        ]),
      );

      expect(html).toContain("Sir One Uper");
      expect(html).toContain("🤴");
      expect(html).toContain("Knight (+1 basic yield)");
      expect(html).toContain("Skilled in Deep Mining");
    });

    it("does not label the knight as a generalist dwarf", () => {
      const html = renderRoster(makeState([makeKnight()]));

      expect(html).not.toContain("Generalist");
    });
  });

  describe("[D6.3] own production capability", () => {
    it("produces +1 on woodcutting compared to a dwarf", () => {
      const knight = advanceDay(
        makeState([
          makeKnight({ assignment: "woodcutting", status: "working" }),
        ]),
      );
      const dwarf = advanceDay(
        makeState([makeDwarf("dwarf-1", "woodcutting")]),
      );

      expect(knight.resources.wood).toBe(14 + 4);
      expect(dwarf.resources.wood).toBe(14 + 3);
    });

    it("produces +1 on mining compared to a dwarf", () => {
      const knight = advanceDay(
        makeState([makeKnight({ assignment: "mining", status: "working" })]),
      );
      const dwarf = advanceDay(makeState([makeDwarf("dwarf-1", "mining")]));

      expect(knight.resources.stone).toBe(9 + 3);
      expect(dwarf.resources.stone).toBe(9 + 2);
    });

    it("produces +1 on farming compared to a dwarf (net of the daily meal)", () => {
      const knight = advanceDay(
        makeState([makeKnight({ assignment: "farming", status: "working" })]),
      );
      const dwarf = advanceDay(makeState([makeDwarf("dwarf-1", "farming")]));

      expect(knight.resources.food).toBe(18 + 5 - 1);
      expect(dwarf.resources.food).toBe(18 + 4 - 1);
    });

    it("produces nothing while idle", () => {
      const next = advanceDay(makeState([makeKnight()]));

      expect(next.resources.wood).toBe(14);
      expect(next.resources.stone).toBe(9);
      expect(next.resources.food).toBe(18 - 1);
    });

    it("combines the knight bonus with an equipped tool", () => {
      const next = advanceDay(
        makeState([
          makeKnight({
            assignment: "mining",
            status: "working",
            hasTool: true,
          }),
        ]),
      );

      expect(next.resources.stone).toBe(9 + 2 + 1 + 1);
    });

    it("combines the knight bonus with the famine modifier", () => {
      const state = makeState(
        [
          makeKnight({ assignment: "mining", status: "working" }),
          makeDwarf("dwarf-1", null, "idle"),
        ],
        { resources: { wood: 14, stone: 9, food: 0, tools: 1, weapons: 0 } },
      );
      const next = advanceDay(state);

      expect(isFamine(state)).toBe(true);
      expect(next.resources.stone).toBe(9 + (2 - 1 + 1));
      expect(next.resources.food).toBe(0);
    });

    it("combines knight bonus, famine modifier and tool", () => {
      const state = makeState(
        [
          makeKnight({
            assignment: "mining",
            status: "working",
            hasTool: true,
          }),
          makeDwarf("dwarf-1", null, "idle"),
        ],
        { resources: { wood: 14, stone: 9, food: 0, tools: 1, weapons: 0 } },
      );

      expect(advanceDay(state).resources.stone).toBe(9 + (2 - 1 + 1 + 1));
    });

    it("produces the same values on repeated calculations", () => {
      const state = makeState([
        makeKnight({ assignment: "farming", status: "working" }),
      ]);

      expect(advanceDay(state).resources).toEqual(advanceDay(state).resources);
    });

    it("includes the knight bonus in the UI net food line", () => {
      const html = renderColonyPage(
        makeState([
          makeKnight({ assignment: "farming", status: "working" }),
          makeDwarf("dwarf-1", null, "idle"),
        ]),
      );

      // 2 meals, farming 4 + 1 knight bonus => +3
      expect(html).toMatch(/class="gain">\+(<!-- -->)?3</);
    });
  });

  describe("[D6.4] crafting and expedition limitation", () => {
    const withSpecialty = () =>
      makeState([
        makeDwarf("dwarf-1", null, "idle", { specialty: "mining" }),
        makeKnight({ specialty: "mining" }), // specialty must not be enough
      ]);

    it("lets a specialist dwarf forge a tool (control case)", () => {
      const next = craftToolAction(withSpecialty(), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Tool");
      expect(next.resources.wood).toBe(14 - 3);
      expect(next.resources.stone).toBe(9 - 2);
    });

    it("rejects tool forging for the knight without side effects", () => {
      const state = withSpecialty();

      expect(craftToolAction(state, KNIGHT_ID)).toBe(state);
    });

    it("lets a specialist dwarf forge a weapon (control case)", () => {
      const next = craftWeaponAction(withSpecialty(), "dwarf-1");

      expect(dwarfOf(next, "dwarf-1").status).toBe("forging_Weapon");
      expect(next.resources.wood).toBe(14 - 4);
      expect(next.resources.stone).toBe(9 - 3);
    });

    it("rejects weapon forging for the knight without side effects", () => {
      const state = withSpecialty();

      expect(craftWeaponAction(state, KNIGHT_ID)).toBe(state);
    });

    it("rejects expeditions for the knight but not for a dwarf", () => {
      const state = makeState([
        makeDwarf("dwarf-1", null, "idle"),
        makeKnight(),
      ]);

      expect(startExpeditionAction(state, KNIGHT_ID, "crystal-cave")).toBe(
        state,
      );
      expect(
        dwarfOf(
          startExpeditionAction(state, "dwarf-1", "crystal-cave"),
          "dwarf-1",
        ).status,
      ).toBe("expedition");
    });

    it("does not offer the knight as an expedition scout", () => {
      const html = renderColonyPage(
        makeState([makeDwarf("dwarf-1", null, "idle"), makeKnight()]),
      );

      expect(html).toContain('value="dwarf-1"');
      expect(html).not.toContain(`value="${KNIGHT_ID}"`);
    });

    it("does not offer the knight as a forge specialist", () => {
      const html = renderForge(
        makeState([
          makeDwarf("dwarf-1", null, "idle", {
            name: "Bromli",
            specialty: "mining",
          }),
          makeKnight(),
        ]),
      );

      expect(html).toContain("Bromli");
      expect(html).not.toContain("Sir One Uper");
    });
  });

  describe("[D6.5] consistency with the colony rules", () => {
    it("eats one food per day like every dwarf", () => {
      const without = advanceDay(
        makeState([makeDwarf("dwarf-1", null, "idle")]),
      );
      const withKnight = advanceDay(
        makeState([makeDwarf("dwarf-1", null, "idle"), makeKnight()]),
      );

      expect(without.resources.food).toBe(17);
      expect(withKnight.resources.food).toBe(16);
    });

    it("counts the knight for famine detection (boundary: exact fit)", () => {
      const dwarves = [makeDwarf("dwarf-1", null, "idle"), makeKnight()];
      const exact = makeState(dwarves, {
        resources: { wood: 14, stone: 9, food: 2, tools: 1, weapons: 0 },
      });
      const short = makeState(dwarves, {
        resources: { wood: 14, stone: 9, food: 1, tools: 1, weapons: 0 },
      });

      expect(isFamine(exact)).toBe(false);
      expect(isFamine(short)).toBe(true);
    });

    it("announces famine exactly once when a knight is part of the colony", () => {
      const state = makeState(
        [
          makeKnight({ assignment: "mining", status: "working" }),
          makeDwarf("dwarf-1", "mining"),
        ],
        { resources: { wood: 14, stone: 9, food: 0, tools: 1, weapons: 0 } },
      );
      const famineLines = advanceDay(state).log.filter((e) =>
        e.message.includes("Famine"),
      );

      expect(famineLines).toHaveLength(1);
    });

    it("never lets food drop below zero", () => {
      const state = makeState(
        [makeKnight(), makeDwarf("dwarf-1", null, "idle")],
        { resources: { wood: 0, stone: 0, food: 1, tools: 0, weapons: 0 } },
      );

      expect(advanceDay(state).resources.food).toBe(0);
    });

    it("assigns the knight to exactly one job and allows reassigning or unassigning", () => {
      const state = makeState([makeKnight()]);
      const mining = assignJob(state, KNIGHT_ID, "mining");
      const farming = assignJob(mining, KNIGHT_ID, "farming");
      const unassigned = assignJob(farming, KNIGHT_ID, null);

      expect(dwarfOf(mining, KNIGHT_ID)).toMatchObject({
        assignment: "mining",
        status: "working",
      });
      expect(dwarfOf(farming, KNIGHT_ID)).toMatchObject({
        assignment: "farming",
        status: "working",
      });
      expect(dwarfOf(unassigned, KNIGHT_ID)).toMatchObject({
        assignment: null,
        status: "idle",
      });
    });

    it("changes only the targeted resident and leaves the input unchanged", () => {
      const state = makeState([makeDwarf("dwarf-1", "mining"), makeKnight()]);
      const before = structuredClone(state);
      const next = assignJob(state, KNIGHT_ID, "woodcutting");

      expect(dwarfOf(next, "dwarf-1")).toEqual(dwarfOf(state, "dwarf-1"));
      expect(dwarfOf(next, KNIGHT_ID).species).toBe("knight");
      expect(state).toEqual(before);
    });

    it.each([
      "resting",
      "expedition",
      "forging_Tool",
      "forging_Weapon",
    ] as const)(
      "rejects job changes for a knight with status %s and returns the same state",
      (status) => {
        const state = makeState([makeKnight({ assignment: "mining", status })]);

        expect(assignJob(state, KNIGHT_ID, "farming")).toBe(state);
      },
    );

    it("produces nothing on the resting day and returns to work afterwards", () => {
      const state = makeState([
        makeKnight({ assignment: "mining", status: "resting" }),
      ]);
      const next = advanceDay(state);

      expect(next.resources.stone).toBe(9);
      expect(dwarfOf(next, KNIGHT_ID).status).toBe("working");
      expect(isProducing(dwarfOf(state, KNIGHT_ID))).toBe(false);
    });

    it("returns an unassigned resting knight to idle", () => {
      const next = advanceDay(makeState([makeKnight({ status: "resting" })]));

      expect(dwarfOf(next, KNIGHT_ID).status).toBe("idle");
    });

    it("lets the knight equip and return a tool from the shared inventory", () => {
      const state = makeState([makeKnight()]);
      const equipped = toggleToolAction(state, KNIGHT_ID, false, "equipped");
      const returned = toggleToolAction(equipped, KNIGHT_ID, true, "returned");

      expect(dwarfOf(equipped, KNIGHT_ID).hasTool).toBe(true);
      expect(equipped.resources.tools).toBe(0);
      expect(dwarfOf(returned, KNIGHT_ID).hasTool).toBe(false);
      expect(returned.resources.tools).toBe(1);
    });

    it("rejects equipping when no spare tool exists", () => {
      const state = makeState([makeKnight()], {
        resources: { wood: 14, stone: 9, food: 18, tools: 0, weapons: 0 },
      });

      expect(toggleToolAction(state, KNIGHT_ID, false, "equipped")).toBe(state);
    });
  });

  describe("[D6.6] persistence", () => {
    const joinedColony = () =>
      completeExpeditionAction(expeditionState(), "dwarf-1", {}, "x", true);

    it("keeps the knight with species and status after save and load", () => {
      const storage = memoryStorage();
      const colony = makeState(
        [
          makeDwarf("dwarf-1", "mining"),
          makeKnight({
            assignment: "farming",
            status: "working",
            hasTool: true,
          }),
        ],
        { sirOneUperJoined: true },
      );

      expect(saveSnapshot(makeSnapshot(colony), storage)).toBe(true);
      const loaded = loadSnapshot(storage);

      expect(loaded.status).toBe("ok");
      if (loaded.status !== "ok") return;
      expect(dwarfOf(loaded.snapshot.colony, KNIGHT_ID)).toEqual(
        dwarfOf(colony, KNIGHT_ID),
      );
      expect(loaded.snapshot.colony.sirOneUperJoined).toBe(true);
    });

    it("keeps the join flag so the knight cannot join twice after a reload", () => {
      const storage = memoryStorage();
      saveSnapshot(makeSnapshot(joinedColony()), storage);
      const loaded = loadSnapshot(storage);
      if (loaded.status !== "ok") throw new Error("test setup: load failed");

      const reloaded = loaded.snapshot.colony;
      const travelling = {
        ...reloaded,
        dwarves: reloaded.dwarves.map((d) =>
          d.id === "dwarf-2" ? { ...d, status: "expedition" as const } : d,
        ),
      };
      const next = completeExpeditionAction(
        travelling,
        "dwarf-2",
        {},
        "x",
        true,
      );

      expect(knightsOf(next)).toHaveLength(1);
      expect(next.dwarves).toHaveLength(reloaded.dwarves.length);
    });

    it("restores the knight through the bootstrap of the provider", () => {
      const storage = memoryStorage();
      saveSnapshot(makeSnapshot(joinedColony()), storage);
      const boot = bootstrapColony(storage);

      expect(knightsOf(boot.colony)).toHaveLength(1);
      expect(boot.colony.sirOneUperJoined).toBe(true);
      expect(boot.paused).toBe(true);
    });

    it("treats a save without species as dwarf and without flag as not joined", () => {
      const raw = toRaw(makeSnapshot(makeState([makeDwarf("dwarf-1")])));
      delete rawDwarf(raw, 0).species;
      delete raw.colony.sirOneUperJoined;

      const result = validateSnapshot(raw);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.snapshot.colony.dwarves[0].species).toBe("dwarf");
      expect(result.snapshot.colony.sirOneUperJoined).toBe(false);
    });

    it("rejects an unknown species as corrupt", () => {
      const raw = toRaw(makeSnapshot(joinedColony()));
      rawDwarf(raw, 0).species = "elf";

      expect(validateSnapshot(raw)).toEqual({ ok: false, reason: "corrupt" });
    });

    it("rejects a non-boolean join flag as corrupt", () => {
      const raw = toRaw(makeSnapshot(joinedColony()));
      raw.colony.sirOneUperJoined = "yes";

      expect(validateSnapshot(raw)).toEqual({ ok: false, reason: "corrupt" });
    });

    it("rejects duplicate knight ids as corrupt", () => {
      const colony = makeState([makeKnight(), makeKnight()], {
        sirOneUperJoined: true,
      });

      expect(validateSnapshot(toRaw(makeSnapshot(colony)))).toEqual({
        ok: false,
        reason: "corrupt",
      });
    });
  });
});
