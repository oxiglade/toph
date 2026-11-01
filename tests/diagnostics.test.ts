import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/syntax/build.ts";
import { desugar, desugarMapped } from "../src/syntax/desugar.ts";
import { originAt } from "../src/syntax/source.ts";

const source = "import Base\nlaw conflict:\n  0n == True{}\n";

test("inference errors identify the expression, source line and caret", async () => {
  await expect(desugar(source, "bad.law")).rejects.toThrow("bad.law:3:9");
  await expect(desugar(source, "bad.law")).rejects.toThrow("3>|   0n == True{}\n  |         ^^^^^^");
  await expect(desugar("import Base\nlaw unknown(x):\n  x == x\n", "bad.law")).rejects.toThrow("bad.law:3:3");
  await expect(desugar("import Base\nlaw field(r):\n  r.value == 0n\n", "bad.law")).rejects.toThrow("bad.law:3:3");
});

test("syntax diagnostics include several locations", async () => {
  try {
    await desugar("import Base\nlaw a:\n  when )\n  0n ==\nlaw b:\n  [1n,, 2n]\n", "bad.law");
    throw new Error("expected failure");
  } catch (error) {
    for (const location of ["bad.law:3:8", "bad.law:4:8", "bad.law:6:7"]) expect(String(error)).toContain(location);
  }
});

test("every generated character maps to its source, including inferred arguments", async () => {
  const text = "import Base\nlaw size(xs: +List<Nat>):\n  List.length(xs) == 0n\n";
  const output = await desugarMapped(text, "size.law");
  for (let i = 0; i < output.text.length; i++) expect(originAt(output, i)).toBeDefined();
  const implicit = output.text.indexOf("&2, Nat, xs");
  expect(implicit).toBeGreaterThan(0);
  expect(originAt(output, implicit)?.start).toBe(text.indexOf("List.length"));
});

test("build and check show Bend recursion errors at law expressions", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-locations-")));
  try {
    const file = join(dir, "bad.law");
    writeFileSync(file, "import Base\ndef twice(n: Nat) -> Nat:\n  twice(n)\nlaw identity:\n  0n == 0n\n");
    await expect(build(file)).rejects.toThrow("bad.law:3:");
    await expect(build(file)).rejects.toThrow("Generated Bend:");
    for (const command of ["build", "check"]) {
      const result = Bun.spawnSync(["bun", "src/cli.ts", command, file]);
      const stderr = result.stderr.toString();
      expect(result.exitCode).toBe(2);
      expect(stderr).toContain("bad.law:3:");
      expect(stderr).toContain("3>|   twice(n)");
      expect(stderr).toContain("Generated Bend:");
      expect(stderr).toContain("twice(n)");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Bend errors in imported law helpers retain the helper origin", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-helper-error-")));
  try {
    writeFileSync(join(dir, "helper.law"), "import Base\ndef twice(n: Nat) -> Nat:\n  twice(n)\n");
    writeFileSync(join(dir, "main.law"), "import Base\nimport ./helper.law as H\nlaw identity:\n  H.twice(0n) == 0n\n");
    await expect(build(join(dir, "main.law"))).rejects.toThrow("helper.law:3:");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("source maps cover EOF and distinguish identical modules", async () => {
  const { B } = await import("../src/bend.ts");
  const { mapped, bendError } = await import("../src/syntax/source.ts");
  const text = "def value() -> Nat:\n  )";
  const first = { ...mapped(text, { source: { file: "first.law", text }, start: 22, end: 23 }), namespace: "First" };
  const second = { ...mapped(text, { source: { file: "second.law", text }, start: 22, end: 23 }), namespace: "Second" };
  expect(originAt(second, text.length)?.source.file).toBe("second.law");
  try { B.parse_book(B.book_nil(), "", text, "Second", {}); }
  catch (error) { expect(bendError(error, [first, second]).message).toContain("second.law:2:3"); }
});

test("generated projection errors point back to the field access", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-field-error-")));
  try {
    writeFileSync(join(dir, "records.bend"), "import Base\ntype Hidden is Data:\n  Hidden{-value: Nat}\n");
    writeFileSync(join(dir, "main.law"), "import Base\nimport ./records.bend as R\nlaw hidden(r: R.Hidden):\n  r.value == 0n\n");
    await expect(build(join(dir, "main.law"))).rejects.toThrow("main.law:4:3");
    await expect(build(join(dir, "main.law"))).rejects.toThrow("Generated Bend:");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Bend quantity errors map to the declared binder", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-quantity-error-")));
  try {
    writeFileSync(join(dir, "main.law"), "import Base\ndef twice(n: Nat) -> Nat:\n  n + n\n");
    await expect(build(join(dir, "main.law"))).rejects.toThrow("main.law:2:11");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("build saves complete maps for relocated output and companion modules", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-saved-maps-")));
  try {
    writeFileSync(join(dir, "helper.law"), "import Base\ndef value() -> Nat:\n  1n\n");
    writeFileSync(join(dir, "main.law"), "import Base\nimport ./helper.law as H\nlaw same:\n  H.value() == 1n\n");
    const output = await build(join(dir, "main.law"), join(dir, "nested", "generated.bend"));
    const map = JSON.parse(readFileSync(output + ".map.json", "utf8"));
    const generated = readFileSync(output, "utf8");
    expect(map.version).toBe(1);
    expect(map.sources).toEqual(["../main.law"]);
    expect(map.sourcesContent[0]).toContain("H.value() == 1n");
    for (let i = 0; i < generated.length; i++) expect(map.mappings.some((m: any) => m.start <= i && m.end > i)).toBe(true);
    expect(map.mappings.at(-1).end).toBe(generated.length);
    const helper = generated.match(/import \.\/(generated_\w+\.bend) as H/)![1];
    const helperMap = JSON.parse(readFileSync(join(dir, "nested", helper + ".map.json"), "utf8"));
    expect(helperMap.sources).toEqual(["../helper.law"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
