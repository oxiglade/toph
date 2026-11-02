import { expect, test } from "bun:test";
import { runFile } from "../src/check/run.ts";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build } from "../src/syntax/build.ts";
import { audit } from "../src/syntax/audit.ts";
import { desugar } from "../src/syntax/desugar.ts";

const demos = { proof_insertion_sort: 2, proof_numerics: 5, app_pong_game_2d: 2,
  proof_typed_eval: 2, io_hello_world: 1, io_http_fetch: 2 };

for (const [demo, count] of Object.entries(demos)) {
  test(`${demo}: generated laws equal the originals and their proofs still check`, async () => {
    const source = join(import.meta.dir, "fixtures/bend", demo);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-audit-")));
    try {
      const output = join(dir, "LAWS.bend");
      await build(join(source, "LAWS.law"), output);
      const results = await audit(join(source, "LAWS.bend"), output);
      expect(results.length).toBe(count);
      expect(results.every(r => r.sameType && r.sameBody !== false)).toBe(true);
      const proof = readFileSync(join(source, "PROOF.bend"), "utf8").replace(
        /^(import )\.\/main.bend( as .*?)$/gm, `$1${relative(dir, join(source, "main.bend"))}$2`);
      writeFileSync(join(dir, "PROOF.bend"), proof);
      for (const path of [join(source, "PROOF.bend"), join(dir, "PROOF.bend")]) {
        const result = Bun.spawnSync(["bend", path, "--check-only"]);
        expect(result.stderr.toString()).toBe("");
        expect(result.exitCode).toBe(0);
        if (process.env.TOPH_VERDICT === "1") {
          const verdict = Bun.spawnSync(["bend", path, "--verdict"], { timeout: 60000 });
          expect(verdict.stderr.toString()).toBe("");
          expect(verdict.exitCode).toBe(0);
          expect(verdict.stdout.toString()).toContain("ALL PROOFS CHECK");
        }
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120000);
}

test("inference rejects incompatible tuples, witnesses and dependent indices", async () => {
  const file = join(import.meta.dir, "fixtures/bend/proof_typed_eval/LAWS.law");
  for (const body of ["(0n, True{}) == (False{}, 0n)", "((0n, True{}), 0n) == (0n, True{}, 0n)", "exs p: String\n  p == 0n"]) {
    await expect(desugar("import Base\nlaw bad:\n  " + body + "\n", file)).rejects.toThrow("type mismatch");
  }
  await expect(desugar("import Base\nimport ./main.bend as TE\nlaw bad(t, u, e, f):\n  TE.eval(t, e) == TE.eval(u, f)\n", file)).rejects.toThrow("type mismatch");
  await expect(desugar("import Base\nlaw ambiguous(x):\n  x == x\n", file)).rejects.toThrow("unresolved");
});

test("law imports share projections and separate builds keep their own fields", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-fields-")));
  try {
    writeFileSync(join(dir, "records.bend"), "import Base\ntype Counter is Data:\n  Counter{value: Nat}\n");
    writeFileSync(join(dir, "helper.law"), "import Base\nimport ./records.bend as R\ndef value(c: R.Counter) -> Nat:\n  c.value\n");
    writeFileSync(join(dir, "LAWS.law"), "import Base\nimport ./records.bend as R\nimport ./helper.law as H\nlaw projection(+c: R.Counter):\n  c.value == H.value(c)\n");
    const output = await build(join(dir, "LAWS.law"));
    expect((await runFile(output, { n: 30, seed: 42, time: 5 })).results[0].status).toBe("pass");
    writeFileSync(join(dir, "other.law"), "import Base\nlaw independent:\n  1n == 1n\n");
    await build(join(dir, "other.law"));
    expect(readFileSync(join(dir, "other.bend"), "utf8")).not.toContain("Fields");
    expect(existsSync(join(dir, "other_fields.bend"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("build rejects cycles and does not overwrite an imported implementation", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-build-errors-")));
  try {
    writeFileSync(join(dir, "cycle.law"), "import ./cycle.law as C\nlaw x:\n  Unit\n");
    await expect(build(join(dir, "cycle.law"))).rejects.toThrow("cycle");
    const implementation = "import Base\ndef value() -> Nat:\n  1n\n";
    writeFileSync(join(dir, "main.bend"), implementation);
    writeFileSync(join(dir, "LAWS.law"), "import Base\nimport ./main.bend as M\nlaw same:\n  M.value() == 1n\n");
    await expect(build(join(dir, "LAWS.law"), join(dir, "main.bend"))).rejects.toThrow("overwrite an input");
    expect(readFileSync(join(dir, "main.bend"), "utf8")).toBe(implementation);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test.each(["direct", "transitive"])("generated modules cannot hide a %s imported output", async kind => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-overlay-input-")));
  try {
    writeFileSync(join(dir, "records.bend"), "import Base\ntype Counter is Data:\n  Counter{value: Nat}\n");
    writeFileSync(join(dir, "helper.law"), "import Base\nimport ./records.bend as R\ndef value(c: R.Counter) -> Nat:\n  c.value\n");
    const input = join(dir, "LAWS.law");
    const source = "import Base\nimport ./helper.law as H\nimport ./records.bend as R\nlaw same(+c: R.Counter):\n  H.value(c) == c.value\n";
    writeFileSync(input, source);
    await build(input);
    const fields = join(dir, "LAWS_fields.bend");
    const original = readFileSync(fields, "utf8") + "def sentinel() -> Nat:\n  99n\n";
    writeFileSync(fields, original);
    writeFileSync(join(dir, "bridge.bend"), "import ./LAWS_fields.bend as F\n");
    writeFileSync(input, source.replace("law same", `import ./${kind === "direct" ? "LAWS_fields" : "bridge"}.bend as F\nlaw same`));
    await expect(build(input)).rejects.toThrow("overwrite an input");
    expect(readFileSync(fields, "utf8")).toBe(original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("premises, Boolean lifting and erased List arguments keep their meaning", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-premises-")));
  try {
    const source = "import Base\n\nlaw positive(+n):\n  when n > 0n\n  n == 0n\n\nlaw negative(b: Bool):\n  when not b\n  b == False{}\n\nlaw length(xs: List<&2, Nat>):\n  List.length(xs) == List.length(&2, Nat, xs)\n";
    writeFileSync(join(dir, "LAWS.law"), source);
    const output = await build(join(dir, "LAWS.law"));
    const results = (await runFile(output, { n: 50, seed: 42, time: 5 })).results;
    expect(results.map(r => r.status)).toEqual(["fail", "pass", "pass"]);
    expect(results[0].bindings).toEqual({ n: "1n" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("audit detects changed and missing laws", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-audit-negative-")));
  try {
    const original = join(dir, "original.bend"), generated = join(dir, "generated.bend");
    writeFileSync(original, "import Base\nlaw value:\n  {0n == 0n : Nat}\n");
    writeFileSync(generated, "import Base\nlaw value:\n  {0n == 1n : Nat}\n");
    expect((await audit(original, generated))[0].sameType).toBe(false);
    writeFileSync(generated, "import Base\n");
    await expect(audit(original, generated)).rejects.toThrow("missing generated definition");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("law imports through symlinks resolve to the compiled helper", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-import-link-")));
  try {
    writeFileSync(join(dir, "helper.law"), "import Base\ndef value() -> Nat:\n  1n\n");
    symlinkSync("helper.law", join(dir, "alias.law"));
    writeFileSync(join(dir, "LAWS.law"), "import Base\nimport ./alias.law as H\nlaw value:\n  H.value() == 1n\n");
    const output = await build(join(dir, "LAWS.law"));
    expect((await runFile(output, { n: 10, seed: 42, time: 5 })).results[0].status).toBe("pass");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("build refuses source-map symlinks to source files before writing outputs", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-map-link-")));
  try {
    const input = join(dir, "source.law"), output = join(dir, "generated.bend");
    const source = "import Base\nlaw identity(n: Nat):\n  n == n\n";
    writeFileSync(input, source);
    symlinkSync(input, output + ".map.json");
    await expect(build(input, output)).rejects.toThrow("overwrite an input");
    expect(readFileSync(input, "utf8")).toBe(source);
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test.each(["hardlink", "dangling symlink", "directory"])("build rejects a source-map %s before writing outputs", async kind => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-map-alias-")));
  try {
    const input = join(dir, "source.law"), output = join(dir, "generated.bend"), map = output + ".map.json";
    const source = "import Base\nlaw identity(n: Nat):\n  n == n\n";
    writeFileSync(input, source);
    if (kind === "hardlink") linkSync(input, map);
    else if (kind === "dangling symlink") symlinkSync(output, map);
    else mkdirSync(map);
    await expect(build(input, output)).rejects.toThrow();
    expect(readFileSync(input, "utf8")).toBe(source);
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("import aliases may have names inherited by JavaScript objects", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-alias-")));
  try {
    writeFileSync(join(dir, "helper.bend"), "import Base\ndef value() -> Nat:\n  1n\n");
    for (const alias of ["constructor", "toString", "__proto__"]) {
      writeFileSync(join(dir, "source.law"), `import Base\nimport ./helper.bend as ${alias}\nlaw same:\n  ${alias}.value() == 1n\n`);
      const output = await build(join(dir, "source.law"));
      expect((await runFile(output, { n: 1, seed: 42, time: 5 })).results[0].status).toBe("pass");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
