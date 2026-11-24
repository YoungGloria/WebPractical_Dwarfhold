import type {
  Activity,
  ColonyState,
  Dwarf,
  DwarfStatus,
  DwarfSpecies,
  JobType,
  Resources, PopupNotice,
} from "../domain/types";
import {
  DAY_MS,
  EXPEDITION_SECONDS,
  SAVE_VERSION,
  MAX_LOG,
} from "../config/constants";
import { reconcile } from "./reconcile";

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

export interface Bootstrap {
  colony: ColonyState;
  dayElapsedMs: number;
  expeditionCountdowns: Record<string, number>;
  pendingExpeditions: Record<string, PendingExpedition>;
  paused: boolean;
  notice: PopupNotice | null;
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
