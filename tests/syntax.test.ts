import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
    const { runFile } = await import("../src/check/run.ts");
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
