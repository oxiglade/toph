import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pkg from "../package.json";

const root = resolve(import.meta.dir, "..");
const version = pkg.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("invalid package version");
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "v" + version)) {
  throw new Error(`release tag must match package.json: v${version}`);
}
const bunVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
if (Bun.version !== bunVersion) throw new Error(`release builds require Bun ${bunVersion}; found ${Bun.version}`);
const targets = [
  ["macos-arm64", "bun-darwin-arm64"],
  ["macos-x64", "bun-darwin-x64-baseline"],
  ["linux-x64", "bun-linux-x64-baseline"],
  ["linux-arm64", "bun-linux-arm64"],
];
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });
const stage = mkdtempSync(join(dist, ".release-"));
try {
  const sums: string[] = [];
  for (const [platform, target] of targets) {
    const name = `toph-${version}-${platform}`;
    const output = join(stage, name);
    const result = Bun.spawnSync([process.execPath, "build", "--compile", "--target=" + target,
      "src/cli.ts", "src/check/worker.ts", "--outfile", output], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (result.exitCode !== 0) throw new Error(`build failed for ${target} (exit ${result.exitCode})`);
    sums.push(`${createHash("sha256").update(readFileSync(output)).digest("hex")}  ${name}\n`);
    console.log(`${name}: ${statSync(output).size} bytes`);
  }
  writeFileSync(join(stage, "SHA256SUMS"), sums.join(""));
  const destination = join(dist, "release");
  rmSync(destination, { recursive: true, force: true });
  renameSync(stage, destination);
  console.log("Release files: " + destination);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
