import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function cli(args: string[], env = process.env) {
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
    expect(cli(["check", "missing.bend"], { ...process.env, PATH: "" }).err).toContain("bend was not found");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("help and version work without Bend, including command-specific help", () => {
  const env = { ...process.env, PATH: "" };
  for (const args of [[], ["help"], ["--help"], ["check", "--help"], ["build", "--help"], ["--version"]]) {
    const result = cli(args, env);
    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toContain("toph");
  }
  const help = cli(["help"], env).out;
  for (const flag of ["--law", "--n", "--samples", "--size", "--seed", "--time", "--file-time", "--json", "-o", "--help", "--version"]) {
    expect(help).toContain(flag);
  }
  for (const command of ["check", "build"]) expect(cli([command, "--help"], env).out).toContain("Exit codes:");
});

test("help and version reject extra arguments instead of hiding mistakes", () => {
  for (const args of [["help", "typo"], ["--help", "typo"], ["--version", "typo"], ["build", "--help", "typo"], ["check", "--help", "typo"]]) {
    expect(cli(args).code).toBe(2);
  }
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

for (const command of ["build", "check"]) {
  for (const location of ["dot.test", ".local", "read-only dotted TMPDIR"]) {
    test(`${command} resolves law helpers under ${location}`, () => {
      const root = mkdtempSync(join(tmpdir(), "toph-paths-"));
      const temporary = join(root, location === "read-only dotted TMPDIR" ? "temp.dir" : "tmp");
      const project = join(root, location === "read-only dotted TMPDIR" ? "plain" : location, "project");
      mkdirSync(temporary);
      mkdirSync(project, { recursive: true });
      try {
        if (location === "read-only dotted TMPDIR") chmodSync(temporary, 0o555);
        writeFileSync(join(project, "main.bend"), "import Base\ntype Counter is Data:\n  Counter{value: Nat}\n");
        writeFileSync(join(project, "helper.law"), "import Base\nimport ./main.bend as M\ndef value(c: M.Counter) -> Nat:\n  c.value\n");
        writeFileSync(join(project, "LAWS.law"), "import Base\nimport ./main.bend as M\nimport ./helper.law as H\nlaw projection(+c: M.Counter):\n  H.value(c) == c.value\n");
        const input = join(project, "LAWS.law");
        const output = join(project, "LAWS.bend");
        const before = readdirSync(project).sort();
        const env = { ...process.env, TMPDIR: temporary };
        const result = cli(command === "build" ? [command, input, "-o", output]
          : [command, input, "--json", "--n", "10"], env);
        expect(result.err).toBe("");
        expect(result.code).toBe(0);
        if (command === "build") {
          expect(readFileSync(output, "utf8")).toContain("import ./main.bend as M\n");
          const checked = cli(["check", output, "--json", "--n", "10"], env);
          expect(checked.err).toBe("");
          expect(checked.code).toBe(0);
          expect(JSON.parse(checked.out).results.map((r: any) => r.status)).toEqual(["pass"]);
        } else {
          expect(JSON.parse(result.out).results.map((r: any) => r.status)).toEqual(["pass"]);
          expect(readdirSync(project).sort()).toEqual(before);
        }
        expect(readdirSync(temporary)).toEqual([]);
      } finally {
        chmodSync(temporary, 0o755);
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}

test.each(["main.law", "some.source.law"])("check %s does not require an output filename or overwrite its implementation", name => {
  const dir = mkdtempSync(join(tmpdir(), "toph-check-name-"));
  try {
    const implementation = "import Base\ndef value() -> Nat:\n  1n\n";
    writeFileSync(join(dir, "main.bend"), implementation);
    writeFileSync(join(dir, name), "import Base\nimport ./main.bend as M\nlaw same:\n  M.value() == 1n\n");
    const result = cli(["check", join(dir, name), "--json"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).results.map((r: any) => r.status)).toEqual(["pass"]);
    expect(readFileSync(join(dir, "main.bend"), "utf8")).toBe(implementation);
    expect(readdirSync(dir).sort()).toEqual(["main.bend", name].sort());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("build validates final import paths before writing outputs", () => {
  const root = mkdtempSync(join(tmpdir(), "toph-final-imports-"));
  const source = join(root, "dot.test");
  const temporary = join(source, "tmp");
  const output = join(root, "LAWS.bend");
  mkdirSync(temporary, { recursive: true });
  try {
    writeFileSync(join(source, "main.bend"), "import Base\ndef value() -> Nat:\n  1n\n");
    writeFileSync(join(source, "LAWS.law"), "import Base\nimport ./main.bend as M\nlaw same:\n  M.value() == 1n\n");
    const result = cli(["build", join(source, "LAWS.law"), "-o", output], { ...process.env, TMPDIR: temporary });
    expect(result.code).toBe(2);
    expect(result.err).toContain("import path of plain names");
    expect(readdirSync(root)).toEqual(["dot.test"]);
    expect(readdirSync(temporary)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the file deadline interrupts law compilation and removes its temporary files", () => {
  const dir = mkdtempSync(join(tmpdir(), "toph-compile-deadline-"));
  try {
    writeFileSync(join(dir, "loop.bend"), "import Base\n@unsafe def spin() -> Type:\n  spin()\ndef problematic() -> spin():\n  0n\n");
    writeFileSync(join(dir, "source.law"), "import Base\nimport ./loop.bend as L\nlaw ok:\n  Unit\n");
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"),
      "check", join(dir, "source.law"), "--file-time", "0.1"], { env: { ...process.env, TMPDIR: dir }, timeout: 3000 });
    expect(result.exitCode).toBe(2);
    expect(result.signalCode).toBeUndefined();
    expect(result.stderr.toString()).toContain("time budget exhausted");
    expect(readdirSync(dir).sort()).toEqual(["loop.bend", "source.law"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 5000);
