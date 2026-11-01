import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("usage: bun scripts/vendor-bend.ts vX.Y.Z");
const repository = "https://github.com/bendlang/bend";
const temporary = mkdtempSync(join(tmpdir(), "toph-vendor-"));
const destination = resolve(import.meta.dir, "../vendor/bend");
mkdirSync(dirname(destination), { recursive: true });
const staged = mkdtempSync(join(dirname(destination), ".bend-"));

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", temporary, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

try {
  git("init", "--quiet");
  git("fetch", "--quiet", "--depth=1", repository, "refs/tags/" + tag);
  const commit = git("rev-parse", "FETCH_HEAD^{commit}");
  git("checkout", "--quiet", "--detach", commit);
  const version = /const VERSION = "([^"]+)"/.exec(readFileSync(join(temporary, "bend2/main.ts"), "utf8"))?.[1];
  if (tag !== "v" + version) throw new Error("tag and compiler version disagree");
  const files = ["bend.ts", "comp.ts", "main.ts", "safe.ts", "base.bend"];
  const hashes: Record<string, string> = {};
  for (const file of files) {
    let source = readFileSync(join(temporary, "bend2", file), "utf8");
    hashes[file] = createHash("sha256").update(source).digest("hex");
    if (file === "bend.ts") {
      const original = /export const BEND_DIR = import\.meta\.url\.startsWith\("file:\/\/\/\$bunfs\/"\)[\s\S]*?export const BASE_BEND = fs\.realpathSync\(path\.join\(BEND_DIR, "base\.bend"\)\);/;
      if (!original.test(source)) throw new Error("Bend asset layout changed; update the embedding patch");
      source = 'import basePath from "./base.bend" with { type: "file" };\n' + source.replace(original,
        'export const BEND_DIR = path.dirname(basePath);\nexport const BASE_BEND = basePath;');
      const realpath = "return fs.realpathSync(file);";
      if (!source.includes(realpath)) throw new Error("Bend file loading changed; update the embedding patch");
      source = source.replace(realpath, "return file === BASE_BEND ? file : fs.realpathSync(file);");
    }
    writeFileSync(join(staged, file), source);
  }
  writeFileSync(join(staged, "LICENSE"), readFileSync(join(temporary, "LICENSE")));
  writeFileSync(join(staged, "version.json"), JSON.stringify({ repository, tag, commit, version, upstreamSha256: hashes }, null, 2) + "\n");
  writeFileSync(join(staged, "NOTICE"), `Bend ${version}\nSource: ${repository}/tree/${commit}\nTag: ${tag}\n\nCopied bend2/{bend.ts,comp.ts,main.ts,safe.ts,base.bend} and LICENSE.\nBend is licensed under Apache-2.0; see LICENSE.\n\nToph modifies bend.ts only to import base.bend as a Bun file asset,\nresolve BEND_DIR and BASE_BEND from that asset, and skip realpath for\nBase (Bun's embedded files are not filesystem symlinks). This embeds\nBase in the standalone executable. All other copied files are unchanged.\n\nRefresh: bun scripts/vendor-bend.ts ${tag}\nversion.json records the commit, version and unmodified source hashes.\n`);
  rmSync(destination, { recursive: true, force: true });
  renameSync(staged, destination);
  console.log(`Vendored Bend ${version} (${commit}).`);
} finally {
  rmSync(staged, { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}
