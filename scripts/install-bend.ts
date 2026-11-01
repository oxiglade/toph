import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import bend from "../vendor/bend/version.json";

export function archiveSpec(flake: string, target: string, version: string) {
  if (/\bver = "([^"]+)";/.exec(flake)?.[1] !== version) throw new Error("Bend flake and vendor version disagree");
  const sha256 = [...flake.matchAll(/target = "([^"]+)";\s*sha256 = "([a-f0-9]{64})";/g)]
    .find(match => match[1] === target)?.[2];
  if (!sha256) throw new Error("no pinned Bend archive checksum for " + target);
  return { url: `https://github.com/bendlang/bend/releases/download/v${version}/bend-${version}-${target}.tar.gz`, sha256 };
}

export function verifyArchive(bytes: Uint8Array, expected: string) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`Bend archive SHA-256 mismatch: expected ${expected}, got ${actual}`);
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return response;
}

async function install(destination: string) {
  if (!["darwin", "linux"].includes(process.platform) || !["arm64", "x64"].includes(process.arch)) {
    throw new Error("unsupported Bend platform: " + process.platform + "-" + process.arch);
  }
  const lock = JSON.parse(readFileSync(new URL("../devenv.lock", import.meta.url), "utf8"));
  const commit = lock.nodes.bend.locked.rev;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Bend must be pinned to an exact commit in devenv.lock");
  const flake = await (await download(`https://raw.githubusercontent.com/bendlang/bend/${commit}/flake.nix`)).text();
  const archive = archiveSpec(flake, `${process.platform}-${process.arch}`, bend.version);
  const bytes = new Uint8Array(await (await download(archive.url)).arrayBuffer());
  verifyArchive(bytes, archive.sha256);
  const temporary = mkdtempSync(join(tmpdir(), "toph-bend-"));
  try {
    const file = join(temporary, "bend.tar.gz"), unpacked = join(temporary, "unpacked");
    writeFileSync(file, bytes);
    mkdirSync(unpacked);
    const result = Bun.spawnSync(["tar", "-xzf", file, "-C", unpacked, "--strip-components=1"], { stderr: "inherit" });
    if (result.exitCode !== 0) throw new Error("could not extract Bend archive");
    const executable = join(unpacked, "bin/bend");
    const check = Bun.spawnSync([executable, "version"], { timeout: 10000 });
    if (check.exitCode !== 0 || check.stdout.toString().trim() !== `bend ${bend.version}`) {
      throw new Error("installed Bend version check failed");
    }
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(unpacked, destination);
    console.log(`Installed Bend ${bend.version} at ${destination}; SHA-256 ${archive.sha256}`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  if (process.argv.length !== 3) throw new Error("usage: bun scripts/install-bend.ts <destination>");
  await install(resolve(process.argv[2]));
}
