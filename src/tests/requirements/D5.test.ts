/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
/**
 * Test for requirement D5 - Save and restore
 *
 * Covers the following subtask classifications:
 *
 * [D5.1] Round trip (refresh simulation)
 *        - day, resources, workers, assignments, equipped tools, chronicle and
 *          the elapsed part of the day are restored after a "refresh"
 *        - an empty storage starts a new colony
 *
 * [D5.2] Snapshot history (ring buffer)
 *        - newest snapshot comes first, at most MAX_SAVES are kept
 *        - identical snapshots are not stored twice, "replaceHead" refreshes in place
 *        - clearing the save removes everything
 *
 * [D5.3] Corrupt and incompatible data fall back safely
 *        - unparsable JSON, wrong container types, empty history
 *        - a different save version is "incompatible", a missing/invalid one "corrupt"
 *        - the game never throws, it starts a new paused colony with a notice
 *        - a damaged newest snapshot falls back to the next valid older one
 *
 * [D5.4] Field validation
 *        - negative, fractional, missing or non-numeric resources are rejected
 *        - unknown statuses/jobs/specialties, wrong field types are rejected
 *        - duplicate dwarf ids, an empty company and broken chronicle entries are rejected
 *        - invalid elapsed-day values and broken pending expeditions are rejected
 *
 * [D5.5] Policy for tasks interrupted by a refresh
 *        - forging continues: a missing countdown is replaced by the full duration,
 *          an existing countdown is kept
 *        - an expedition with a pending request continues with its remaining time
 *        - an expedition without a request is declared lost, the dwarf is never stuck away
 *        - every interrupted task is explained in the chronicle
 *
 * [D5.6] Visible restore behaviour
 *        - after restoring, the hold is paused and a notice explains what happened
 *        - an older save is reported as partial progress loss
 *        - a fallback notice distinguishes damaged from incompatible saves
 *
 * [D5.7] Storage failures
 *        - unreadable or full storage never crashes saving or loading
 *
 * The detailed positive, negative and edge cases are grouped below by
 * round trip, history, validation, interrupted tasks and notices.
 */
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Popup } from "../../components/Popup";
import { createInitialState } from "../../domain/initialState";
import {
  bootstrapColony,
  clearColonySave,
  loadSnapshot,
  MAX_SAVES,
  SAVE_KEY,
  SAVE_VERSION,
  saveSnapshot,
  validateSnapshot,
  type Snapshot,
  type StorageLike,
} from "../../persistence";
import {
  DAY_MS,
  EXPEDITION_SECONDS,
  FORGE_TOOL_SECONDS,
  FORGE_WEAPON_SECONDS,
} from "../../simulation";
import type { ColonyState, Dwarf } from "../../domain/types";

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const brokenStorage = (): StorageLike => ({
  getItem: () => {
    throw new Error("storage denied");
  },
  setItem: () => {
    throw new Error("quota exceeded");
  },
  removeItem: () => {
    throw new Error("storage denied");
  },
});

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: SAVE_VERSION,
    savedAt: 1_000,
    colony: createInitialState(),
    dayElapsedMs: 3_000,
    pendingExpeditions: {},
    ...overrides,
  };
}

/** Deep-cloned JSON object of a snapshot that tests can damage freely. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (snapshot: Snapshot = makeSnapshot()): Record<string, any> =>
  JSON.parse(JSON.stringify(snapshot));

const withDwarf = (patch: Partial<Dwarf>): Snapshot => {
  const snapshot = makeSnapshot();
  snapshot.colony.dwarves[0] = { ...snapshot.colony.dwarves[0], ...patch };
  return snapshot;
};

const seed = (storage: MemoryStorage, value: unknown) =>
  storage.setItem(
    SAVE_KEY,
    typeof value === "string" ? value : JSON.stringify(value),
  );

const dwarfOf = (colony: ColonyState, id: string): Dwarf => {
  const dwarf = colony.dwarves.find((item) => item.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
};

describe("D5 save and restore", () => {
  describe("round trip (refresh simulation)", () => {
    it("starts a new colony when nothing was saved", () => {
      const boot = bootstrapColony(new MemoryStorage());

      expect(boot.colony).toEqual(createInitialState());
      expect(boot.paused).toBe(false);
      expect(boot.notice).toBeNull();
      expect(boot.dayElapsedMs).toBe(0);
    });

    it("restores day, resources and dwarves after a refresh", () => {
      const storage = new MemoryStorage();
      const colony = createInitialState();
      colony.day = 31;
      colony.resources = { wood: 5, stone: 6, food: 7, tools: 2, weapons: 3 };
      saveSnapshot(makeSnapshot({ colony }), storage);

      const boot = bootstrapColony(storage);

      expect(boot.colony.day).toBe(31);
      expect(boot.colony.resources).toEqual(colony.resources);
      expect(boot.colony.dwarves).toEqual(colony.dwarves);
    });

    it("restores assignments, equipped tools and specialties", () => {
      const storage = new MemoryStorage();
      const snapshot = withDwarf({ assignment: "farming", hasTool: true });
      saveSnapshot(snapshot, storage);

      const dwarf = dwarfOf(bootstrapColony(storage).colony, "dwarf-1");

      expect(dwarf).toMatchObject({
        assignment: "farming",
        hasTool: true,
        specialty: "mining",
      });
    });

    it("restores resting and idle workers", () => {
      const storage = new MemoryStorage();
      saveSnapshot(withDwarf({ status: "resting" }), storage);

      expect(dwarfOf(bootstrapColony(storage).colony, "dwarf-1").status).toBe(
        "resting",
      );
    });

    it("restores the elapsed part of the current day", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot({ dayElapsedMs: 5_000 }), storage);

      expect(bootstrapColony(storage).dayElapsedMs).toBe(5_000);
    });

    it("treats a missing elapsed time as the beginning of the day", () => {
      const storage = new MemoryStorage();
      const data = raw();
      delete data.dayElapsedMs;
      seed(storage, [data]);

      expect(bootstrapColony(storage).dayElapsedMs).toBe(0);
    });

    it("restores the chronicle (restore message comes first)", () => {
      const storage = new MemoryStorage();
      const colony = createInitialState();
      colony.log = [
        { id: "log-1", day: 12, message: "Old entry", tone: "good" },
      ];
      colony.logSeq = 1;
      saveSnapshot(makeSnapshot({ colony }), storage);

      const log = bootstrapColony(storage).colony.log;

      expect(log.some((entry) => entry.message === "Old entry")).toBe(true);
      expect(log[0].message).toContain("restored");
    });

    it("does not alter the stored colony when loading", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot(), storage);
      const before = storage.getItem(SAVE_KEY);

      bootstrapColony(storage);

      expect(storage.getItem(SAVE_KEY)).toBe(before);
    });

    it("is stable over repeated refreshes", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot(), storage);

      const first = bootstrapColony(storage).colony.resources;
      const second = bootstrapColony(storage).colony.resources;

      expect(second).toEqual(first);
    });
  });

  describe("snapshot history", () => {
    it("loads the newest snapshot first", () => {
      const storage = new MemoryStorage();
      const older = createInitialState();
      older.day = 20;
      const newer = createInitialState();
      newer.day = 21;
      saveSnapshot(makeSnapshot({ colony: older }), storage);
      saveSnapshot(makeSnapshot({ colony: newer }), storage);

      const result = loadSnapshot(storage);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.snapshot.colony.day).toBe(21);
        expect(result.skipped).toBe(0);
      }
    });

    it("keeps at most MAX_SAVES snapshots", () => {
      const storage = new MemoryStorage();
      for (let day = 1; day <= MAX_SAVES + 4; day += 1) {
        const colony = createInitialState();
        colony.day = day;
        saveSnapshot(makeSnapshot({ colony }), storage);
      }
      const ring = JSON.parse(storage.getItem(SAVE_KEY)!);

      expect(ring).toHaveLength(MAX_SAVES);
      expect(ring[0].colony.day).toBe(MAX_SAVES + 4);
    });

    it("does not store an identical snapshot twice", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot({ savedAt: 1 }), storage);
      saveSnapshot(makeSnapshot({ savedAt: 2 }), storage);

      expect(JSON.parse(storage.getItem(SAVE_KEY)!)).toHaveLength(1);
    });

    it("refreshes the newest snapshot in place with replaceHead", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot({ dayElapsedMs: 1_000 }), storage);
      saveSnapshot(
        makeSnapshot({ dayElapsedMs: 2_000 }),
        storage,
        "replaceHead",
      );
      const ring = JSON.parse(storage.getItem(SAVE_KEY)!);

      expect(ring).toHaveLength(1);
      expect(ring[0].dayElapsedMs).toBe(2_000);
    });

    it("does not push older snapshots out with replaceHead", () => {
      const storage = new MemoryStorage();
      for (let day = 1; day <= MAX_SAVES; day += 1) {
        const colony = createInitialState();
        colony.day = day;
        saveSnapshot(makeSnapshot({ colony }), storage);
      }
      for (let ms = 1_000; ms < 4_000; ms += 1_000) {
        const colony = createInitialState();
        colony.day = MAX_SAVES;
        saveSnapshot(
          makeSnapshot({ colony, dayElapsedMs: ms }),
          storage,
          "replaceHead",
        );
      }
      const ring = JSON.parse(storage.getItem(SAVE_KEY)!);

      expect(ring).toHaveLength(MAX_SAVES);
      expect(ring.at(-1).colony.day).toBe(1);
    });

    it("reports a successful save", () => {
      expect(saveSnapshot(makeSnapshot(), new MemoryStorage())).toBe(true);
    });

    it("replaces an unreadable history by the next save", () => {
      const storage = new MemoryStorage();
      seed(storage, "{{not json");

      expect(saveSnapshot(makeSnapshot(), storage)).toBe(true);
      expect(loadSnapshot(storage).status).toBe("ok");
    });

    it("clears the whole save", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot(), storage);
      clearColonySave(storage);

      expect(storage.getItem(SAVE_KEY)).toBeNull();
      expect(loadSnapshot(storage)).toEqual({ status: "empty" });
    });

    it("clearing an empty storage does not fail", () => {
      expect(() => clearColonySave(new MemoryStorage())).not.toThrow();
    });
  });

  describe("corrupt and incompatible data", () => {
    it("reports an empty storage as empty", () => {
      expect(loadSnapshot(new MemoryStorage())).toEqual({ status: "empty" });
    });

    it.each([
      ["unparsable JSON", "{{{"],
      ["an empty string", ""],
      ["a plain string", '"hello"'],
      ["a number", "42"],
      ["null", "null"],
      ["an object instead of a list", '{"version":1}'],
      ["an empty list", "[]"],
      ["a list of garbage", "[1,2,3]"],
      ["a list of nulls", "[null,null]"],
    ])("falls back as corrupt for %s", (_label, content) => {
      const storage = new MemoryStorage();
      seed(storage, content);

      expect(loadSnapshot(storage)).toEqual({
        status: "fallback",
        reason: "corrupt",
      });
    });

    it("reports another save version as incompatible", () => {
      const storage = new MemoryStorage();
      seed(storage, [{ ...raw(), version: SAVE_VERSION + 1 }]);

      expect(loadSnapshot(storage)).toEqual({
        status: "fallback",
        reason: "incompatible",
      });
    });

    it("reports an old save version as incompatible", () => {
      const storage = new MemoryStorage();
      seed(storage, [{ ...raw(), version: 0 }]);

      expect(loadSnapshot(storage)).toEqual({
        status: "fallback",
        reason: "incompatible",
      });
    });

    it.each([
      ["a string", "1"],
      ["null", null],
      ["undefined", undefined],
    ])("reports a version that is %s as corrupt", (_label, version) => {
      const result = validateSnapshot({ ...raw(), version });

      expect(result).toEqual({ ok: false, reason: "corrupt" });
    });

    it("falls back to the older valid snapshot when the newest is damaged", () => {
      const storage = new MemoryStorage();
      const older = makeSnapshot();
      older.colony.day = 40;
      seed(storage, [{ nonsense: true }, raw(older)]);

      const result = loadSnapshot(storage);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.skipped).toBe(1);
        expect(result.snapshot.colony.day).toBe(40);
      }
    });

    it("reports the problem of the newest snapshot when nothing is valid", () => {
      const storage = new MemoryStorage();
      seed(storage, [{ ...raw(), version: 99 }, { nonsense: true }]);

      expect(loadSnapshot(storage)).toEqual({
        status: "fallback",
        reason: "incompatible",
      });
    });

    it("bootstraps a fresh paused colony with a notice when the save is corrupt", () => {
      const storage = new MemoryStorage();
      seed(storage, "{{{");
      const boot = bootstrapColony(storage);

      expect(boot.colony).toEqual(createInitialState());
      expect(boot.paused).toBe(true);
      expect(boot.notice?.header).toBe("Saved hold lost");
      expect(boot.notice?.subHeader).toContain("damaged");
      expect(boot.pendingExpeditions).toEqual({});
    });

    it("explains an incompatible save differently from a damaged one", () => {
      const storage = new MemoryStorage();
      seed(storage, [{ ...raw(), version: 99 }]);
      const boot = bootstrapColony(storage);

      expect(boot.colony).toEqual(createInitialState());
      expect(boot.notice?.subHeader).toContain("another version");
    });

    it("never throws for arbitrary garbage input", () => {
      for (const value of [
        undefined,
        null,
        0,
        "x",
        [],
        {},
        [[]],
        { version: SAVE_VERSION },
      ]) {
        expect(() => validateSnapshot(value)).not.toThrow();
        expect(validateSnapshot(value).ok).toBe(false);
      }
    });
  });

  describe("field validation", () => {
    it("accepts a valid snapshot", () => {
      expect(validateSnapshot(raw()).ok).toBe(true);
    });

    it.each(["wood", "stone", "food", "tools", "weapons"])(
      "rejects a negative %s value",
      (key) => {
        const data = raw();
        data.colony.resources[key] = -1;

        expect(validateSnapshot(data).ok).toBe(false);
      },
    );

    it.each(["wood", "stone", "food", "tools", "weapons"])(
      "rejects a missing %s value",
      (key) => {
        const data = raw();
        delete data.colony.resources[key];

        expect(validateSnapshot(data).ok).toBe(false);
      },
    );

    it("rejects fractional resources", () => {
      const data = raw();
      data.colony.resources.wood = 1.5;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects non-numeric resources", () => {
      const data = raw();
      data.colony.resources.stone = "9";

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects NaN and infinite resources (serialised as null)", () => {
      const data = JSON.parse(
        JSON.stringify({
          ...raw(),
          colony: {
            ...raw().colony,
            resources: {
              wood: NaN,
              stone: Infinity,
              food: 1,
              tools: 1,
              weapons: 0,
            },
          },
        }),
      );

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects a negative or fractional day", () => {
      const negative = raw();
      negative.colony.day = -3;
      const fractional = raw();
      fractional.colony.day = 2.5;

      expect(validateSnapshot(negative).ok).toBe(false);
      expect(validateSnapshot(fractional).ok).toBe(false);
    });

    it("rejects a missing colony", () => {
      const data = raw();
      delete data.colony;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects an empty company", () => {
      const data = raw();
      data.colony.dwarves = [];

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects dwarves that are not a list", () => {
      const data = raw();
      data.colony.dwarves = { a: 1 };

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects an unknown status", () => {
      const data = raw();
      data.colony.dwarves[0].status = "dancing";

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects the retired generic forging status", () => {
      const data = raw();
      data.colony.dwarves[0].status = "forging";

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it.each([
      "idle",
      "working",
      "expedition",
      "resting",
      "forging_Tool",
      "forging_Weapon",
    ])("accepts the known status %s", (status) => {
      const data = raw();
      data.colony.dwarves[0].status = status;
      // an expedition needs its request, otherwise it is reconciled as lost
      if (status === "expedition") {
        data.pendingExpeditions = {
          "dwarf-1": { destination: "old-mine", requestId: "r", seconds: 2 },
        };
      }

      expect(validateSnapshot(data).ok).toBe(true);
    });

    it("rejects an unknown job", () => {
      const data = raw();
      data.colony.dwarves[0].assignment = "fishing";

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects an unknown specialty", () => {
      const data = raw();
      data.colony.dwarves[0].specialty = "fishing";

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("accepts a dwarf without a specialty", () => {
      const data = raw();
      delete data.colony.dwarves[0].specialty;

      expect(validateSnapshot(data).ok).toBe(true);
    });

    it.each(["id", "name", "title", "icon"])(
      "rejects a dwarf with a non-string %s",
      (key) => {
        const data = raw();
        data.colony.dwarves[0][key] = 5;

        expect(validateSnapshot(data).ok).toBe(false);
      },
    );

    it("rejects a dwarf with a non-boolean hasTool", () => {
      const data = raw();
      data.colony.dwarves[0].hasTool = "yes";

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects a dwarf with a missing hasTool flag", () => {
      const data = raw();
      delete data.colony.dwarves[0].hasTool;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects a negative countdown", () => {
      const data = raw();
      data.colony.dwarves[0].countdown = -2;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects duplicate dwarf ids", () => {
      const data = raw();
      data.colony.dwarves[1].id = data.colony.dwarves[0].id;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects a dwarf entry that is not an object", () => {
      const data = raw();
      data.colony.dwarves.push(null);

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects chronicle entries with wrong types", () => {
      const data = raw();
      data.colony.log = [{ id: 1, day: "x", message: 7 }];

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects chronicle entries with an unknown tone", () => {
      const data = raw();
      data.colony.log = [{ id: "log-1", day: 1, message: "x", tone: "angry" }];

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects a missing logSeq", () => {
      const data = raw();
      delete data.colony.logSeq;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("limits an oversized chronicle", () => {
      const data = raw();
      data.colony.log = Array.from({ length: 50 }, (_, i) => ({
        id: `log-${i}`,
        day: 1,
        message: "m",
      }));
      const result = validateSnapshot(data);

      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.snapshot.colony.log.length).toBeLessThanOrEqual(8);
    });

    it.each([
      ["negative", -1],
      ["equal to a full day", DAY_MS],
      ["beyond a day", DAY_MS * 3],
      ["a string", "5000"],
      ["NaN as null", null],
    ])("rejects an elapsed day time that is %s", (_label, value) => {
      const data = raw();
      data.dayElapsedMs = value;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("accepts the very beginning and the very end of a day", () => {
      const start = raw();
      start.dayElapsedMs = 0;
      const end = raw();
      end.dayElapsedMs = DAY_MS - 1;

      expect(validateSnapshot(start).ok).toBe(true);
      expect(validateSnapshot(end).ok).toBe(true);
    });

    it("rejects a missing savedAt", () => {
      const data = raw();
      delete data.savedAt;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it("rejects missing pending expeditions", () => {
      const data = raw();
      delete data.pendingExpeditions;

      expect(validateSnapshot(data).ok).toBe(false);
    });

    it.each([
      ["without requestId", { destination: "old-mine", seconds: 2 }],
      [
        "with an empty requestId",
        { destination: "old-mine", requestId: "", seconds: 2 },
      ],
      ["without destination", { requestId: "r", seconds: 2 }],
      [
        "with zero seconds",
        { destination: "old-mine", requestId: "r", seconds: 0 },
      ],
      [
        "with too many seconds",
        {
          destination: "old-mine",
          requestId: "r",
          seconds: EXPEDITION_SECONDS + 1,
        },
      ],
      [
        "with fractional seconds",
        { destination: "old-mine", requestId: "r", seconds: 1.5 },
      ],
      ["that is not an object", "oops"],
    ])("rejects a pending expedition %s", (_label, entry) => {
      const data = raw();
      data.pendingExpeditions = { "dwarf-1": entry };

      expect(validateSnapshot(data).ok).toBe(false);
    });
  });

  describe("tasks interrupted by a refresh", () => {
    const forgingSnapshot = (
      status: "forging_Tool" | "forging_Weapon",
      countdown?: number,
    ) =>
      withDwarf({
        status,
        ...(countdown === undefined ? {} : { countdown }),
      });

    const restored = (snapshot: Snapshot) => {
      const result = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
      if (!result.ok) throw new Error("expected a valid snapshot");
      return result.snapshot;
    };

    it("keeps the remaining forging time of a tool", () => {
      const snapshot = restored(forgingSnapshot("forging_Tool", 2));

      expect(dwarfOf(snapshot.colony, "dwarf-1").countdown).toBe(2);
    });

    it("keeps the remaining forging time of a weapon", () => {
      const snapshot = restored(forgingSnapshot("forging_Weapon", 4));

      expect(dwarfOf(snapshot.colony, "dwarf-1").countdown).toBe(4);
    });

    it("restarts a tool without a saved countdown with its full duration", () => {
      const snapshot = restored(forgingSnapshot("forging_Tool"));

      expect(dwarfOf(snapshot.colony, "dwarf-1")).toMatchObject({
        status: "forging_Tool",
        countdown: FORGE_TOOL_SECONDS,
      });
    });

    it("restarts a weapon without a saved countdown with its full duration", () => {
      const snapshot = restored(forgingSnapshot("forging_Weapon"));

      expect(dwarfOf(snapshot.colony, "dwarf-1")).toMatchObject({
        status: "forging_Weapon",
        countdown: FORGE_WEAPON_SECONDS,
      });
    });

    it("keeps the paid materials of an interrupted forge (no refund, no loss)", () => {
      const snapshot = forgingSnapshot("forging_Tool", 3);
      snapshot.colony.resources.wood = 0;
      const result = restored(snapshot);

      expect(result.colony.resources.wood).toBe(0);
      expect(result.colony.resources.tools).toBe(
        snapshot.colony.resources.tools,
      );
    });

    it("keeps an expedition with a pending request and its remaining time", () => {
      const snapshot = withDwarf({ status: "expedition", countdown: 3 });
      snapshot.pendingExpeditions = {
        "dwarf-1": { destination: "old-mine", requestId: "req-1", seconds: 3 },
      };
      const result = restored(snapshot);

      expect(dwarfOf(result.colony, "dwarf-1").status).toBe("expedition");
      expect(dwarfOf(result.colony, "dwarf-1").countdown).toBe(3);
      expect(result.pendingExpeditions["dwarf-1"]).toMatchObject({
        destination: "old-mine",
        requestId: "req-1",
        seconds: 3,
      });
    });

    it("keeps the requestId so the server can answer a repeated request once", () => {
      const snapshot = withDwarf({ status: "expedition", countdown: 2 });
      snapshot.pendingExpeditions = {
        "dwarf-1": {
          destination: "crystal-cave",
          requestId: "req-keep",
          seconds: 2,
        },
      };

      expect(restored(snapshot).pendingExpeditions["dwarf-1"].requestId).toBe(
        "req-keep",
      );
    });

    it("declares an expedition without a request as lost and frees the dwarf", () => {
      const snapshot = withDwarf({ status: "expedition", countdown: 3 });
      const result = restored(snapshot);

      expect(dwarfOf(result.colony, "dwarf-1").status).not.toBe("expedition");
      expect(result.pendingExpeditions).toEqual({});
      expect(result.colony.log[0].tone).toBe("warning");
      expect(result.colony.log[0].message).toContain("lost");
    });

    it("awards no resources for a lost expedition", () => {
      const snapshot = withDwarf({ status: "expedition" });
      const result = restored(snapshot);

      expect(result.colony.resources).toEqual(snapshot.colony.resources);
    });

    it("drops pending requests of dwarves that are no longer travelling", () => {
      const snapshot = makeSnapshot();
      snapshot.pendingExpeditions = {
        "dwarf-1": { destination: "old-mine", requestId: "stale", seconds: 2 },
      };

      expect(restored(snapshot).pendingExpeditions).toEqual({});
    });

    it("does not touch uninterrupted workers", () => {
      const snapshot = withDwarf({ status: "forging_Tool", countdown: 2 });
      const result = restored(snapshot);

      expect(dwarfOf(result.colony, "dwarf-2")).toEqual(
        dwarfOf(snapshot.colony, "dwarf-2"),
      );
    });

    it("explains an interrupted forging task in the chronicle", () => {
      const storage = new MemoryStorage();
      saveSnapshot(
        withDwarf({ status: "forging_Tool", countdown: 2, name: "Yrsa" }),
        storage,
      );
      const messages = bootstrapColony(storage).colony.log.map(
        (entry) => entry.message,
      );

      expect(
        messages.some(
          (m) => m.includes("Yrsa") && m.includes("forging continues"),
        ),
      ).toBe(true);
    });

    it("explains an interrupted expedition in the chronicle", () => {
      const storage = new MemoryStorage();
      const snapshot = withDwarf({
        status: "expedition",
        countdown: 2,
        name: "Yrsa",
      });
      snapshot.pendingExpeditions = {
        "dwarf-1": { destination: "old-mine", requestId: "r", seconds: 2 },
      };
      saveSnapshot(snapshot, storage);
      const messages = bootstrapColony(storage).colony.log.map(
        (entry) => entry.message,
      );

      expect(
        messages.some(
          (m) => m.includes("Yrsa") && m.includes("expedition continues"),
        ),
      ).toBe(true);
    });

    it("explains a lost expedition in the chronicle", () => {
      const storage = new MemoryStorage();
      saveSnapshot(
        withDwarf({ status: "expedition", countdown: 2, name: "Yrsa" }),
        storage,
      );
      const messages = bootstrapColony(storage).colony.log.map(
        (entry) => entry.message,
      );

      expect(
        messages.some((m) => m.includes("Yrsa") && m.includes("lost")),
      ).toBe(true);
    });

    it("exposes pending expeditions and their countdown for the timer", () => {
      const storage = new MemoryStorage();
      const snapshot = withDwarf({ status: "expedition", countdown: 4 });
      snapshot.pendingExpeditions = {
        "dwarf-1": { destination: "old-mine", requestId: "r", seconds: 4 },
      };
      saveSnapshot(snapshot, storage);
      const boot = bootstrapColony(storage);

      expect(boot.expeditionCountdowns).toEqual({ "dwarf-1": 4 });
      expect(Object.keys(boot.pendingExpeditions)).toEqual(["dwarf-1"]);
    });
  });

  describe("visible restore behaviour", () => {
    it("pauses the hold after restoring so the player can look around first", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot(), storage);

      expect(bootstrapColony(storage).paused).toBe(true);
    });

    it("shows a notice for the latest save", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot(), storage);
      const boot = bootstrapColony(storage);

      expect(boot.notice?.header).toBe("Latest save restored");
      expect(boot.notice?.subHeader).toContain("No progress was lost");
    });

    it("warns about lost progress when an older save is used", () => {
      const storage = new MemoryStorage();
      seed(storage, [{ nonsense: true }, raw()]);
      const boot = bootstrapColony(storage);

      expect(boot.notice?.header).toBe("Older save restored");
      expect(boot.notice?.subHeader).toContain("Some progress was lost");
      expect(boot.colony.log[0].tone).toBe("warning");
    });

    it("writes the restored day into the chronicle", () => {
      const storage = new MemoryStorage();
      const colony = createInitialState();
      colony.day = 77;
      saveSnapshot(makeSnapshot({ colony }), storage);

      expect(bootstrapColony(storage).colony.log[0].message).toContain("77");
    });

    it("renders the restore notice as a visible popup", () => {
      const storage = new MemoryStorage();
      saveSnapshot(makeSnapshot(), storage);
      const notice = bootstrapColony(storage).notice;
      if (!notice) throw new Error("expected a notice");
      const props = {
        ...notice,
        onClose: () => null,
      } as ComponentProps<typeof Popup>;
      const html = renderToStaticMarkup(createElement(Popup, props));

      expect(html).toContain("Latest save restored");
      expect(html).toContain("Close");
    });

    it("renders the fallback notice as a visible popup", () => {
      const storage = new MemoryStorage();
      seed(storage, "{{{");
      const notice = bootstrapColony(storage).notice;
      if (!notice) throw new Error("expected a notice");
      const html = renderToStaticMarkup(createElement(Popup, notice));

      expect(html).toContain("Saved hold lost");
      expect(html).toContain("new hold was founded");
    });
  });

  describe("storage failures", () => {
    it("treats unreadable storage as empty when loading", () => {
      expect(loadSnapshot(brokenStorage())).toEqual({ status: "empty" });
    });

    it("starts a fresh colony when storage is unreadable", () => {
      const boot = bootstrapColony(brokenStorage());

      expect(boot.colony).toEqual(createInitialState());
    });

    it("reports a failed save instead of throwing", () => {
      expect(saveSnapshot(makeSnapshot(), brokenStorage())).toBe(false);
    });

    it("does not throw when clearing unavailable storage", () => {
      expect(() => clearColonySave(brokenStorage())).not.toThrow();
    });
  });
});
