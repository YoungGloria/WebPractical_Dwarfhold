/**
 * Test for requirement D7 - Expedition consequences and defense
 * (Abandoned Fortifications -> a raid follows the scout home)
 *
 * Team decisions covered by these tests:
 *   - Destination:      "Abandoned Fortifications" (attack: true)
 *   - Weapon threshold: 3 weapons
 *   - Defense:          CONSUMES the threshold (3 weapons), surplus is kept
 *   - Undefended raid:  ALL weapons are lost and wood, stone, food and tools
 *                       are halved (Math.round, so .5 rounds up for the colony)
 *
 * Covers the following subtask classifications:
 *
 * [D7.1] The additional destination
 *        - the destination is offered in the interface and flagged as an attack
 *        - its server outcome carries rewards and a raid flag
 *        - the other destinations carry no raid flag
 *        - it does not recruit the knight (that stays a D6 decision)
 *
 * [D7.2] The attack follows a successful expedition only
 *        - a successful delivery triggers exactly one raid
 *        - failed requests (503, forced failure, blocked pass) never trigger it
 *        - a repeated/late delivery or an unknown scout never triggers it
 *        - destinations without a raid flag never trigger it
 *        - the real expedition runner wires this correctly (mocked network)
 *
 * [D7.3] Defense with enough weapons
 *        - the threshold is exactly 3 weapons (boundary 2 / 3 / 4)
 *        - defense consumes 3 weapons and keeps the surplus
 *        - no resource is looted when the colony defends
 *        - the weapons delivered by the expedition itself count
 *
 * [D7.4] Deterministic looting without enough weapons
 *        - all weapons are lost
 *        - wood, stone, food and tools are halved, odd numbers round up
 *        - the result is identical on every run and does not use randomness
 *        - resources never become negative or fractional
 *
 * [D7.5] Result and effect are clearly visible
 *        - the raid notice tells defended / looted / had weapons or not
 *        - the chronicle records the raid with the right tone
 *        - the popup is rendered with a Close button and can disappear
 *        - the resource bar shows the changed stock
 *
 * [D7.6] State consistency and persistence
 *        - dwarves, equipped tools, day and the knight flag are untouched
 *        - the raid state survives a save and load
 *        - the raid does not mutate its input (also with empty rewards)
 *
 * [D7.7] Server behaviour (real Express server on a test port)
 *        - fortifications return rewards and raid: true
 *        - repeated requestId answers with the same expedition
 *        - failures return an error body without rewards and without raid flag
 */
interface ChildProcess {
  stdout?: {
    on(event: string, listener: (chunk: { toString(): string }) => void): void;
  };
  on(event: string, listener: (error: Error) => void): void;
  kill(): void;
}

const childProcessModule = "node:child_process";
async function spawnNodeProcess(
  command: string,
  args: string[],
  options: { env: Record<string, string | undefined>; stdio: string[] },
): Promise<ChildProcess> {
  const { spawn } = (await import(childProcessModule)) as {
    spawn: (
      command: string,
      args: string[],
      options: { env: Record<string, string | undefined>; stdio: string[] },
    ) => ChildProcess;
  };
  return spawn(command, args, options);
}
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DwarfRoster } from "../../components/DwarfRoster";
import { ResourceBar } from "../../components/ResourceBar";
import {
  destinationRecruitsKnight,
  destinations,
  getDestination,
} from "../../config/destinations";
import { SAVE_VERSION } from "../../config/constants";
import { raidAction } from "../../domain/actions/attack";
import {
  completeExpeditionAction,
  failExpeditionAction,
  startExpeditionAction,
} from "../../domain/actions/expedition";
import { createInitialState } from "../../domain/initialState";
import type {
  ColonyState,
  Dwarf,
  DwarfStatus,
  ExpeditionResult,
  JobType,
  PopupNotice,
} from "../../domain/types";
import { loadSnapshot, saveSnapshot } from "../../persistence/ring";
import type {
  PendingExpedition,
  Snapshot,
  StorageLike,
} from "../../persistence/schema";
import { Layout } from "../../pages/Layout";
import { ColonyPage } from "../../pages/ColonyPage";
import {
  ColonyContext,
  type ColonyContextValue,
} from "../../state/ColonyContext";
import { useExpeditionRunner } from "../../state/hooks/useExpeditionRunner";

const FORTRESS = "abandoned-fortifications";
const THRESHOLD = 3;

/** What the server returns for the fortifications (see server/index.js). */
const FORTRESS_REWARDS = { stone: 4, wood: 3, tools: 1, weapons: 1 };

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

function makeState(
  weapons = 0,
  overrides: Partial<ColonyState> = {},
): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1, weapons },
    dwarves: [
      makeDwarf("dwarf-1", "mining", "expedition"),
      makeDwarf("dwarf-2", "woodcutting", "working"),
    ],
    log: [],
    logSeq: 0,
    sirOneUperJoined: false,
    ...overrides,
  };
}

const dwarfOf = (state: ColonyState, id: string): Dwarf => {
  const dwarf = state.dwarves.find((item) => item.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
};

/**
 * Mirrors the delivery step of useExpeditionRunner.runExpedition for tests
 * that only need the state level: complete the expedition, then raid if the
 * result carries a raid flag and the completion actually changed the state.
 */
function deliver(
  current: ColonyState,
  dwarfId: string,
  result: Pick<ExpeditionResult, "rewards" | "message" | "raid">,
): { colony: ColonyState; notice: PopupNotice | null } {
  let next = completeExpeditionAction(
    current,
    dwarfId,
    result.rewards,
    result.message,
  );
  let notice: PopupNotice | null = null;
  if (next !== current && result.raid) {
    const raid = raidAction(next);
    next = raid.colony;
    notice = raid.notice;
  }
  return { colony: next, notice };
}

const fortressResult = (): Pick<
  ExpeditionResult,
  "rewards" | "message" | "raid"
> => ({
  rewards: { ...FORTRESS_REWARDS },
  message: "The abandoned fortifications are already looted.",
  raid: true,
});

/** State right after the fortress rewards were paid, before the raid starts. */
function afterRewards(weapons: number): ColonyState {
  return completeExpeditionAction(
    makeState(weapons),
    "dwarf-1",
    FORTRESS_REWARDS,
    "back",
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

function layoutContext(
  colony: ColonyState,
  raidNotice: PopupNotice | null,
): ColonyContextValue {
  return {
    colony,
    paused: false,
    activities: colony.log,
    expeditionPending: false,
    dayPhase: "EARLY MORNING",
    daySecondsLeft: 8,
    restoreNotice: null,
    dismissRestoreNotice: noop,
    raidNotice,
    dismissRaidNotice: noop,
    togglePaused: noop,
    assignDwarf: noop,
    sendExpedition: noop,
    toggleTool: noop,
  } as unknown as ColonyContextValue;
}

function renderWithContext(
  value: ColonyContextValue,
  component: () => ReturnType<typeof createElement>,
): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(
        ColonyContext.Provider,
        { value },
        createElement(component),
      ),
    ),
  );
}

/* ------------------------------------------------------------------ */
/* Test harness for the real expedition runner (hook) with mocked fetch */
/* ------------------------------------------------------------------ */

interface RunnerHarness {
  colonyRef: { current: ColonyState };
  setRaidNotice: ReturnType<typeof vi.fn>;
  saveDuringDay: ReturnType<typeof vi.fn>;
  pendingRequests: { current: Map<string, PendingExpedition> };
  run: (dwarfId: string, destination: string) => Promise<void>;
  sendExpedition: (dwarfId: string, destination: string) => void;
}

function makeRunner(initial: ColonyState): RunnerHarness {
  const colonyRef = { current: initial };
  const setColony = vi.fn(
    (value: ColonyState | ((current: ColonyState) => ColonyState)) => {
      colonyRef.current =
        typeof value === "function" ? value(colonyRef.current) : value;
    },
  );
  const setRaidNotice = vi.fn();
  const saveDuringDay = vi.fn();
  const pendingRequests = { current: new Map<string, PendingExpedition>() };

  let runner: ReturnType<typeof useExpeditionRunner> | undefined;
  function Probe() {
    runner = useExpeditionRunner({
      colony: colonyRef.current,
      colonyRef,
      setColony,
      setRaidNotice,
      pendingRequests,
      saveDuringDay,
      raidNoticeRef: { current: null },
    });
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!runner) throw new Error("test setup: runner was not created");
  const active = runner;

  return {
    colonyRef,
    setRaidNotice,
    saveDuringDay,
    pendingRequests,
    run: (dwarfId, destination) =>
      active.runExpedition(
        dwarfId,
        destination,
        `req-${dwarfId}-${destination}`,
      ),
    sendExpedition: active.sendExpedition,
  };
}

function mockFetchJson(status: number, body: unknown) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const fortressBody = {
  expeditionId: "expedition-17",
  status: "completed",
  rewards: FORTRESS_REWARDS,
  message: "The abandoned fortifications are already looted.",
  raid: true,
};

describe("D7 expedition consequences and defense", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("[D7.1] the additional destination", () => {
    it("offers the abandoned fortifications as a destination", () => {
      const destination = getDestination(FORTRESS);

      expect(destination).toBeDefined();
      expect(destination?.label).toBe("Abandoned Fortifications");
      expect(destinations.map((d) => d.id)).toContain(FORTRESS);
    });

    it("flags the destination as an attack destination", () => {
      expect(getDestination(FORTRESS)?.attack).toBe(true);
    });

    it("does not make the fortifications a knight recruiting destination", () => {
      expect(destinationRecruitsKnight(FORTRESS)).toBe(false);
    });

    it("keeps the crystal cave and the old mine free of attacks", () => {
      expect(getDestination("crystal-cave")?.attack).toBe(false);
      expect(getDestination("old-mine")?.attack).toBe(false);
    });

    it("lists the fortifications in the expedition panel of the colony page", () => {
      const colony = makeState(0, {
        dwarves: [makeDwarf("dwarf-1", null, "idle")],
      });
      const html = renderWithContext(layoutContext(colony, null), ColonyPage);

      expect(html).toContain('value="abandoned-fortifications"');
      expect(html).toContain("Abandoned Fortifications");
    });

    it("lets a dwarf depart for the fortifications like for any destination", () => {
      const state = makeState(0, {
        dwarves: [makeDwarf("dwarf-1", null, "idle")],
      });
      const next = startExpeditionAction(state, "dwarf-1", FORTRESS);

      expect(dwarfOf(next, "dwarf-1").status).toBe("expedition");
      expect(next.log[0].message).toContain("departed for");
      expect(next.resources).toEqual(state.resources);
    });

    it("never starts an attack by merely departing", () => {
      const state = makeState(0, {
        dwarves: [makeDwarf("dwarf-1", null, "idle")],
      });
      const next = startExpeditionAction(state, "dwarf-1", FORTRESS);

      expect(next.resources.weapons).toBe(0);
      expect(next.log).toHaveLength(1);
    });
  });

  describe("[D7.2] the attack follows a successful expedition only", () => {
    it("triggers exactly one raid after a successful delivery", () => {
      const { colony, notice } = deliver(
        makeState(0),
        "dwarf-1",
        fortressResult(),
      );

      expect(notice).not.toBeNull();
      // expedition message + raid message
      expect(colony.log).toHaveLength(2);
      expect(colony.log[0].message).toContain("raided");
    });

    it("does not raid when the result carries no raid flag", () => {
      const state = makeState(0);
      const { colony, notice } = deliver(state, "dwarf-1", {
        rewards: { stone: 8, tools: 1 },
        message: "Crystals.",
        raid: false,
      });

      expect(notice).toBeNull();
      expect(colony.resources.stone).toBe(state.resources.stone + 8);
      expect(colony.resources.wood).toBe(state.resources.wood);
      expect(colony.log).toHaveLength(1);
    });

    it("does not raid when the expedition failed", () => {
      const state = makeState(0);
      const next = failExpeditionAction(state, "dwarf-1", "Rockfall.");

      expect(next.resources).toEqual(state.resources);
      expect(next.log).toHaveLength(1);
      expect(next.log[0].tone).toBe("warning");
      expect(next.log[0].message).not.toContain("raid");
    });

    it("does not raid for an unknown scout (delivery is ignored)", () => {
      const state = makeState(0);
      const { colony, notice } = deliver(state, "ghost", fortressResult());

      expect(colony).toBe(state);
      expect(notice).toBeNull();
    });

    it("does not raid for a dwarf that is not travelling", () => {
      const state = makeState(0);
      const { colony, notice } = deliver(state, "dwarf-2", fortressResult());

      expect(colony).toBe(state);
      expect(notice).toBeNull();
    });

    it("does not raid a second time when the same success is delivered twice", () => {
      const first = deliver(makeState(0), "dwarf-1", fortressResult());
      const second = deliver(first.colony, "dwarf-1", fortressResult());

      expect(second.colony).toBe(first.colony);
      expect(second.notice).toBeNull();
      expect(second.colony.log).toHaveLength(2);
    });

    it("pays the rewards before the raid starts", () => {
      const state = makeState(THRESHOLD);
      const { colony } = deliver(state, "dwarf-1", fortressResult());

      // defended: nothing looted, so the full reward is visible
      expect(colony.resources.stone).toBe(state.resources.stone + 4);
      expect(colony.resources.wood).toBe(state.resources.wood + 3);
      expect(colony.resources.tools).toBe(state.resources.tools + 1);
    });

    describe("with the real expedition runner (mocked network)", () => {
      it("raids after a successful fortifications expedition", async () => {
        mockFetchJson(200, fortressBody);
        const harness = makeRunner(makeState(0));

        await harness.run("dwarf-1", FORTRESS);

        expect(harness.setRaidNotice).toHaveBeenCalledTimes(1);
        expect(harness.colonyRef.current.log[0].message).toContain("raided");
        expect(dwarfOf(harness.colonyRef.current, "dwarf-1").status).toBe(
          "resting",
        );
        expect(harness.saveDuringDay).toHaveBeenCalled();
      });

      it("does not raid after a 503 and awards nothing", async () => {
        mockFetchJson(503, { error: "Rockfall has sealed the route." });
        const state = makeState(0);
        const harness = makeRunner(state);

        await harness.run("dwarf-1", "blocked-pass");

        expect(harness.setRaidNotice).not.toHaveBeenCalled();
        expect(harness.colonyRef.current.resources).toEqual(state.resources);
        expect(dwarfOf(harness.colonyRef.current, "dwarf-1").status).toBe(
          "resting",
        );
        expect(harness.colonyRef.current.log[0].tone).toBe("warning");
      });

      it("does not raid after a failed fortifications request", async () => {
        mockFetchJson(503, { error: "The company heard no signal." });
        const state = makeState(0);
        const harness = makeRunner(state);

        await harness.run("dwarf-1", FORTRESS);

        expect(harness.setRaidNotice).not.toHaveBeenCalled();
        expect(harness.colonyRef.current.resources).toEqual(state.resources);
      });

      it("does not raid when the server answers without a raid flag", async () => {
        mockFetchJson(200, {
          expeditionId: "expedition-17",
          status: "completed",
          rewards: { stone: 8, tools: 1 },
          message: "Crystals.",
          raid: false,
        });
        const harness = makeRunner(makeState(0));

        await harness.run("dwarf-1", "crystal-cave");

        expect(harness.setRaidNotice).not.toHaveBeenCalled();
        expect(harness.colonyRef.current.resources.weapons).toBe(0);
      });

      it("does not raid twice when the result is delivered twice", async () => {
        mockFetchJson(200, fortressBody);
        const harness = makeRunner(makeState(0));

        await harness.run("dwarf-1", FORTRESS);
        const afterFirst = harness.colonyRef.current;
        await harness.run("dwarf-1", FORTRESS);

        expect(harness.setRaidNotice).toHaveBeenCalledTimes(1);
        expect(harness.colonyRef.current).toBe(afterFirst);
      });

      it("raids once per expedition for two separate expeditions", async () => {
        mockFetchJson(200, fortressBody);
        const state = makeState(0, {
          dwarves: [
            makeDwarf("dwarf-1", "mining", "expedition"),
            makeDwarf("dwarf-2", "woodcutting", "expedition"),
          ],
        });
        const harness = makeRunner(state);

        await harness.run("dwarf-1", FORTRESS);
        await harness.run("dwarf-2", FORTRESS);

        expect(harness.setRaidNotice).toHaveBeenCalledTimes(2);
      });

      it("ignores a second send of a scout that is already travelling", () => {
        const harness = makeRunner(makeState(0));
        const before = harness.colonyRef.current;

        harness.sendExpedition("dwarf-2", FORTRESS);
        harness.sendExpedition("dwarf-2", FORTRESS);

        // one pending request for dwarf-2, no raid, no resources changed
        expect(harness.pendingRequests.current.size).toBe(1);
        expect(harness.setRaidNotice).not.toHaveBeenCalled();
        expect(harness.colonyRef.current.resources).toEqual(before.resources);
      });
    });
  });

  describe("[D7.3] defense with enough weapons", () => {
    it("defends with exactly three weapons (boundary)", () => {
      const state = makeState(THRESHOLD);
      const raid = raidAction(structuredClone(state));

      expect(raid.notice.header).toBe("The Raid was defeated!");
    });

    it("does not defend with two weapons (boundary)", () => {
      const raid = raidAction(structuredClone(makeState(THRESHOLD - 1)));

      expect(raid.notice.header).toBe("You have been raided!");
    });

    it("defends with four weapons", () => {
      const raid = raidAction(structuredClone(makeState(4)));

      expect(raid.notice.header).toBe("The Raid was defeated!");
    });

    it("consumes exactly the threshold when defending", () => {
      const raid = raidAction(structuredClone(makeState(THRESHOLD)));

      expect(raid.colony.resources.weapons).toBe(0);
    });

    it("keeps surplus weapons beyond the threshold", () => {
      expect(
        raidAction(structuredClone(makeState(4))).colony.resources.weapons,
      ).toBe(1);
      expect(
        raidAction(structuredClone(makeState(7))).colony.resources.weapons,
      ).toBe(4);
    });

    it("loots nothing when the colony defends", () => {
      const state = makeState(THRESHOLD);
      const raid = raidAction(structuredClone(state));

      expect(raid.colony.resources.wood).toBe(state.resources.wood);
      expect(raid.colony.resources.stone).toBe(state.resources.stone);
      expect(raid.colony.resources.food).toBe(state.resources.food);
      expect(raid.colony.resources.tools).toBe(state.resources.tools);
    });

    it("logs a successful defense as a good chronicle entry", () => {
      const raid = raidAction(structuredClone(makeState(THRESHOLD)));

      expect(raid.colony.log[0].tone).toBe("good");
      expect(raid.colony.log[0].message).toContain("defeated");
    });

    it("counts the weapon found on the expedition towards the threshold", () => {
      // 2 weapons stored + 1 reward = 3 -> defended
      const { colony, notice } = deliver(
        makeState(2),
        "dwarf-1",
        fortressResult(),
      );

      expect(notice?.header).toBe("The Raid was defeated!");
      expect(colony.resources.weapons).toBe(0);
    });

    it("is not defended with one stored weapon plus the reward (2 < 3)", () => {
      const { notice } = deliver(makeState(1), "dwarf-1", fortressResult());

      expect(notice?.header).toBe("You have been raided!");
    });

    it("defends the full flow from the initial colony state after forging", () => {
      const initial = createInitialState();
      const state: ColonyState = {
        ...initial,
        resources: { ...initial.resources, weapons: THRESHOLD },
        dwarves: initial.dwarves.map((d) =>
          d.id === "dwarf-2" ? { ...d, status: "expedition" as const } : d,
        ),
      };
      const { colony, notice } = deliver(state, "dwarf-2", fortressResult());

      expect(notice?.header).toBe("The Raid was defeated!");
      // 3 stored + 1 reward - 3 consumed
      expect(colony.resources.weapons).toBe(1);
    });
  });

  describe("[D7.4] deterministic looting without enough weapons", () => {
    it("loses all weapons when the colony cannot defend", () => {
      expect(
        raidAction(structuredClone(makeState(0))).colony.resources.weapons,
      ).toBe(0);
      expect(
        raidAction(structuredClone(makeState(1))).colony.resources.weapons,
      ).toBe(0);
      expect(
        raidAction(structuredClone(makeState(2))).colony.resources.weapons,
      ).toBe(0);
    });

    it("halves wood, stone, food and tools", () => {
      const state: ColonyState = {
        ...makeState(0),
        resources: { wood: 20, stone: 10, food: 8, tools: 4, weapons: 0 },
      };
      const raid = raidAction(structuredClone(state));

      expect(raid.colony.resources).toEqual({
        wood: 10,
        stone: 5,
        food: 4,
        tools: 2,
        weapons: 0,
      });
    });

    it("rounds odd numbers up for the colony (Math.round)", () => {
      const state: ColonyState = {
        ...makeState(0),
        resources: { wood: 9, stone: 1, food: 7, tools: 3, weapons: 0 },
      };
      const raid = raidAction(structuredClone(state));

      expect(raid.colony.resources.wood).toBe(5);
      expect(raid.colony.resources.stone).toBe(1);
      expect(raid.colony.resources.food).toBe(4);
      expect(raid.colony.resources.tools).toBe(2);
    });

    it("keeps empty stocks at zero", () => {
      const state: ColonyState = {
        ...makeState(0),
        resources: { wood: 0, stone: 0, food: 0, tools: 0, weapons: 0 },
      };
      const raid = raidAction(structuredClone(state));

      expect(raid.colony.resources).toEqual({
        wood: 0,
        stone: 0,
        food: 0,
        tools: 0,
        weapons: 0,
      });
    });

    it("never produces negative or fractional resources", () => {
      for (let n = 0; n <= 25; n += 1) {
        const state: ColonyState = {
          ...makeState(0),
          resources: {
            wood: n,
            stone: n + 1,
            food: n + 2,
            tools: n,
            weapons: 2,
          },
        };
        const { resources } = raidAction(structuredClone(state)).colony;

        Object.values(resources).forEach((value) => {
          expect(Number.isInteger(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        });
      }
    });

    it("never loots more than the colony owned", () => {
      const state = makeState(0);
      const { resources } = raidAction(structuredClone(state)).colony;

      expect(resources.wood).toBeLessThanOrEqual(state.resources.wood);
      expect(resources.stone).toBeLessThanOrEqual(state.resources.stone);
      expect(resources.food).toBeLessThanOrEqual(state.resources.food);
      expect(resources.tools).toBeLessThanOrEqual(state.resources.tools);
    });

    it("gives the same result for the same input on every run", () => {
      const a = raidAction(structuredClone(makeState(1)));
      const b = raidAction(structuredClone(makeState(1)));

      expect(a.colony.resources).toEqual(b.colony.resources);
      expect(a.notice).toEqual(b.notice);
    });

    it("does not use randomness", () => {
      const random = vi.spyOn(Math, "random");

      raidAction(structuredClone(makeState(0)));
      raidAction(structuredClone(makeState(THRESHOLD)));

      expect(random).not.toHaveBeenCalled();
    });

    it("loots the expedition reward as well (rewards are paid first)", () => {
      // 14/9/18/1 + reward 3 wood, 4 stone, 1 tool, 1 weapon -> 17/13/18/2, 1 weapon
      const { colony } = deliver(makeState(0), "dwarf-1", fortressResult());

      expect(colony.resources).toEqual({
        wood: 9, // round(17 / 2)
        stone: 7, // round(13 / 2)
        food: 9, // round(18 / 2)
        tools: 1, // round(2 / 2)
        weapons: 0, // the found weapon is lost too
      });
    });

    it("is not shielded by a single weapon", () => {
      const raid = raidAction(structuredClone(afterRewards(0)));

      expect(raid.notice.header).toBe("You have been raided!");
    });
  });

  describe("[D7.5] result and effect are clearly visible", () => {
    it("tells the player that the raid was defeated and weapons are used up", () => {
      const { notice } = raidAction(structuredClone(makeState(THRESHOLD)));

      expect(notice.header).toBe("The Raid was defeated!");
      expect(notice.subHeader).toContain("followed your scout");
      expect(notice.message).toContain("defeated the raid");
      expect(notice.message).toContain("weapons");
    });

    it("tells the player that half of the resources were stolen", () => {
      const { notice } = raidAction(structuredClone(makeState(0)));

      expect(notice.header).toBe("You have been raided!");
      expect(notice.subHeader).toContain("followed your scout");
      expect(notice.message).toContain("stole half of your resources");
    });

    it("says that there were no weapons when the colony had none", () => {
      const { notice } = raidAction(structuredClone(makeState(0)));

      expect(notice.message).toContain("did not have any weapons");
    });

    it("says that the weapons were not enough when some existed", () => {
      const { notice } = raidAction(structuredClone(makeState(2)));

      expect(notice.message).toContain("weapons where not enough");
      expect(notice.message).not.toContain("did not have any weapons");
    });

    it("writes a warning into the chronicle for a lost fight", () => {
      const { colony } = raidAction(structuredClone(makeState(0)));

      expect(colony.log[0].tone).toBe("warning");
      expect(colony.log[0].message).toBe(
        "You were raided. They stole half of your resources.",
      );
    });

    it("writes a good entry into the chronicle for a won fight", () => {
      const { colony } = raidAction(structuredClone(makeState(THRESHOLD)));

      expect(colony.log[0].tone).toBe("good");
    });

    it("keeps the expedition report and the raid in the chronicle together", () => {
      const { colony } = deliver(makeState(0), "dwarf-1", fortressResult());

      expect(colony.log[1].message).toContain("fortifications");
      expect(colony.log[1].tone).toBe("good");
      expect(colony.log[0].tone).toBe("warning");
    });

    it("shows the raid popup with header, subheader, message and a Close button", () => {
      const colony = makeState(0);
      const { notice } = raidAction(structuredClone(colony));
      const html = renderWithContext(layoutContext(colony, notice), Layout);

      expect(html).toContain("You have been raided!");
      expect(html).toContain("followed your scout");
      expect(html).toContain("stole half of your resources");
      expect(html).toContain("Close");
    });

    it("shows the defense popup after a successful defense", () => {
      const colony = makeState(THRESHOLD);
      const { notice } = raidAction(structuredClone(colony));
      const html = renderWithContext(layoutContext(colony, notice), Layout);

      expect(html).toContain("The Raid was defeated!");
      expect(html).toContain("too dull to be used again");
    });

    it("shows no raid popup when there is no raid notice", () => {
      const html = renderWithContext(layoutContext(makeState(0), null), Layout);

      expect(html).not.toContain("raided");
      expect(html).not.toContain("defeated");
    });

    it("shows the changed stock and the weapon count in the resource bar", () => {
      const { colony } = raidAction(
        structuredClone({
          ...makeState(0),
          resources: { wood: 20, stone: 10, food: 8, tools: 4, weapons: 2 },
        }),
      );
      const html = renderToStaticMarkup(
        createElement(ResourceBar, { resources: colony.resources }),
      );

      expect(html).toContain("Weapons");
      expect(html).toMatch(/Weapons<\/small><strong>0</);
      expect(html).toMatch(/Timber<\/small><strong>10</);
      expect(html).toMatch(/Stone<\/small><strong>5</);
    });
  });

  describe("[D7.6] state consistency and persistence", () => {
    it("does not touch dwarves, their tools or their assignments", () => {
      const state = makeState(0, {
        dwarves: [
          makeDwarf("dwarf-1", "mining", "expedition"),
          makeDwarf("dwarf-2", "woodcutting", "working", { hasTool: true }),
        ],
      });
      const { colony } = deliver(state, "dwarf-1", fortressResult());

      expect(dwarfOf(colony, "dwarf-2")).toEqual(dwarfOf(state, "dwarf-2"));
      expect(dwarfOf(colony, "dwarf-2").hasTool).toBe(true);
      expect(dwarfOf(colony, "dwarf-1").assignment).toBe("mining");
      expect(colony.dwarves).toHaveLength(state.dwarves.length);
    });

    it("only loots tools in the shared inventory, never equipped ones", () => {
      const state = makeState(0, {
        resources: { wood: 14, stone: 9, food: 18, tools: 2, weapons: 0 },
        dwarves: [
          makeDwarf("dwarf-1", "mining", "expedition"),
          makeDwarf("dwarf-2", "woodcutting", "working", { hasTool: true }),
        ],
      });
      const raid = raidAction(structuredClone(state));

      expect(raid.colony.resources.tools).toBe(1);
      expect(dwarfOf(raid.colony, "dwarf-2").hasTool).toBe(true);
    });

    it("returns the scout to rest regardless of the raid result", () => {
      const lost = deliver(makeState(0), "dwarf-1", fortressResult()).colony;
      const won = deliver(
        makeState(THRESHOLD),
        "dwarf-1",
        fortressResult(),
      ).colony;

      expect(dwarfOf(lost, "dwarf-1").status).toBe("resting");
      expect(dwarfOf(won, "dwarf-1").status).toBe("resting");
    });

    it("keeps the day, the knight flag and the log sequence consistent", () => {
      const state = makeState(0);
      const { colony } = deliver(state, "dwarf-1", fortressResult());

      expect(colony.day).toBe(state.day);
      expect(colony.sirOneUperJoined).toBe(false);
      expect(colony.logSeq).toBe(state.logSeq + 2);
    });

    it("keeps the raided resources after a save and a load", () => {
      const storage = memoryStorage();
      const { colony } = deliver(makeState(0), "dwarf-1", fortressResult());

      expect(saveSnapshot(makeSnapshot(colony), storage)).toBe(true);
      const loaded = loadSnapshot(storage);

      expect(loaded.status).toBe("ok");
      if (loaded.status !== "ok") return;
      expect(loaded.snapshot.colony.resources).toEqual(colony.resources);
      expect(loaded.snapshot.colony.log[0].message).toBe(
        "You were raided. They stole half of your resources.",
      );
    });

    it("keeps the remaining weapons after a successful defense and a reload", () => {
      const storage = memoryStorage();
      const { colony } = deliver(makeState(4), "dwarf-1", fortressResult());

      saveSnapshot(makeSnapshot(colony), storage);
      const loaded = loadSnapshot(storage);

      expect(loaded.status).toBe("ok");
      if (loaded.status !== "ok") return;
      // 4 stored + 1 reward - 3 consumed
      expect(loaded.snapshot.colony.resources.weapons).toBe(2);
    });

    it("shows the knight and the roster unchanged after a raid", () => {
      const knight = makeDwarf("sir-one-uper", null, "idle", {
        species: "knight",
        name: "Sir One Uper",
        icon: "🤴",
      });
      const state = makeState(0, {
        dwarves: [makeDwarf("dwarf-1", "mining", "expedition"), knight],
        sirOneUperJoined: true,
      });
      const { colony } = deliver(state, "dwarf-1", fortressResult());
      const html = renderToStaticMarkup(
        createElement(DwarfRoster, {
          dwarves: colony.dwarves,
          onAssign: noop,
          state: colony,
          onToggleTool: noop,
        }),
      );

      expect(html).toContain("Sir One Uper");
      expect(colony.sirOneUperJoined).toBe(true);
    });

    it("does not mutate the input state", () => {
      for (const weapons of [0, 2, THRESHOLD, 5]) {
        const state = makeState(weapons);
        const before = structuredClone(state);

        raidAction(state);

        expect(state).toEqual(before);
      }
    });

    it("does not leak into the previous state when rewards are empty", () => {
      const previous = makeState(0);
      const before = structuredClone(previous);
      const next = completeExpeditionAction(previous, "dwarf-1", {}, "back");

      raidAction(next);

      expect(previous).toEqual(before);
    });
  });

  describe("[D7.7] server behaviour (real Express server)", () => {
    const PORT = 43217;
    const BASE = `http://127.0.0.1:${PORT}`;
    let server: ChildProcess | undefined;

    beforeAll(async () => {
      server = await spawnNodeProcess("node", ["server/index.js"], {
        env: {
          ...(
            globalThis as typeof globalThis & {
              process?: { env?: Record<string, string | undefined> };
            }
          ).process?.env,
          PORT: String(PORT),
        },
        stdio: ["ignore", "pipe", "inherit"],
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("server did not start")),
          10_000,
        );
        server?.stdout?.on("data", (chunk: { toString(): string }) => {
          if (chunk.toString().includes("listening")) {
            clearTimeout(timer);
            resolve();
          }
        });
        server?.on("error", reject);
      });
    }, 15_000);

    afterAll(() => {
      server?.kill();
    });

    const post = (body: unknown, query = "?latency=0"): Promise<Response> =>
      fetch(`${BASE}/api/expeditions${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("answers the fortifications with rewards and a raid flag", async () => {
      const response = await post({
        dwarfId: "dwarf-1",
        destination: FORTRESS,
      });
      const body = (await response.json()) as ExpeditionResult;

      expect(response.status).toBe(200);
      expect(body.status).toBe("completed");
      expect(body.raid).toBe(true);
      expect(body.rewards).toEqual(FORTRESS_REWARDS);
      expect(body.message.length).toBeGreaterThan(0);
    });

    it.each(["crystal-cave", "old-mine"])(
      "answers %s without a raid flag",
      async (destination) => {
        const response = await post({ dwarfId: "dwarf-1", destination });
        const body = (await response.json()) as ExpeditionResult;

        expect(response.status).toBe(200);
        expect(body.raid).toBe(false);
      },
    );

    it("fails the blocked pass without rewards and without a raid", async () => {
      const response = await post({
        dwarfId: "dwarf-1",
        destination: "blocked-pass",
      });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.rewards).toBeUndefined();
      expect(body.raid).toBeUndefined();
      expect(typeof body.error).toBe("string");
    });

    it("fails a forced failure of the fortifications without a raid", async () => {
      const response = await post(
        { dwarfId: "dwarf-1", destination: FORTRESS },
        "?latency=0&fail=true",
      );
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(503);
      expect(body.rewards).toBeUndefined();
      expect(body.raid).toBeUndefined();
    });

    it("rejects invalid requests without a raid", async () => {
      const response = await post({ destination: FORTRESS });
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(400);
      expect(body.raid).toBeUndefined();
    });

    it("answers a repeated requestId with the same expedition", async () => {
      const request = {
        dwarfId: "dwarf-1",
        destination: FORTRESS,
        requestId: "d7-repeat-1",
      };
      const first = (await (await post(request)).json()) as ExpeditionResult;
      const second = (await (await post(request)).json()) as ExpeditionResult;

      expect(second.expeditionId).toBe(first.expeditionId);
      expect(second.raid).toBe(true);
      expect(second.rewards).toEqual(first.rewards);
    });

    it("rejects a requestId that was used for another destination", async () => {
      await post({
        dwarfId: "dwarf-1",
        destination: FORTRESS,
        requestId: "d7-conflict-1",
      });
      const response = await post({
        dwarfId: "dwarf-1",
        destination: "old-mine",
        requestId: "d7-conflict-1",
      });

      expect(response.status).toBe(409);
    });
  });
});
