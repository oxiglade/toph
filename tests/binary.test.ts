import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the compiled binary builds and checks outside the repository without Bun on PATH", () => {
  const root = resolve(import.meta.dir, "..");
  const dir = mkdtempSync(join(tmpdir(), "toph-binary-"));
  try {
    const executable = join(dir, "toph");
    const compilation = Bun.spawnSync([process.execPath, "run", "build", "--outfile", executable], { cwd: root });
    expect(compilation.exitCode).toBe(0);
    symlinkSync(Bun.which("bend")!, join(dir, "bend"));
    const run = (...args: string[]) => Bun.spawnSync([executable, ...args], {
      cwd: dir, env: { PATH: dir }, timeout: 10000,
    });
    expect(run("--version").stdout.toString()).toContain("toph 0.1.0 (Bend 2.0.39)");
    copyFileSync(join(import.meta.dir, "fixtures/false.bend"), join(dir, "false.bend"));
    const failure = run("check", "false.bend", "--n", "30", "--json");
    expect(failure.stderr.toString()).toBe("");
    expect(failure.exitCode).toBe(1);
    expect(JSON.parse(failure.stdout.toString()).results.map((r: any) => r.status)).toEqual(["fail", "fail", "fail"]);
    writeFileSync(join(dir, "true.law"), "import Base\nlaw identity(n: Nat):\n  n == n\n");
    expect(run("build", "true.law", "-o", "true.bend").exitCode).toBe(0);
    expect(run("check", "true.bend", "--n", "10").exitCode).toBe(0);
    expect(run("check", "true.law", "--n", "10").exitCode).toBe(0);
    copyFileSync(join(import.meta.dir, "fixtures/loop.bend"), join(dir, "loop.bend"));
    const timeout = run("check", "loop.bend", "--n", "1", "--time", "0.05", "--json");
    expect(timeout.exitCode).toBe(2);
    expect(JSON.parse(timeout.stdout.toString()).results.map((r: any) => r.status)).toEqual(["timeout", "pass"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
