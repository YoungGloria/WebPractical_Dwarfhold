import { describe, expect, it } from "vitest";
import { createInitialState } from "./initialState";
import {
  bootstrapColony,
  clearColonySave,
  loadSnapshot,
  MAX_SAVES,
  SAVE_KEY,
  SAVE_VERSION,
  saveSnapshot,
  type Snapshot,
  type StorageLike,
} from "./persistence";
import { FORGE_SECONDS } from "./simulation";
import type { ColonyState } from "./types";

function fakeStorage(
  initial?: string,
): StorageLike & { raw: () => string | null } {
  let value: string | null = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      value = null;
    },
    raw: () => value,
  };
}

function snapshotOf(
  colony: ColonyState,
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    version: SAVE_VERSION,
    savedAt: 1,
    colony,
    craftCountdowns: {},
    pendingExpeditions: {},
    ...extra,
  };
}

const onDay = (day: number): ColonyState => ({ ...createInitialState(), day });

const withStatus = (
  status: "forging" | "expedition",
  id = "dwarf-1",
): ColonyState => {
  const state = createInitialState();
  return {
    ...state,
    dwarves: state.dwarves.map((d) => (d.id === id ? { ...d, status } : d)),
  };
};

describe("D5 persistence", () => {
  it("starts a new hold when nothing is saved", () => {
    const boot = bootstrapColony(fakeStorage());
    expect(boot.paused).toBe(false);
    expect(boot.notice).toBeNull();
    expect(boot.colony.day).toBe(createInitialState().day);
  });

  it("restores the colony after a roundtrip (paused, no popup)", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(onDay(20)), storage);
    const boot = bootstrapColony(storage);
    expect(boot.colony.day).toBe(20);
    expect(boot.paused).toBe(true);
    expect(boot.notice).toBeNull();
    expect(boot.colony.log[0]?.message).toContain("restored");
  });

  it("keeps at most 5 snapshots, newest first", () => {
    const storage = fakeStorage();
    for (let day = 1; day <= 7; day += 1) {
      saveSnapshot(snapshotOf(onDay(day)), storage);
    }
    const ring = JSON.parse(storage.raw() ?? "[]") as Snapshot[];
    expect(ring).toHaveLength(MAX_SAVES);
    expect(ring.map((s) => s.colony.day)).toEqual([7, 6, 5, 4, 3]);
  });

  it("replaceHead updates the newest snapshot without growing the ring", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(onDay(1)), storage);
    saveSnapshot(
      snapshotOf(onDay(2), { craftCountdowns: { "dwarf-1": 4 } }),
      storage,
    );
    saveSnapshot(
      snapshotOf(onDay(2), { craftCountdowns: { "dwarf-1": 3 } }),
      storage,
      "replaceHead",
    );
    const ring = JSON.parse(storage.raw() ?? "[]") as Snapshot[];
    expect(ring.map((s) => s.colony.day)).toEqual([2, 1]);
    expect(ring[0]?.craftCountdowns).toEqual({ "dwarf-1": 3 });
  });

  it("replaceHead on an empty ring behaves like a push", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(onDay(1)), storage, "replaceHead");
    expect(JSON.parse(storage.raw() ?? "[]")).toHaveLength(1);
  });

  it("does not store an identical snapshot twice", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(onDay(5), { savedAt: 1 }), storage);
    saveSnapshot(snapshotOf(onDay(5), { savedAt: 99 }), storage);
    expect(JSON.parse(storage.raw() ?? "[]")).toHaveLength(1);
  });

  it("falls back to the next older valid snapshot and tells the player", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(onDay(10)), storage);
    saveSnapshot(snapshotOf(onDay(11)), storage);
    const ring = JSON.parse(storage.raw() ?? "[]") as unknown[];
    ring[0] = { ...(ring[0] as object), colony: "broken" };
    storage.setItem(SAVE_KEY, JSON.stringify(ring));

    const boot = bootstrapColony(storage);
    expect(boot.colony.day).toBe(10);
    expect(boot.notice?.header).toBe("Older save restored");
  });

  it("falls back to the initial state when every snapshot is invalid", () => {
    const storage = fakeStorage(JSON.stringify([{ nope: 1 }, 42, null]));
    expect(loadSnapshot(storage)).toEqual({
      status: "fallback",
      reason: "corrupt",
    });
    const boot = bootstrapColony(storage);
    expect(boot.colony.day).toBe(createInitialState().day);
    expect(boot.paused).toBe(true);
    expect(boot.notice?.header).toBe("Saved hold lost");
  });

  it("treats broken JSON as corrupt", () => {
    expect(loadSnapshot(fakeStorage("{not json"))).toEqual({
      status: "fallback",
      reason: "corrupt",
    });
  });

  it("reports another save version as incompatible", () => {
    const storage = fakeStorage(
      JSON.stringify([{ ...snapshotOf(onDay(3)), version: 99 }]),
    );
    expect(loadSnapshot(storage)).toEqual({
      status: "fallback",
      reason: "incompatible",
    });
  });

  it.each([
    [
      "negative resource",
      { resources: { wood: -1, stone: 0, food: 0, tools: 0 } },
    ],
    [
      "NaN-like resource",
      { resources: { wood: "3", stone: 0, food: 0, tools: 0 } },
    ],
    [
      "unknown status",
      { dwarves: [{ ...createInitialState().dwarves[0], status: "flying" }] },
    ],
    ["no dwarves", { dwarves: [] }],
  ])("rejects a snapshot with %s", (_name, patch) => {
    const storage = fakeStorage(
      JSON.stringify([
        snapshotOf({ ...createInitialState(), ...patch } as ColonyState),
      ]),
    );
    expect(loadSnapshot(storage).status).toBe("fallback");
  });

  it("restores forging with its countdown", () => {
    const storage = fakeStorage();
    saveSnapshot(
      snapshotOf(withStatus("forging"), { craftCountdowns: { "dwarf-1": 3 } }),
      storage,
    );
    const boot = bootstrapColony(storage);
    expect(boot.craftCountdowns).toEqual({ "dwarf-1": 3 });
    expect(boot.paused).toBe(true);
  });

  it("gives a forging dwarf without countdown the full duration", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(withStatus("forging")), storage);
    expect(bootstrapColony(storage).craftCountdowns).toEqual({
      "dwarf-1": FORGE_SECONDS,
    });
  });

  it("keeps the request of a travelling dwarf for a retry", () => {
    const storage = fakeStorage();
    const request = {
      destination: "crystal-cave",
      requestId: "req-1",
      seconds: 5,
    };
    saveSnapshot(
      snapshotOf(withStatus("expedition", "dwarf-2"), {
        pendingExpeditions: { "dwarf-2": request },
      }),
      storage,
    );
    const boot = bootstrapColony(storage);
    expect(boot.pendingExpeditions).toEqual({ "dwarf-2": request });
    expect(boot.expeditionCountdowns).toEqual({ "dwarf-2": 5 });
    expect(boot.colony.dwarves.find((d) => d.id === "dwarf-2")?.status).toBe(
      "expedition",
    );
  });

  it("never leaves a dwarf away without a request", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(withStatus("expedition", "dwarf-2")), storage);
    const boot = bootstrapColony(storage);
    expect(boot.colony.dwarves.find((d) => d.id === "dwarf-2")?.status).toBe(
      "resting",
    );
    expect(boot.pendingExpeditions).toEqual({});
  });

  it("does not crash when storage throws", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(saveSnapshot(snapshotOf(onDay(1)), broken)).toBe(false);
    expect(loadSnapshot(broken)).toEqual({ status: "empty" });
    expect(() => clearColonySave(broken)).not.toThrow();
  });

  it("clearColonySave removes the ring", () => {
    const storage = fakeStorage();
    saveSnapshot(snapshotOf(onDay(1)), storage);
    clearColonySave(storage);
    expect(loadSnapshot(storage)).toEqual({ status: "empty" });
  });
});
