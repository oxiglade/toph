import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function cli(args: string[], env = process.env) {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], { env });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

test("CLI reports version, selected counterexamples and invalid options", () => {
  expect(cli(["--version"]).out).toContain("toph 0.1.0 (Bend 2.0.39)");
  const result = cli(["check", join(import.meta.dir, "fixtures/false.bend"), "--law", "positive_is_zero", "--n", "30"]);
  expect(result.code).toBe(1);
  expect(result.out).toContain("n = 1n");
  expect(result.out).not.toContain("successor_is_identity");
  expect(cli(["check", "missing.bend", "--n", "0"]).code).toBe(2);
  for (const [flag, value] of [["--file-time", "0"], ["--samples", "0"], ["--size", "-1"]]) {
    expect(cli(["check", "missing.bend", flag, value]).err).toContain("invalid value");
  }
});

test("an incompatible Bend is refused before reading input", () => {
  const dir = mkdtempSync(join(tmpdir(), "toph-version-"));
  try {
    writeFileSync(join(dir, "bend"), "#!/bin/sh\necho 'bend 2.0.38'\n");
    chmodSync(join(dir, "bend"), 0o755);
    const result = cli(["check", "missing.bend"], { ...process.env, PATH: dir });
    expect(result.code).toBe(2);
    expect(result.err).toContain("requires Bend 2.0.39");
    expect(result.err).toContain("found 2.0.38");
    expect(cli(["--version"], { ...process.env, PATH: "" }).err).toContain("bend was not found");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("build writes plain Bend and check accepts law source without writing beside it", () => {
  const dir = mkdtempSync(join(tmpdir(), "toph-cli-"));
  try {
    const input = join(dir, "counterexample.law");
    writeFileSync(input, "import Base\nlaw wrong(n: Nat):\n  1n+n == n\n");
    expect(cli(["build", input, "-o", join(dir, "generated.bend")]).code).toBe(0);
    const result = cli(["check", input, "--json", "--n", "10"]);
    expect(result.code).toBe(1);
    const report = JSON.parse(result.out);
    expect(report.file).toBe(input);
    expect(report.results[0].bindings).toEqual({ n: "0n" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
