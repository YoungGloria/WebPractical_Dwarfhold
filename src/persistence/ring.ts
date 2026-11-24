import { MAX_SAVES, SAVE_KEY } from "../config/constants";
import {
  validateSnapshot,
  type LoadResult,
  type Snapshot,
  type SnapshotProblem,
  type StorageLike,
} from "./schema";

export type SaveMode = "push" | "replaceHead";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] | null =>
  Array.isArray(value) ? value : null;

const fingerprint = (value: unknown): string =>
  isRecord(value) ? JSON.stringify({ ...value, savedAt: 0 }) : "";

function readRing(storage: StorageLike): unknown[] {
  try {
    const raw = storage.getItem(SAVE_KEY);
    return raw === null ? [] : (asArray(JSON.parse(raw)) ?? []);
  } catch {
    return [];
  }
}

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
    return false;
  }
}

export function loadSnapshot(
  storage: StorageLike = window.localStorage,
): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { status: "empty" };
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
