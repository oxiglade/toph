import { expect, test } from "bun:test";
import { parseModule } from "../src/syntax/parser.ts";

test("module parser keeps offsets through comments and multiline syntax", () => {
  const source = 'import Base # base\r\n\r\nlaw same(\r\n  +x: Nat,\r\n):\r\n  when x >= 0n # premise\r\n  (x +\r\n    1n) == 1n+x\r\n';
  const module = parseModule(source, "example.law");
  expect(module.diagnostics).toEqual([]);
  const law = module.declarations[0];
  expect(law.kind).toBe("law");
  expect(source.slice(law.span.start, law.span.start + 3)).toBe("law");
  expect(law.parameters[0].name).toBe("x");
});

test("syntax recovery reports independent mistakes without swallowing the next law", () => {
  const source = 'import Base\nlaw broken(x,, y):\n  x ==\nlaw second:\n  when )\n  [1n,, 2n] == []\nlaw good:\n  0n == 0n\n';
  const module = parseModule(source, "broken.law");
  expect(module.diagnostics.length).toBeGreaterThanOrEqual(3);
  expect(module.declarations.at(-1)?.name).toBe("good");
  expect(module.diagnostics.map(d => d.span.start)).toEqual([...module.diagnostics.map(d => d.span.start)].sort((a, b) => a - b));
});

test("parser handles typed helpers, nested cases, patterns and trailing comments", () => {
  const source = `import Base
def count(xs: +List<Nat>) -> Nat:
  match xs:
    case []: 0n
    case x <> rest:
      y = x + 1n
      match rest:
        case []: y
        case z <> tail: z
law same(xs: +List<Nat>):
  count(xs) == count(xs) # done
`;
  expect(parseModule(source, "helpers.law").diagnostics).toEqual([]);
});

test("unrecognized declarations, unterminated strings and missing delimiters are errors", () => {
  for (const source of ['type R is Data:\n  R{}\n', 'law x:\n  "oops\n', 'law x:\n  (0n == 0n\nlaw y:\n  1n == 1n\n', 'law x(a b):\n  a == b\n']) {
    expect(parseModule(source, "bad.law").diagnostics.length).toBeGreaterThan(0);
  }
});

test("recovery preserves a declaration reached before an error", () => {
  for (const prefix of ["law empty:\n", "law repeat:\n  0n == 0n\nlaw repeat:\n  0n == 0n\n", "def empty() -> Nat:\n  )\n"]) {
    const module = parseModule(prefix + "law good:\n  1n == 1n\n", "recover.law");
    expect(module.diagnostics.length).toBeGreaterThan(0);
    expect(module.declarations.at(-1)?.name).toBe("good");
  }
});

test("import paths can contain keyword directories", () => {
  const module = parseModule("import ./as/helper.law as H\n", "imports.law");
  expect(module.diagnostics).toEqual([]);
  expect(module.imports[0].path).toBe("./as/helper.law");
});

test("tuples require two elements and type arguments accept a trailing comma", () => {
  expect(parseModule("law bad:\n  (0n,) == 0n\n", "tuple.law").diagnostics.length).toBeGreaterThan(0);
  expect(parseModule("law list(xs: List<Nat,>):\n  xs == xs\n", "list.law").diagnostics).toEqual([]);
});

test("existentials keep Bend's affine quantity", () => {
  for (const body of ["exs +n: Nat\n  n == n", "exs -n: Nat\n  n == n", "&+n: Nat -> n == n"]) {
    expect(parseModule("law witness:\n  " + body + "\n", "witness.law").diagnostics.length).toBeGreaterThan(0);
  }
});
