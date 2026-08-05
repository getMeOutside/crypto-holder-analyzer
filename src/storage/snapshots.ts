import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import type { TokenSnapshot } from "../types/index.js";

const SNAPSHOTS_DIR = join(process.cwd(), "data", "snapshots");

function ensureDir() {
  if (!existsSync(SNAPSHOTS_DIR)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }
}

function getTokenDir(address: string, chain: string): string {
  const dir = join(SNAPSHOTS_DIR, `${chain.toLowerCase()}_${address.toLowerCase()}`);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function saveSnapshot(snapshot: TokenSnapshot): void {
  ensureDir();
  const dir = getTokenDir(snapshot.token.address, snapshot.token.chain);
  const filename = `${snapshot.date}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(snapshot, null, 2));
  console.log(`Snapshot saved: ${filepath}`);
}

export function getSnapshots(address: string, chain: string): TokenSnapshot[] {
  const dir = getTokenDir(address, chain);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  return files.map((f) => {
    const data = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(data) as TokenSnapshot;
  });
}

export function getLatestSnapshot(address: string, chain: string): TokenSnapshot | null {
  const snapshots = getSnapshots(address, chain);
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

export function getPreviousSnapshot(address: string, chain: string): TokenSnapshot | null {
  const snapshots = getSnapshots(address, chain);
  return snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
}
