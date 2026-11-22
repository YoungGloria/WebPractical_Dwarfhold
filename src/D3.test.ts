import { describe, expect, it } from "vitest";
import { completeCraftToolAction, craftToolAction } from "./colonyActions";
import { advanceDay } from "./simulation";
import type { ColonyState, Dwarf } from "./types";

function makeDwarf(
  id: string,
  status: Dwarf["status"] = "working",
  specialty: Dwarf["specialty"] = "mining",
): Dwarf {
  return {
    id,
    name: `Dwarf ${id}`,
    title: "",
    icon: "",
    assignment: "mining",
    status,
    specialty,
  };
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

describe("D3 forging", () => {
  it("requires an eligible specialist", () => {
    const nonSpecialist = makeDwarf("dwarf-1");
    const { specialty: _specialty, ...withoutSpecialty } = nonSpecialist;
    const state = makeState([withoutSpecialty]);

    expect(craftToolAction(state, "dwarf-1")).toBe(state);
  });

  it("rejects a specialist on expedition", () => {
    const state = makeState([makeDwarf("dwarf-1", "expedition")]);

    expect(craftToolAction(state, "dwarf-1")).toBe(state);
  });

  it("rejects a resting specialist", () => {
    const state = makeState([makeDwarf("dwarf-1", "resting")]);

    expect(craftToolAction(state, "dwarf-1")).toBe(state);
  });

  it("rejects a specialist that is already forging", () => {
    const state = makeState([makeDwarf("dwarf-1", "forging")]);

    expect(craftToolAction(state, "dwarf-1")).toBe(state);
  });

  it("rejects an unknown specialist", () => {
    const state = makeState();

    expect(craftToolAction(state, "missing-dwarf")).toBe(state);
  });

  it("rejects insufficient wood or stone without changing state", () => {
    const lowWood = makeState();
    lowWood.resources.wood = 2;

    const lowStone = makeState();
    lowStone.resources.stone = 1;

    expect(craftToolAction(lowWood, "dwarf-1")).toBe(lowWood);
    expect(craftToolAction(lowStone, "dwarf-1")).toBe(lowStone);
  });

  it("crafts once with an eligible specialist and sufficient materials", () => {
    const state = makeState();
    const crafted = craftToolAction(state, "dwarf-1");

    expect(crafted.resources).toEqual({
      wood: 11,
      stone: 7,
      food: 18,
      tools: 1,
    });
    expect(crafted.dwarves[0]?.status).toBe("forging");
    expect(crafted.log[0]?.message).toContain("started forging");
  });

  it("keeps the specialist in forging state until completion", () => {
    const state = makeState();
    const crafted = craftToolAction(state, "dwarf-1");
    const nextState = advanceDay(crafted);

    expect(crafted.dwarves[0]?.status).toBe("forging");
    expect(nextState.dwarves[0]?.status).toBe("forging");
  });

  it("adds the tool and rests the specialist at countdown completion", () => {
    const crafting = craftToolAction(makeState(), "dwarf-1");
    const completed = completeCraftToolAction(crafting, "dwarf-1");

    expect(completed.resources.tools).toBe(2);
    expect(completed.dwarves[0]?.status).toBe("resting");
    expect(completed.log[0]?.message).toContain("resting until tomorrow");
  });

  it("restores the specialist to its previous job on the next day", () => {
    const crafted = craftToolAction(makeState(), "dwarf-1");
    const completed = completeCraftToolAction(crafted, "dwarf-1");
    const nextState = advanceDay(completed);

    expect(nextState.dwarves[0]?.status).toBe("working");
  });

  it("does not stop other dwarves from producing on the crafting day", () => {
    const state = makeState([
      makeDwarf("dwarf-1"),
      makeDwarf("dwarf-2", "working", "woodcutting"),
    ]);
    state.dwarves[1].assignment = "woodcutting";
    const crafted = craftToolAction(state, "dwarf-1");
    const completed = completeCraftToolAction(crafted, "dwarf-1");
    const nextState = advanceDay(completed);

    expect(nextState.resources.wood).toBe(state.resources.wood - 3 + 3);
  });
});
