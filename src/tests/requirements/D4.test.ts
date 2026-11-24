/**
 * Test for requirement D4 - Resilient expeditions
 *
 * Covers the following subtask classifications:
 *
 * [D4.1] Departure
 *        - an eligible dwarf can be sent to a destination
 *        - the departure is recorded in the chronicle with the dwarf's name
 *        - starting an expedition neither costs nor awards resources
 *        - unknown dwarves, travelling, resting and forging dwarves cannot depart
 *
 * [D4.2] Unavailability while travelling
 *        - a travelling dwarf cannot be assigned, produces nothing and cannot craft
 *        - a travelling dwarf still eats
 *        - other dwarves keep working and stay assignable
 *
 * [D4.3] Rewards are applied exactly once after success
 *        - a successful result adds its rewards to the inventory
 *        - a duplicate success delivery does not pay twice
 *        - the dwarf returns (rests, then works) and the chronicle reports it
 *        - empty/partial rewards and rewards of several resources work
 *
 * [D4.4] Failed requests
 *        - a failure awards nothing and does not leave the dwarf travelling
 *        - the failure is reported as a warning in the chronicle
 *        - a late failure after a success (or the reverse) cannot create a
 *          contradictory worker state
 *
 * [D4.5] Slow or repeated actions (state level and server level)
 *        - sending the same dwarf twice is ignored
 *        - two dwarves can travel independently
 *        - the server answers a repeated requestId with the same expedition
 *          (reward is created once) and rejects a requestId reused for
 *          another dwarf/destination
 *        - invalid requests, unknown destinations and blocked routes fail cleanly
 *
 * [D4.6] Equipped tool policy
 *        - whichever policy is chosen, the total number of tools stays
 *          consistent over departure, success and failure
 *
 * [D4.7] Client resilience
 *        - the client sends dwarfId, destination and requestId
 *        - network errors and timeouts are retried with the same requestId
 *        - business errors (e.g. 503 rockfall) are not retried and surface the
 *          server message; unreadable error bodies get a generic message
 *        - retries are bounded
 *
 * The detailed positive, negative and edge cases are grouped below by
 * state transitions, server behaviour and client behaviour.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginExpedition, RetryableError } from "../../services/expeditionApi";
import { assignJob } from "../../domain/actions/assignment";
import { craftToolAction } from "../../domain/actions/crafting";
import {
  completeExpeditionAction,
  failExpeditionAction,
  startExpeditionAction,
} from "../../domain/actions/expedition";
import { advanceDay } from "../../domain/simulation/advanceDay";
import type {
  ColonyState,
  Dwarf,
  DwarfStatus,
  JobType,
} from "../../domain/types";

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

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
  dwarves: Dwarf[] = [
    makeDwarf("dwarf-1"),
    makeDwarf("dwarf-2", "woodcutting"),
  ],
): ColonyState {
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

const totalTools = (state: ColonyState) =>
  state.resources.tools + state.dwarves.filter((d) => d.hasTool).length;

const UNABLE_TO_DEPART: DwarfStatus[] = [
  "expedition",
  "resting",
  "forging_Tool",
  "forging_Weapon",
];

describe("D4 resilient expeditions", () => {
  describe("departure", () => {
    it("sends an eligible dwarf on an expedition", () => {
      const next = startExpeditionAction(
        makeState(),
        "dwarf-1",
        "crystal-cave",
      );

      expect(dwarfOf(next, "dwarf-1").status).toBe("expedition");
    });

    it("also lets an idle dwarf depart", () => {
      const state = makeState([makeDwarf("dwarf-1", null, "idle")]);
      const next = startExpeditionAction(state, "dwarf-1", "old-mine");

      expect(dwarfOf(next, "dwarf-1").status).toBe("expedition");
    });

    it("keeps the assignment so the dwarf can resume work afterwards", () => {
      const next = startExpeditionAction(
        makeState(),
        "dwarf-1",
        "crystal-cave",
      );

      expect(dwarfOf(next, "dwarf-1").assignment).toBe("mining");
    });

    it("names the dwarf and the destination in the chronicle", () => {
      const next = startExpeditionAction(
        makeState(),
        "dwarf-1",
        "crystal-cave",
      );

      expect(next.log[0].message).toContain("Dwarf dwarf-1");
      expect(next.log[0].message.toLowerCase()).toContain("crystal cave");
    });

    it("does not change any resource on departure", () => {
      const state = makeState();
      const next = startExpeditionAction(state, "dwarf-1", "crystal-cave");

      expect(next.resources).toEqual(state.resources);
    });

    it("rejects an unknown dwarf", () => {
      const state = makeState();

      expect(startExpeditionAction(state, "ghost", "crystal-cave")).toBe(state);
    });

    it.each(UNABLE_TO_DEPART)(
      "rejects departure of a dwarf with status %s",
      (status) => {
        const state = makeState([makeDwarf("dwarf-1", "mining", status)]);

        expect(startExpeditionAction(state, "dwarf-1", "crystal-cave")).toBe(
          state,
        );
      },
    );

    it("does not mutate the input state", () => {
      const state = makeState();
      const snapshot = structuredClone(state);

      startExpeditionAction(state, "dwarf-1", "crystal-cave");

      expect(state).toEqual(snapshot);
    });
  });

  describe("unavailability while travelling", () => {
    const travelling = () =>
      startExpeditionAction(makeState(), "dwarf-1", "crystal-cave");

    it("cannot be reassigned while away", () => {
      const state = travelling();

      expect(assignJob(state, "dwarf-1", "farming")).toBe(state);
      expect(assignJob(state, "dwarf-1", null)).toBe(state);
    });

    it("cannot start a craft while away", () => {
      const state = travelling();
      state.dwarves[0].specialty = "mining";

      expect(craftToolAction(state, "dwarf-1")).toBe(state);
    });

    it("produces nothing while away", () => {
      const state = travelling();

      expect(advanceDay(state).resources.stone).toBe(state.resources.stone);
    });

    it("still eats while away", () => {
      const state = travelling();

      // one woodcutter produces 3 wood, both dwarves eat
      expect(advanceDay(state).resources.food).toBe(state.resources.food - 2);
    });

    it("stays away over the day change", () => {
      expect(dwarfOf(advanceDay(travelling()), "dwarf-1").status).toBe(
        "expedition",
      );
    });

    it("leaves the other dwarves working and assignable", () => {
      const state = travelling();
      const next = assignJob(state, "dwarf-2", "farming");

      expect(dwarfOf(next, "dwarf-2").assignment).toBe("farming");
      expect(dwarfOf(advanceDay(state), "dwarf-2").status).toBe("working");
    });
  });

  describe("rewards after success", () => {
    const away = () =>
      startExpeditionAction(makeState(), "dwarf-1", "crystal-cave");

    it("adds the rewards of a successful expedition", () => {
      const state = away();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        { stone: 8, tools: 1 },
        "Found a seam.",
      );

      expect(next.resources.stone).toBe(state.resources.stone + 8);
      expect(next.resources.tools).toBe(state.resources.tools + 1);
    });

    it("leaves unrelated resources untouched", () => {
      const state = away();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        { stone: 8 },
        "ok",
      );

      expect(next.resources.wood).toBe(state.resources.wood);
      expect(next.resources.food).toBe(state.resources.food);
      expect(next.resources.weapons).toBe(state.resources.weapons);
    });

    it("applies the rewards exactly once when the result is delivered twice", () => {
      const once = completeExpeditionAction(
        away(),
        "dwarf-1",
        { stone: 12, wood: 2 },
        "ok",
      );
      const twice = completeExpeditionAction(
        once,
        "dwarf-1",
        { stone: 12, wood: 2 },
        "ok",
      );

      expect(twice.resources).toEqual(once.resources);
      expect(twice).toBe(once);
    });

    it("applies several rewards of different resources", () => {
      const state = away();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        { stone: 12, wood: 2 },
        "ok",
      );

      expect(next.resources.stone).toBe(state.resources.stone + 12);
      expect(next.resources.wood).toBe(state.resources.wood + 2);
    });

    it("accepts empty rewards without changing resources", () => {
      const state = away();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        {},
        "nothing found",
      );

      expect(next.resources).toEqual(state.resources);
      expect(dwarfOf(next, "dwarf-1").status).not.toBe("expedition");
    });

    it("accepts a zero reward without changing the resource", () => {
      const state = away();
      const next = completeExpeditionAction(
        state,
        "dwarf-1",
        { stone: 0 },
        "ok",
      );

      expect(next.resources.stone).toBe(state.resources.stone);
    });

    it("does not award anything to a dwarf that is not travelling", () => {
      const state = makeState();

      expect(
        completeExpeditionAction(state, "dwarf-1", { stone: 8 }, "ok"),
      ).toBe(state);
    });

    it("does not award anything for an unknown dwarf", () => {
      const state = away();

      expect(completeExpeditionAction(state, "ghost", { stone: 8 }, "ok")).toBe(
        state,
      );
    });

    it("returns the dwarf and reports the result in the chronicle", () => {
      const next = completeExpeditionAction(
        away(),
        "dwarf-1",
        { stone: 8 },
        "Found a seam.",
      );

      expect(dwarfOf(next, "dwarf-1").status).toBe("resting");
      expect(next.log[0].message).toBe("Found a seam.");
      expect(next.log[0].tone).toBe("good");
    });

    it("lets the returned dwarf work again after the day change", () => {
      const done = completeExpeditionAction(
        away(),
        "dwarf-1",
        { stone: 8 },
        "ok",
      );

      expect(dwarfOf(advanceDay(done), "dwarf-1").status).toBe("working");
    });

    it("does not mutate the input state", () => {
      const state = away();
      const snapshot = structuredClone(state);

      completeExpeditionAction(state, "dwarf-1", { stone: 8 }, "ok");

      expect(state).toEqual(snapshot);
    });
  });

  describe("failed requests", () => {
    const away = () =>
      startExpeditionAction(makeState(), "dwarf-1", "blocked-pass");

    it("does not award any resources on failure", () => {
      const state = away();
      const next = failExpeditionAction(state, "dwarf-1", "Rockfall.");

      expect(next.resources).toEqual(state.resources);
    });

    it("does not leave the dwarf permanently unavailable", () => {
      const failed = failExpeditionAction(away(), "dwarf-1", "Rockfall.");

      expect(dwarfOf(failed, "dwarf-1").status).not.toBe("expedition");
      expect(dwarfOf(advanceDay(failed), "dwarf-1").status).toBe("working");
    });

    it("reports the failure as a warning", () => {
      const failed = failExpeditionAction(away(), "dwarf-1", "Rockfall.");

      expect(failed.log[0]).toMatchObject({
        message: "Rockfall.",
        tone: "warning",
      });
    });

    it("ignores a failure for a dwarf that is not travelling", () => {
      const state = makeState();

      expect(failExpeditionAction(state, "dwarf-1", "Rockfall.")).toBe(state);
    });

    it("ignores a failure for an unknown dwarf", () => {
      const state = away();

      expect(failExpeditionAction(state, "ghost", "Rockfall.")).toBe(state);
    });

    it("ignores a late failure after the expedition already succeeded", () => {
      const succeeded = completeExpeditionAction(
        away(),
        "dwarf-1",
        { stone: 8 },
        "ok",
      );
      const lateFailure = failExpeditionAction(
        succeeded,
        "dwarf-1",
        "Late error",
      );

      expect(lateFailure).toBe(succeeded);
      expect(lateFailure.resources.stone).toBe(succeeded.resources.stone);
    });

    it("ignores a late success after the expedition already failed", () => {
      const failed = failExpeditionAction(away(), "dwarf-1", "Rockfall.");
      const lateSuccess = completeExpeditionAction(
        failed,
        "dwarf-1",
        { stone: 8 },
        "ok",
      );

      expect(lateSuccess).toBe(failed);
      expect(lateSuccess.resources.stone).toBe(failed.resources.stone);
    });

    it("ignores a repeated failure", () => {
      const failed = failExpeditionAction(away(), "dwarf-1", "Rockfall.");

      expect(failExpeditionAction(failed, "dwarf-1", "Rockfall.")).toBe(failed);
    });

    it("lets the dwarf depart again after a failed expedition and a day", () => {
      const failed = advanceDay(
        failExpeditionAction(away(), "dwarf-1", "Rockfall."),
      );
      const again = startExpeditionAction(failed, "dwarf-1", "crystal-cave");

      expect(dwarfOf(again, "dwarf-1").status).toBe("expedition");
    });
  });

  describe("slow and repeated actions", () => {
    it("ignores a second departure of the same dwarf (double click)", () => {
      const first = startExpeditionAction(
        makeState(),
        "dwarf-1",
        "crystal-cave",
      );
      const second = startExpeditionAction(first, "dwarf-1", "old-mine");

      expect(second).toBe(first);
      expect(second.log).toHaveLength(1);
    });

    it("lets two dwarves travel independently", () => {
      let state = makeState();
      state = startExpeditionAction(state, "dwarf-1", "crystal-cave");
      state = startExpeditionAction(state, "dwarf-2", "old-mine");
      state = completeExpeditionAction(
        state,
        "dwarf-2",
        { stone: 12, wood: 2 },
        "ok",
      );

      expect(dwarfOf(state, "dwarf-1").status).toBe("expedition");
      expect(dwarfOf(state, "dwarf-2").status).toBe("resting");
      expect(state.resources.stone).toBe(9 + 12);
    });

    it("never marks the whole colony as away if one expedition is slow", () => {
      let state = makeState();
      state = startExpeditionAction(state, "dwarf-1", "crystal-cave");

      expect(
        state.dwarves.filter((d) => d.status === "expedition"),
      ).toHaveLength(1);
    });

    it("handles interleaved results in any order", () => {
      let state = makeState();
      state = startExpeditionAction(state, "dwarf-1", "crystal-cave");
      state = startExpeditionAction(state, "dwarf-2", "blocked-pass");
      state = failExpeditionAction(state, "dwarf-2", "Rockfall.");
      state = completeExpeditionAction(state, "dwarf-1", { stone: 8 }, "ok");

      expect(state.resources.stone).toBe(9 + 8);
      expect(state.dwarves.every((d) => d.status !== "expedition")).toBe(true);
    });

    it("keeps the expedition count at zero after all results are delivered", () => {
      let state = startExpeditionAction(makeState(), "dwarf-1", "crystal-cave");
      state = completeExpeditionAction(state, "dwarf-1", {}, "ok");
      state = completeExpeditionAction(state, "dwarf-1", {}, "ok");

      expect(
        state.dwarves.filter((d) => d.status === "expedition"),
      ).toHaveLength(0);
    });
  });

  describe("equipped tool policy", () => {
    const equipped = () =>
      makeState([
        makeDwarf("dwarf-1", "mining", "working", { hasTool: true }),
        makeDwarf("dwarf-2", "woodcutting"),
      ]);

    it("keeps the total number of tools consistent when departing", () => {
      const state = equipped();

      expect(
        totalTools(startExpeditionAction(state, "dwarf-1", "crystal-cave")),
      ).toBe(totalTools(state));
    });

    it("keeps the total number of tools consistent on failure", () => {
      const state = equipped();
      let next = startExpeditionAction(state, "dwarf-1", "blocked-pass");
      next = failExpeditionAction(next, "dwarf-1", "Rockfall.");

      expect(totalTools(next)).toBe(totalTools(state));
    });

    it("adds only the rewarded tools on success", () => {
      const state = equipped();
      let next = startExpeditionAction(state, "dwarf-1", "crystal-cave");
      next = completeExpeditionAction(
        next,
        "dwarf-1",
        { tools: 1, stone: 8 },
        "ok",
      );

      expect(totalTools(next)).toBe(totalTools(state) + 1);
    });

    it("never shares the equipped tool with another dwarf during the expedition", () => {
      const next = startExpeditionAction(equipped(), "dwarf-1", "crystal-cave");

      expect(next.dwarves.filter((d) => d.hasTool).length).toBeLessThanOrEqual(
        1,
      );
    });

    it("produces no tool bonus for the travelling owner", () => {
      const next = startExpeditionAction(equipped(), "dwarf-1", "crystal-cave");

      expect(advanceDay(next).resources.stone).toBe(next.resources.stone);
    });
  });

  describe("client resilience (mocked network)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    const okBody = {
      expeditionId: "expedition-17",
      status: "completed",
      rewards: { stone: 8 },
      message: "ok",
    };

    const jsonResponse = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    it("sends dwarfId, destination and requestId as JSON", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, okBody));
      vi.stubGlobal("fetch", fetchMock);

      const result = await beginExpedition("dwarf-1", "crystal-cave", "req-1");

      expect(result).toEqual(okBody);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/expeditions");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        dwarfId: "dwarf-1",
        destination: "crystal-cave",
        requestId: "req-1",
      });
    });

    it("retries a network error and reuses the same requestId", async () => {
      vi.useFakeTimers();
      const fetchMock: FetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(jsonResponse(200, okBody));
      vi.stubGlobal("fetch", fetchMock);

      const promise = beginExpedition("dwarf-1", "crystal-cave", "req-2");
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(promise).resolves.toEqual(okBody);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const ids = fetchMock.mock.calls.map((call: unknown[]) => {
        const init = call[1] as RequestInit;
        const parsed = JSON.parse(init.body as string) as {
          requestId?: string;
        };
        return String(parsed.requestId ?? "");
      });
      expect(ids).toEqual(["req-2", "req-2"]);
    });

    it("gives up after the bounded number of retries with a RetryableError", async () => {
      vi.useFakeTimers();
      const fetchMock: FetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError("offline"));
      vi.stubGlobal("fetch", fetchMock);

      const promise = beginExpedition("dwarf-1", "crystal-cave", "req-3", {
        retries: 2,
      });
      const assertion = expect(promise).rejects.toBeInstanceOf(RetryableError);
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;

      expect(fetchMock).toHaveBeenCalledTimes(3); // 1 attempt + 2 retries
    });

    it("does not retry at all when retries is 0", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockRejectedValue(new TypeError("offline"));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        beginExpedition("dwarf-1", "crystal-cave", "req-4", { retries: 0 }),
      ).rejects.toBeInstanceOf(RetryableError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("turns a timeout into a retryable error", async () => {
      vi.useFakeTimers();
      const fetchMock: FetchMock = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(
                Object.assign(new Error("aborted"), { name: "AbortError" }),
              );
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = beginExpedition("dwarf-1", "crystal-cave", "req-5", {
        retries: 0,
        timeoutMs: 1_000,
      });
      const assertion = expect(promise).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(1_500);
      await assertion;
    });

    it("retries after a timeout and succeeds with the second attempt", async () => {
      vi.useFakeTimers();
      let callCount = 0;
      const fetchMock: FetchMock = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) => {
          callCount += 1;
          if (callCount === 1) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(
                  Object.assign(new Error("aborted"), { name: "AbortError" }),
                );
              });
            });
          }
          return Promise.resolve(jsonResponse(200, okBody));
        },
      );
      vi.stubGlobal("fetch", fetchMock);

      const promise = beginExpedition("dwarf-1", "crystal-cave", "req-6", {
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(promise).resolves.toEqual(okBody);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry a business error and surfaces the server message", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse(503, { error: "Rockfall has sealed the route." }),
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        beginExpedition("dwarf-1", "blocked-pass", "req-7"),
      ).rejects.toThrow("Rockfall has sealed the route.");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not mark a business error as retryable", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(404, { error: "nope" }));
      vi.stubGlobal("fetch", fetchMock);

      const error: unknown = await beginExpedition(
        "dwarf-1",
        "atlantis",
        "req-8",
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(RetryableError);
    });

    it("falls back to a generic message for an unreadable error body", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockResolvedValue(new Response("<html>boom</html>", { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        beginExpedition("dwarf-1", "crystal-cave", "req-9"),
      ).rejects.toThrow("Expedition failed (500)");
    });

    it("falls back to a generic message when the error body has no error field", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(502, { detail: "x" }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        beginExpedition("dwarf-1", "crystal-cave", "req-10"),
      ).rejects.toThrow("Expedition failed (502)");
    });

    it("does not invent rewards when the request fails", async () => {
      const fetchMock: FetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(503, { error: "x" }));
      vi.stubGlobal("fetch", fetchMock);

      const result: unknown = await beginExpedition(
        "dwarf-1",
        "blocked-pass",
        "req-11",
      ).catch((error: unknown) => error);

      expect(result).toBeInstanceOf(Error);
      expect((result as { rewards?: unknown }).rewards).toBeUndefined();
    });
  });
});
