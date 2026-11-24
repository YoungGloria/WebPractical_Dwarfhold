import { failExpeditionAction } from "./domain/actions/expedition";
import { createInitialState } from "./domain/initialState";
import { log, MAX_LOG } from "./stateUtils";
import type {
  Activity,
  ColonyState,
  Dwarf,
  DwarfStatus,
  DwarfSpecies,
  JobType,
  Resources,
} from "./domain/types";
import {
  DAY_MS,
  EXPEDITION_SECONDS,
  FORGE_TOOL_SECONDS,
  FORGE_WEAPON_SECONDS,
} from "./simulation";

export const SAVE_KEY = "dwarfhold.saves";
export const SAVE_VERSION = 1;
export const MAX_SAVES = 5;

// Single source of truth for allowed values.
// New statuses/jobs/resources must be added here and in the matching parse function.
const STATUSES = [
  "idle",
  "working",
  "expedition",
  "resting",
  "forging_Tool",
  "forging_Weapon",
] as const satisfies readonly DwarfStatus[];
const JOBS = [
  "woodcutting",
  "mining",
  "farming",
] as const satisfies readonly Exclude<JobType, null>[];
const TONES = ["good", "warning"] as const;
const SPECIES = ["dwarf", "knight"] as const satisfies readonly DwarfSpecies[];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface PendingExpedition {
  destination: string;
  requestId: string;
  seconds: number;
}

export interface Snapshot {
  version: number;
  savedAt: number;
  colony: ColonyState;
  dayElapsedMs?: number;
  pendingExpeditions: Record<string, PendingExpedition>;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type SnapshotProblem = "corrupt" | "incompatible";

export type LoadResult =
  | { status: "empty" }
  | { status: "ok"; snapshot: Snapshot; skipped: number }
  | { status: "fallback"; reason: SnapshotProblem };

export interface RestoreNotice {
  header: string;
  subHeader: string;
  message: string;
}

export interface Bootstrap {
  colony: ColonyState;
  dayElapsedMs: number;
  expeditionCountdowns: Record<string, number>;
  pendingExpeditions: Record<string, PendingExpedition>;
  paused: boolean;
  notice: RestoreNotice | null;
}

/* ------------------------------------------------------------------ */
/* Runtime validation (unknown -> trusted domain value)               */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

const isOneOf = <T extends string>(
  list: readonly T[],
  value: unknown,
): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

const asArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? (value as unknown[]) : null;

function parseResources(raw: unknown): Resources | null {
  if (!isRecord(raw)) return null;
  const { wood, stone, food, tools, weapons } = raw;
  if (
    !isCount(wood) ||
    !isCount(stone) ||
    !isCount(food) ||
    !isCount(tools) ||
    !isCount(weapons)
  ) {
    return null;
  }
  return { wood, stone, food, tools, weapons };
}

function parseDwarf(raw: unknown): Dwarf | null {
  if (!isRecord(raw)) return null;
  const {
    id,
    species,
    name,
    title,
    icon,
    assignment,
    status,
    specialty,
    hasTool,
    countdown,
  } = raw;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof title !== "string" ||
    typeof icon !== "string" ||
    typeof hasTool !== "boolean"
  ) {
    return null;
  }
  if (countdown !== undefined && !isCount(countdown)) return null;
  if (!isOneOf(STATUSES, status)) return null;
  if (assignment !== null && !isOneOf(JOBS, assignment)) return null;
  if (specialty !== undefined && !isOneOf(JOBS, specialty)) return null;

  const resolvedSpecies: DwarfSpecies =
    species === undefined
      ? "dwarf"
      : isOneOf(SPECIES, species)
        ? species
        : null!;
  if (species !== undefined && !isOneOf(SPECIES, species)) return null;

  return {
    id,
    species: resolvedSpecies,
    name,
    hasTool,
    title,
    icon,
    assignment,
    status,
    ...(specialty === undefined ? {} : { specialty }),
    ...(countdown === undefined ? {} : { countdown }),
  };
}

function parseActivity(raw: unknown): Activity | null {
  if (!isRecord(raw)) return null;
  const { id, day, message, tone } = raw;
  if (typeof id !== "string" || !isCount(day) || typeof message !== "string") {
    return null;
  }
  if (tone !== undefined && !isOneOf(TONES, tone)) return null;
  return { id, day, message, ...(tone === undefined ? {} : { tone }) };
}

function parseColony(raw: unknown): ColonyState | null {
  if (!isRecord(raw)) return null;

  const resources = parseResources(raw.resources);
  const dwarfList = asArray(raw.dwarves);
  const logList = asArray(raw.log);
  if (
    !resources ||
    !dwarfList ||
    !logList ||
    dwarfList.length === 0 ||
    !isCount(raw.day) ||
    !isCount(raw.logSeq)
  ) {
    return null;
  }

  if (
    raw.sirOneUperJoined !== undefined &&
    typeof raw.sirOneUperJoined !== "boolean"
  ) {
    return null;
  }

  const dwarves = dwarfList.map(parseDwarf);
  const entries = logList.map(parseActivity);
  if (dwarves.some((d) => d === null) || entries.some((e) => e === null)) {
    return null;
  }

  const validDwarves = dwarves.filter((d): d is Dwarf => d !== null);
  if (new Set(validDwarves.map((d) => d.id)).size !== validDwarves.length) {
    return null; // duplicate ids would make every lookup ambiguous
  }

  return {
    day: raw.day,
    resources,
    dwarves: validDwarves,
    log: entries.filter((e): e is Activity => e !== null).slice(0, MAX_LOG),
    logSeq: raw.logSeq,
    sirOneUperJoined: raw.sirOneUperJoined ?? false,
  };
}

function parsePending(raw: unknown): Record<string, PendingExpedition> | null {
  if (!isRecord(raw)) return null;
  const result: Record<string, PendingExpedition> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (
      !isRecord(entry) ||
      typeof entry.destination !== "string" ||
      typeof entry.requestId !== "string" ||
      entry.requestId.length === 0
    ) {
      return null;
    }
    const seconds =
      typeof entry.seconds === "number" ? entry.seconds : EXPEDITION_SECONDS;
    if (!isCount(seconds) || seconds < 1 || seconds > EXPEDITION_SECONDS) {
      return null;
    }
    result[id] = {
      destination: entry.destination,
      requestId: entry.requestId,
      seconds,
    };
  }
  return result;
}

function parseDayElapsedMs(raw: unknown): number | null {
  if (raw === undefined) return 0;
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    raw < 0 ||
    raw >= DAY_MS
  ) {
    return null;
  }
  return raw;
}

/**
 * Makes colony, countdowns and pending requests agree with each other, so that
 * every accepted snapshot is internally consistent:
 *  - forging dwarf  <=> countdown entry   (missing entry -> full duration)
 *  - expedition dwarf <=> pending request (missing request -> expedition is
 *    declared lost via failExpeditionAction, the dwarf is never stuck away)
 */
function withCountdown(
  colony: ColonyState,
  dwarfId: string,
  countdown: number,
): ColonyState {
  const current = colony.dwarves.find((d) => d.id === dwarfId);
  if (!current || current.countdown === countdown) return colony;

  return {
    ...colony,
    dwarves: colony.dwarves.map((d) =>
      d.id === dwarfId ? { ...d, countdown } : d,
    ),
  };
}

function reconcile(
  colony: ColonyState,
  pending: Record<string, PendingExpedition>,
) {
  let next = colony;
  const pendingExpeditions: Record<string, PendingExpedition> = {};

  for (const dwarf of colony.dwarves) {
    if (dwarf.status === "forging_Weapon") {
      next = withCountdown(
        next,
        dwarf.id,
        dwarf.countdown ?? FORGE_WEAPON_SECONDS,
      );
      continue;
    }

    if (dwarf.status === "forging_Tool") {
      next = withCountdown(
        next,
        dwarf.id,
        dwarf.countdown ?? FORGE_TOOL_SECONDS,
      );
      continue;
    }

    if (dwarf.status === "expedition") {
      const request = pending[dwarf.id];
      if (!request) {
        next = failExpeditionAction(
          next,
          dwarf.id,
          `${dwarf.name}'s expedition lost its trail during the reload.`,
        );
        continue;
      }

      const countdown = dwarf.countdown ?? request.seconds;
      pendingExpeditions[dwarf.id] = { ...request, seconds: countdown };
      next = withCountdown(next, dwarf.id, countdown);
    }
  }

  return { colony: next, pendingExpeditions };
}
type Validation =
  { ok: true; snapshot: Snapshot } | { ok: false; reason: SnapshotProblem };

export function validateSnapshot(raw: unknown): Validation {
  if (!isRecord(raw)) return { ok: false, reason: "corrupt" };
  if (typeof raw.version !== "number") return { ok: false, reason: "corrupt" };
  if (raw.version !== SAVE_VERSION)
    return { ok: false, reason: "incompatible" };

  const colony = parseColony(raw.colony);
  const dayElapsedMs = parseDayElapsedMs(raw.dayElapsedMs);
  const pending = parsePending(raw.pendingExpeditions);
  if (
    !colony ||
    dayElapsedMs === null ||
    !pending ||
    typeof raw.savedAt !== "number"
  ) {
    return { ok: false, reason: "corrupt" };
  }

  return {
    ok: true,
    snapshot: {
      version: SAVE_VERSION,
      savedAt: raw.savedAt,
      dayElapsedMs,
      ...reconcile(colony, pending),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ring buffer in one storage key (one write = atomic)                 */
/* ------------------------------------------------------------------ */

// Same snapshot content (ignoring the timestamp) is not stored twice.
// This also keeps React StrictMode's double effect from filling the ring.
const fingerprint = (value: unknown): string =>
  isRecord(value) ? JSON.stringify({ ...value, savedAt: 0 }) : "";

function readRing(storage: StorageLike): unknown[] {
  try {
    const raw = storage.getItem(SAVE_KEY);
    return raw === null ? [] : (asArray(JSON.parse(raw)) ?? []);
  } catch {
    return []; // unreadable ring is simply replaced by the next save
  }
}

// "push": new entry at the front (significant event).
// "replaceHead": refresh the newest entry in place (progress such as the forge
// countdown), so frequent updates do not push older snapshots out of the ring.
export type SaveMode = "push" | "replaceHead";

/** Newest snapshot first, at most MAX_SAVES. Returns false if storage failed. */
export function saveSnapshot(
  snapshot: Snapshot,
  storage: StorageLike = window.localStorage,
  mode: SaveMode = "push",
): boolean {
  try {
    const ring = readRing(storage);
    if (fingerprint(ring[0]) === fingerprint(snapshot)) return true;

    if (mode === "replaceHead") ring.shift();
    ring.unshift(snapshot);
    storage.setItem(SAVE_KEY, JSON.stringify(ring.slice(0, MAX_SAVES)));
    return true;
  } catch {
    return false; // quota exceeded, private mode, ...
  }
}

/** Walks newest -> oldest; the first valid snapshot wins. */
export function loadSnapshot(
  storage: StorageLike = window.localStorage,
): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { status: "empty" }; // storage not accessible at all
  }
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "fallback", reason: "corrupt" };
  }

  const ring = asArray(parsed);
  if (!ring || ring.length === 0) {
    return { status: "fallback", reason: "corrupt" };
  }

  let newestProblem: SnapshotProblem = "corrupt";
  for (const [index, entry] of ring.entries()) {
    const result = validateSnapshot(entry);
    if (result.ok) {
      return { status: "ok", snapshot: result.snapshot, skipped: index };
    }
    if (index === 0) newestProblem = result.reason;
  }
  return { status: "fallback", reason: newestProblem };
}

export function clearColonySave(
  storage: StorageLike = window.localStorage,
): void {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // nothing to clear if storage is unavailable
  }
}

/* ------------------------------------------------------------------ */
/* Bootstrap: what the provider starts with                            */
/* ------------------------------------------------------------------ */

export function bootstrapColony(
  storage: StorageLike = window.localStorage,
): Bootstrap {
  const result = loadSnapshot(storage);

  if (result.status === "empty") {
    return {
      colony: createInitialState(),
      dayElapsedMs: 0,
      expeditionCountdowns: {},
      pendingExpeditions: {},
      paused: false,
      notice: null,
    };
  }

  if (result.status === "fallback") {
    return {
      colony: createInitialState(),
      dayElapsedMs: 0,
      expeditionCountdowns: {},
      pendingExpeditions: {},
      paused: true,
      notice: {
        header: "Saved hold lost",
        subHeader:
          result.reason === "incompatible"
            ? "The save comes from another version of the game."
            : "The save was damaged.",
        message:
          "No readable save was found, so a new hold was founded. The hold is resting until you wake it.",
      },
    };
  }

  const { snapshot, skipped } = result;
  let colony = log(
    snapshot.colony,
    skipped === 0
      ? `Hold restored on day ${snapshot.colony.day}. It rests until you wake it.`
      : `An older save from day ${snapshot.colony.day} was restored.`,
    skipped === 0 ? "good" : "warning",
  );

  // Visible policy (D5.4 / D5.5), one line per interrupted task
  for (const dwarf of colony.dwarves) {
    if (dwarf.status === "forging_Tool" || dwarf.status === "forging_Weapon") {
      colony = log(
        colony,
        `${dwarf.name}'s forging continues once the hold is awake.`,
      );
    } else if (dwarf.status === "expedition") {
      colony = log(
        colony,
        `${dwarf.name}'s expedition continues once the hold is awake.`,
      );
    }
  }

  return {
    colony,
    dayElapsedMs: snapshot.dayElapsedMs ?? 0,
    expeditionCountdowns: Object.fromEntries(
      Object.entries(snapshot.pendingExpeditions).map(([dwarfId, request]) => [
        dwarfId,
        request.seconds,
      ]),
    ),
    pendingExpeditions: snapshot.pendingExpeditions,
    paused: true,
    notice:
      skipped === 0
        ? {
            header: "Latest save restored",
            subHeader: `No progress was lost.`,
            message: `Day ${snapshot.colony.day} was restored..`,
          }
        : {
            header: "Older save restored",
            subHeader: `Some progress was lost.`,
            message: `Day ${snapshot.colony.day} at ${snapshot.savedAt} was restored. Progress after that point is lost.`,
          },
  };
}
