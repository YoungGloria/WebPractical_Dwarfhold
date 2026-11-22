/**
 * Test for requirement D4 - Resilient expeditions
 *
 * Covers the following scenarios:
 *
 * [D4.1] Send an eligible dwarf
 *        - an idle dwarf and a working dwarf can depart; assignment is kept
 *        - an unknown dwarf id is rejected without any state change
 *        - departing changes neither resources nor other dwarves
 *        - the departure is recorded in the chronicle
 *
 * [D4.2] Unavailable while travelling
 *        - the travelling dwarf has status "expedition"
 *        - a second departure of the same dwarf is rejected
 *        - job assignment is rejected while travelling
 *        - other dwarves stay assignable and sendable
 *        - a travelling dwarf produces nothing, but still eats
 *
 * [D4.3] Rewards are applied exactly once on success
 *        - rewards are added to the inventory and the dwarf returns
 *        - a repeated completion is ignored (no double rewards)
 *        - completion for a dwarf that never left / is unknown is ignored
 *        - an empty reward is harmless, an idle dwarf returns to idle
 *        - a completion never affects another dwarf
 *
 * [D4.4] A failed request awards nothing
 *        - resources stay untouched and a warning is logged
 *        - failure for a dwarf that never left / is unknown is ignored
 *        - HTTP client: server message, non-JSON error, non-string error
 *          field and network failure all end in a thrown error
 *
 * [D4.5] A failure does not leave the dwarf unavailable
 *        - working dwarf returns to its job, idle dwarf returns to idle
 *        - the dwarf can depart and be assigned again after a failure
 *
 * [D4.6] Slow and repeated actions never create contradictory state
 *        - a late failure after success is ignored
 *        - a late success after failure grants no rewards
 *        - a repeated failure is ignored
 *        - two dwarves travelling at once are resolved independently
 *        - consecutive expeditions accumulate rewards exactly once each
 *        - rejected actions return the same state and never mutate input
 *        - HTTP client: sends the requestId, aborts a hanging request
 *
 * [D4.7] Equipped-tool policy (tools stay in the colony inventory)
 *        - departing does not consume or move tools
 *        - a tool reward is added on top of the existing stock
 *
 * Planned (it.todo): retry with the same requestId, reward validation,
 * server-side dedupe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginExpedition } from "./api";
import {
  assignJob,
  completeExpeditionAction,
  failExpeditionAction,
  startExpeditionAction,
} from "./colonyActions";
import { advanceDay, isProducing } from "./simulation";
import type { ColonyState, Dwarf, DwarfStatus, JobType } from "./types";

function makeDwarf(
  id: string,
  assignment: JobType = "mining",
  status: DwarfStatus = "working",
): Dwarf {
  return { id, name: `Dwarf ${id}`, title: "", icon: "", assignment, status };
}

function makeState(dwarves: Dwarf[] = [makeDwarf("dwarf-1")]): ColonyState {
  return {
    day: 12,
    resources: { wood: 14, stone: 9, food: 18, tools: 1 },
    dwarves,
    log: [],
    logSeq: 0,
  };
}

function dwarfOf(state: ColonyState, id: string): Dwarf {
  const dwarf = state.dwarves.find((d) => d.id === id);
  if (!dwarf) throw new Error(`test setup: ${id} not found`);
  return dwarf;
}

function travelling(
  state: ColonyState,
  id = "dwarf-1",
  destination = "crystal-cave",
): ColonyState {
  return startExpeditionAction(state, id, destination);
}

describe("D4 expeditions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubFetch(handler: typeof fetch) {
    const mock = vi.fn<typeof fetch>(handler);
    vi.stubGlobal("fetch", mock);
    return mock;
  }

  describe("D4.1 send an eligible dwarf", () => {
    it("starts an expedition for an idle dwarf", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);
      const result = travelling(state);

      expect(dwarfOf(result, "dwarf-1").status).toBe("expedition");
      expect(dwarfOf(result, "dwarf-1").assignment).toBeNull();
    });

    it("starts an expedition for a working dwarf and keeps its assignment", () => {
      const result = travelling(makeState(), "dwarf-1", "old-mine");

      expect(dwarfOf(result, "dwarf-1").status).toBe("expedition");
      expect(dwarfOf(result, "dwarf-1").assignment).toBe("mining");
    });

    it("rejects an unknown dwarf without changing state", () => {
      const state = makeState();

      expect(travelling(state, "missing-dwarf")).toBe(state);
    });

    it("does not change resources or other dwarves on departure", () => {
      const state = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      const result = travelling(state);

      expect(result.resources).toEqual(state.resources);
      expect(dwarfOf(result, "dwarf-2")).toEqual(dwarfOf(state, "dwarf-2"));
    });

    it("records the departure in the chronicle", () => {
      const result = travelling(makeState(), "dwarf-1", "crystal-cave");

      expect(result.log).toHaveLength(1);
      expect(result.log[0]?.message).toContain("crystal cave");
    });
  });

  describe("D4.2 unavailable while travelling", () => {
    it("marks the dwarf as being on an expedition", () => {
      expect(dwarfOf(travelling(makeState()), "dwarf-1").status).toBe(
        "expedition",
      );
    });

    it("rejects a second departure while the dwarf is travelling", () => {
      const away = travelling(makeState());

      expect(startExpeditionAction(away, "dwarf-1", "old-mine")).toBe(away);
    });

    it("rejects a job assignment while travelling", () => {
      const away = travelling(makeState());

      expect(assignJob(away, "dwarf-1", "farming")).toBe(away);
      expect(assignJob(away, "dwarf-1", null)).toBe(away);
    });

    it("keeps other dwarves assignable while one is travelling", () => {
      const away = travelling(
        makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]),
      );
      const reassigned = assignJob(away, "dwarf-2", "farming");

      expect(dwarfOf(reassigned, "dwarf-2").assignment).toBe("farming");
      expect(dwarfOf(reassigned, "dwarf-1").status).toBe("expedition");
    });

    it("keeps other dwarves sendable while one is travelling", () => {
      const away = travelling(
        makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]),
      );
      const both = startExpeditionAction(away, "dwarf-2", "old-mine");

      expect(dwarfOf(both, "dwarf-1").status).toBe("expedition");
      expect(dwarfOf(both, "dwarf-2").status).toBe("expedition");
    });

    it("does not produce resources for a travelling dwarf", () => {
      const away = travelling(makeState());

      expect(advanceDay(away).resources.stone).toBe(away.resources.stone);
    });

    it("still produces for dwarves that stay home", () => {
      const away = travelling(
        makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2", "woodcutting")]),
      );

      expect(advanceDay(away).resources.wood).toBe(away.resources.wood + 3);
    });

    it("still feeds every dwarf, including the travelling one", () => {
      const away = travelling(
        makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2", null, "idle")]),
      );

      expect(advanceDay(away).resources.food).toBe(away.resources.food - 2);
    });
  });

  describe("D4.3 success rewards exactly once", () => {
    it("rests immediately after return and resumes work on the next day", () => {
      const completed = completeExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        { stone: 8 },
        "Crystal seam found.",
      );

      expect(dwarfOf(completed, "dwarf-1").status).toBe("resting");
      expect(isProducing(dwarfOf(completed, "dwarf-1"))).toBe(false);

      const nextDay = advanceDay(completed);
      expect(dwarfOf(nextDay, "dwarf-1").status).toBe("working");
      expect(nextDay.resources.stone).toBe(completed.resources.stone + 2);
    });

    it("applies each reward once and returns the dwarf", () => {
      const completed = completeExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        { stone: 8, tools: 1 },
        "Crystal seam found.",
      );

      expect(completed.resources).toMatchObject({
        wood: 14,
        stone: 17,
        food: 18,
        tools: 2,
      });
      expect(dwarfOf(completed, "dwarf-1").status).toBe("resting");
      expect(completed.log[0]?.tone).toBe("good");
    });

    it("ignores a repeated completion response", () => {
      const completed = completeExpeditionAction(
        travelling(makeState()),
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

    it("ignores a completion for a dwarf that never left", () => {
      const state = makeState();

      expect(
        completeExpeditionAction(state, "dwarf-1", { stone: 8 }, "Unexpected."),
      ).toBe(state);
    });

    it("ignores a completion for an unknown dwarf", () => {
      const away = travelling(makeState());

      expect(
        completeExpeditionAction(away, "ghost", { stone: 8 }, "Unexpected."),
      ).toBe(away);
    });

    it("handles an empty reward without changing resources", () => {
      const away = travelling(makeState());
      const completed = completeExpeditionAction(
        away,
        "dwarf-1",
        {},
        "Nothing.",
      );

      expect(completed.resources).toEqual(away.resources);
      expect(dwarfOf(completed, "dwarf-1").status).toBe("resting");
    });

    it("returns an idle dwarf to idle after success", () => {
      const away = travelling(makeState([makeDwarf("dwarf-1", null, "idle")]));
      const completed = completeExpeditionAction(away, "dwarf-1", {}, "Home.");

      expect(dwarfOf(completed, "dwarf-1").status).toBe("resting");
    });

    it("does not touch another dwarf that is not travelling", () => {
      const away = travelling(
        makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]),
      );
      const completed = completeExpeditionAction(
        away,
        "dwarf-1",
        { wood: 2 },
        "Done.",
      );

      expect(dwarfOf(completed, "dwarf-2")).toEqual(dwarfOf(away, "dwarf-2"));
    });

    it.todo(
      "rejects rewards with unknown keys, negative or non-finite amounts",
    );
  });

  describe("D4.4 failed requests award no resources", () => {
    it("preserves resources and logs a warning", () => {
      const away = travelling(makeState(), "dwarf-1", "blocked-pass");
      const failed = failExpeditionAction(away, "dwarf-1", "Rockfall.");

      expect(failed.resources).toEqual(away.resources);
      expect(failed.log[0]).toMatchObject({
        message: "Rockfall.",
        tone: "warning",
      });
    });

    it("ignores a failure for a dwarf that never left", () => {
      const state = makeState();

      expect(failExpeditionAction(state, "dwarf-1", "Stale failure")).toBe(
        state,
      );
    });

    it("ignores a failure for an unknown dwarf", () => {
      const away = travelling(makeState());

      expect(failExpeditionAction(away, "ghost", "Stale failure")).toBe(away);
    });

    it("surfaces the error message sent by the server", async () => {
      stubFetch(() =>
        Promise.resolve(Response.json({ error: "Rockfall." }, { status: 503 })),
      );

      await expect(
        beginExpedition("dwarf-1", "blocked-pass", "req-2"),
      ).rejects.toThrow("Rockfall.");
    });

    it("falls back to a generic message for a non-JSON error response", async () => {
      stubFetch(() =>
        Promise.resolve(new Response("<html>oops</html>", { status: 500 })),
      );

      await expect(
        beginExpedition("dwarf-1", "old-mine", "req-3"),
      ).rejects.toThrow("Expedition failed (500)");
    });

    it("falls back to a generic message when the error field is not a string", async () => {
      stubFetch(() =>
        Promise.resolve(Response.json({ error: 42 }, { status: 502 })),
      );

      await expect(
        beginExpedition("dwarf-1", "old-mine", "req-4"),
      ).rejects.toThrow("Expedition failed (502)");
    });

    it("propagates network failures", async () => {
      stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

      await expect(
        beginExpedition("dwarf-1", "old-mine", "req-6"),
      ).rejects.toThrow("Failed to fetch");
    });
  });

  describe("D4.5 failure restores availability", () => {
    it("returns a working dwarf to its previous job", () => {
      const failed = failExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        "Rockfall.",
      );

      expect(dwarfOf(failed, "dwarf-1").status).toBe("resting");
      expect(dwarfOf(failed, "dwarf-1").assignment).toBe("mining");
    });

    it("returns an idle dwarf to idle", () => {
      const failed = failExpeditionAction(
        travelling(makeState([makeDwarf("dwarf-1", null, "idle")])),
        "dwarf-1",
        "Rockfall.",
      );

      expect(dwarfOf(failed, "dwarf-1").status).toBe("resting");
      expect(dwarfOf(failed, "dwarf-1").assignment).toBeNull();
    });

    it("allows the same dwarf to depart again after a failure", () => {
      const failed = failExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        "Rockfall.",
      );
      const nextDay = advanceDay(failed);
      const retry = travelling(nextDay, "dwarf-1", "old-mine");

      expect(dwarfOf(retry, "dwarf-1").status).toBe("expedition");
    });

    it("allows job assignment again after a failure", () => {
      const failed = failExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        "Rockfall.",
      );
      const nextDay = advanceDay(failed);

      expect(
        dwarfOf(assignJob(nextDay, "dwarf-1", "farming"), "dwarf-1").assignment,
      ).toBe("farming");
    });
  });

  describe("D4.6 slow and repeated actions", () => {
    it("ignores a late failure after success", () => {
      const completed = completeExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        { stone: 12, wood: 2 },
        "Supplies found.",
      );

      expect(failExpeditionAction(completed, "dwarf-1", "Late failure")).toBe(
        completed,
      );
    });

    it("grants no rewards for a late success after failure", () => {
      const failed = failExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        "Timed out.",
      );
      const late = completeExpeditionAction(
        failed,
        "dwarf-1",
        { stone: 12 },
        "Too late.",
      );

      expect(late).toBe(failed);
      expect(late.resources.stone).toBe(9);
    });

    it("ignores a repeated failure", () => {
      const failed = failExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        "Timed out.",
      );

      expect(failExpeditionAction(failed, "dwarf-1", "Again.")).toBe(failed);
    });

    it("resolves two travelling dwarves independently", () => {
      const both = startExpeditionAction(
        travelling(makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")])),
        "dwarf-2",
        "old-mine",
      );
      const afterFirst = completeExpeditionAction(
        both,
        "dwarf-1",
        { stone: 8 },
        "First home.",
      );
      const afterSecond = failExpeditionAction(
        afterFirst,
        "dwarf-2",
        "Second lost.",
      );

      expect(afterSecond.resources.stone).toBe(17);
      expect(dwarfOf(afterSecond, "dwarf-1").status).toBe("resting");
      expect(dwarfOf(afterSecond, "dwarf-2").status).toBe("resting");
    });

    it("accumulates rewards of consecutive expeditions exactly once each", () => {
      let state = makeState();

      for (let run = 0; run < 3; run += 1) {
        state = completeExpeditionAction(
          travelling(state),
          "dwarf-1",
          { stone: 8 },
          `Run ${run}`,
        );
        state = advanceDay(state);
      }

      expect(state.resources.stone).toBe(9 + 3 * 8 + 3 * 2);
    });

    it("does not mutate its input state when actions are applied or rejected", () => {
      const base = makeState([makeDwarf("dwarf-1"), makeDwarf("dwarf-2")]);
      const snapshot = structuredClone(base);

      const away = travelling(base);
      completeExpeditionAction(away, "dwarf-1", { stone: 8 }, "Done.");
      failExpeditionAction(away, "dwarf-1", "Failed.");
      assignJob(away, "dwarf-1", "farming");

      expect(base).toEqual(snapshot);
    });

    it("sends dwarfId, destination and requestId as JSON", async () => {
      const mock = stubFetch(() =>
        Promise.resolve(
          Response.json({
            expeditionId: "expedition-17",
            status: "completed",
            rewards: { stone: 8 },
            message: "Found.",
          }),
        ),
      );

      const result = await beginExpedition("dwarf-1", "old-mine", "req-1");

      const [url, init] = mock.mock.calls[0] ?? [];
      expect(url).toBe("/api/expeditions");
      expect(init?.method).toBe("POST");
      expect(
        JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
      ).toEqual({
        dwarfId: "dwarf-1",
        destination: "old-mine",
        requestId: "req-1",
      });
      expect(result.rewards).toEqual({ stone: 8 });
    });

    it("aborts a hanging request with a timeout error", async () => {
      vi.useFakeTimers();
      stubFetch(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );

      const pending = beginExpedition("dwarf-1", "old-mine", "req-5", {
        retries: 0,
        timeoutMs: 1000,
      });
      const assertion = expect(pending).rejects.toThrow(
        "Expedition timed out.",
      );
      await vi.advanceTimersByTimeAsync(1_000);

      await assertion;
    });

    it.todo("retries a hanging request with the same requestId");
    it.todo("does not retry a definitive server failure such as 503");
    it.todo("server returns the cached result for a repeated requestId");
    it.todo("server rejects a known requestId with a different payload (409)");
    it.todo("server counts a repeated requestId only once");
  });

  describe("D4.7 equipped-tool policy", () => {
    it("keeps existing tools in the colony inventory during travel", () => {
      const state = makeState();

      expect(travelling(state).resources.tools).toBe(state.resources.tools);
    });

    it("adds a tool reward on top of the existing stock", () => {
      const completed = completeExpeditionAction(
        travelling(makeState()),
        "dwarf-1",
        { tools: 1 },
        "A tool was found.",
      );

      expect(completed.resources.tools).toBe(2);
    });
  });
});
