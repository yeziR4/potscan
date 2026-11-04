import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The Solidity team's release server; nothing else is downloaded or executed. */
const BINARIES = "https://binaries.soliditylang.org/bin";
const LIST_TTL_MS = 6 * 60 * 60_000;

type ReleaseList = { releases: Record<string, string>; builds: { path: string; sha256: string; longVersion: string }[] };

let list: { at: number; value: ReleaseList } | undefined;

async function releaseList(): Promise<ReleaseList> {
  if (list && Date.now() - list.at < LIST_TTL_MS) return list.value;
  const response = await fetch(`${BINARIES}/list.json`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`The Solidity release list returned HTTP ${response.status}`);
  list = { at: Date.now(), value: (await response.json()) as ReleaseList };
  return list.value;
}

/**
 * Path to the official soljson build for a release such as "0.8.24", downloaded once into `cacheDir`.
 * The file is checked against the SHA-256 the release list publishes before it is kept, because it is then executed.
 */
export async function soljsonFor(version: string, cacheDir: string): Promise<{ path: string; longVersion: string }> {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Not a solc release: ${version}`);
  const releases = await releaseList();
  const file = releases.releases[version];
  const build = file && releases.builds.find(b => b.path === file);
  if (!file || !build) throw new Error(`solc ${version} is not a published release`);

  const path = join(cacheDir, file);
  if (existsSync(path)) return { path, longVersion: build.longVersion };

  const response = await fetch(`${BINARIES}/${file}`, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Downloading solc ${version} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = `0x${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== build.sha256) throw new Error(`solc ${version} failed its checksum (expected ${build.sha256}, got ${digest})`);

  mkdirSync(cacheDir, { recursive: true });
  // Written under a temporary name first, so a crash mid-write never leaves a truncated compiler in the cache.
  writeFileSync(`${path}.part`, bytes);
  renameSync(`${path}.part`, path);
  return { path, longVersion: build.longVersion };
}
