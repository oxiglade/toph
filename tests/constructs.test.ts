import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../src/syntax/build.ts";
import { audit } from "../src/syntax/audit.ts";
import { desugar } from "../src/syntax/desugar.ts";
import { parseModule } from "../src/syntax/parser.ts";

async function compare(surface: string, bend: string, extra?: (dir: string) => void) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "toph-constructs-")));
  try {
    extra?.(dir);
    const input = join(dir, "surface.law"), original = join(dir, "original.bend");
    writeFileSync(input, "import Base\n" + surface);
    writeFileSync(original, "import Base\n" + bend);
    const output = await build(input);
    const result = await audit(original, output);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(r => r.sameType && r.sameBody !== false)).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [op, name] of Object.entries({ "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "<": "is_lt", "<=": "is_le", ">": "is_gt", ">=": "is_ge" })) {
  test(`${op} audits equal to the Base call`, () => compare(
    `law arithmetic:\n  8n ${op} 2n == Nat.${name}(8n, 2n)\n`,
    `law arithmetic:\n  {Nat.${name}(8n, 2n) == Nat.${name}(8n, 2n) : ${name.startsWith("is_") ? "Bool" : "Nat"}}\n`));
}

test("quantities, premises, Boolean lifting, inequality and precedence audit", () => compare(`
law logic(+b: Bool, +c: Bool, -unused: Nat):
  when not (b && c)
  not b & (b || c -> b == c)
law unequal(a: Nat, b: Nat):
  a != b
law precedence:
  1n + 2n * 3n - 4n == 3n
law inferred(x):
  when x >= 0n
  x == x
law fresh(hypothesis0: Bool):
  when hypothesis0
  exs hypothesis1: Nat
  hypothesis1 == 0n
`, `
law logic:
  for +b: Bool
  for +c: Bool
  for -unused: Nat
  for h: {Bool.and(b, c) == False{} : Bool}
  {b == False{} : Bool} & ({Bool.or(b, c) == True{} : Bool} -> {b == c : Bool})
law unequal:
  for a: Nat
  for b: Nat
  {a != b : Nat}
law precedence:
  {Nat.sub(Nat.add(1n, Nat.mul(2n, 3n)), 4n) == 3n : Nat}
law inferred:
  for x: Nat
  for h: {Nat.is_ge(x, 0n) == True{} : Bool}
  {x == x : Nat}
law fresh:
  for hypothesis0: Bool
  for h: {hypothesis0 == True{} : Bool}
  exs hypothesis1: Nat
  {hypothesis1 == 0n : Nat}
`));

test("tuples, annotations, lists, strings, existentials and dependent binders audit", () => compare(`
law tuples:
  (1n, True{}, "a#b") == (1n, True{}, "a#b")
law annotated:
  {0n == 0n : Nat} & (1n : Nat) == 1n
law lists(xs: +List<Nat>):
  List.length(&1, List<Nat>, [1n, 2n] <> []) == 0n
law tail(xs: List<Nat>):
  1n <> xs == 1n <> xs
law text:
  "a" ++ "b" ++ "c" == "abc"
law witnesses:
  exs n: Nat
  exs p: {n == n : Nat}
  n == n
law binders:
  (@n: Nat -> n == n) & (&n: Nat -> n == n)
`, `
law tuples:
  {(1n, True{}, "a#b") == (1n, True{}, "a#b") : Nat & Bool & String}
law annotated:
  {0n == 0n : Nat} & {{1n : Nat} == 1n : Nat}
law lists:
  for xs: +List<Nat>
  {List.length(&1, List<&1, Nat>, [1n, 2n] <> []) == 0n : Nat}
law tail:
  for xs: List<Nat>
  {1n <> xs == 1n <> xs : List<Nat>}
law text:
  {"a" ++ "b" ++ "c" == "abc" : String}
law witnesses:
  exs n: Nat
  exs p: {n == n : Nat}
  {n == n : Nat}
law binders:
  (@n: Nat -> {n == n : Nat}) & (&n: Nat -> {n == n : Nat})
`));

test("helpers, recursive matches, destructuring, nested cases and lambdas audit", () => compare(`
def successor(n: Nat) -> Nat:
  1n+n
def total(pair: Nat & Nat) -> Nat:
  (a, b) = pair
  c: Nat = a + b
  c
def rebuild(n: Nat) -> Nat:
  match n:
    case 0n: 0n
    case 1n+p: 1n+rebuild(p)
def first(xs: List<Nat>) -> Nat:
  match xs:
    case []: 0n
    case x <> rest:
      match rest:
        case []: x
        case y <> tail: y
def apply(f: Nat -> Nat, n: Nat) -> Nat:
  f(n)
def increment(n: Nat) -> Nat:
  apply(x => x + 1n, n)
def choose(a: Bool, b: Bool) -> Bool:
  match a, b:
    case True{}, x: x
    case False{}, _: False{}
law helpers:
  (total((2n, 3n)), increment(4n), rebuild(5n)) == (5n, 5n, 5n)
`, `
def successor(n: Nat) -> Nat:
  1n+n
def total(pair: Nat & Nat) -> Nat:
  (a, b) = pair
  c: Nat = Nat.add(a, b)
  c
def rebuild(n: Nat) -> Nat:
  match n:
    case 0n: 0n
    case 1n+p: 1n+rebuild(p)
def first(xs: List<Nat>) -> Nat:
  match xs:
    case []: 0n
    case x <> rest:
      match rest:
        case []: x
        case y <> tail: y
def apply(f: Nat -> Nat, n: Nat) -> Nat:
  f(n)
def increment(n: Nat) -> Nat:
  apply(x => Nat.add(x, 1n), n)
def choose(a: Bool, b: Bool) -> Bool:
  match a, b:
    case True{}, x: x
    case False{}, _: False{}
law helpers:
  {(total((2n, 3n)), increment(4n), rebuild(5n)) == (5n, 5n, 5n) : Nat & Nat & Nat}
`));

test("field suffixes on expressions audit and share the record projection", () => compare(`import ./records.bend as R
def get(value: R.Counter) -> Nat:
  R.Counter{n} = value
  n
law field:
  R.Counter{3n}.value == 3n
`, `import ./records.bend as R
def get(value: R.Counter) -> Nat:
  R.Counter{n} = value
  n
law field:
  {get(R.Counter{3n}) == 3n : Nat}
`, dir => writeFileSync(join(dir, "records.bend"), "import Base\ntype Counter is Data:\n  Counter{value: Nat}\n")));

test("all supported operators parse with the documented associativity", () => {
  const module = parseModule("law order:\n  a -> b -> c & d & e ++ f ++ g <> h <> i\n", "order.law");
  expect(module.diagnostics).toEqual([]);
  const value = module.declarations[0].body[0];
  if (value.kind !== "expr") throw new Error("expression expected");
  expect(value.value.text).toBe("->");
  expect(value.value.xs[1].text).toBe("->");
});

test("explicit equality and value annotations round-trip through the frontend", async () => {
  const original = "import Base\nlaw identity(n: Nat):\n  {n == n : Nat}\n";
  const generated = await desugar(original, "identity.law");
  const reparsed = parseModule(generated.replace("law identity:\n  for n: Nat", "law identity(n: Nat):"), "roundtrip.law");
  expect(reparsed.diagnostics).toEqual([]);
  expect(await desugar(generated.replace("law identity:\n  for n: Nat", "law identity(n: Nat):"), "roundtrip.law")).toBe(generated);
});

test("generic helper signatures and erased arguments audit", () => compare(`
def identity(-A: Data, x: A) -> A:
  x
def reflexive(-A: Data, +x: A) -> Type:
  x == x
law call:
  identity(2n) == 2n
`, `
def identity(-A: Data, x: A) -> A:
  x
def reflexive(-A: Data, +x: A) -> Type:
  {x == x : A}
law call:
  {identity(Nat, 2n) == 2n : Nat}
`));

test("explicit proof parameters retain structural equality types", () => compare(`
def keep(n: Nat, p: {n == n : Nat}) -> Nat:
  n
law retained(a: Nat, p: {a == a : Nat}):
  keep(a, p) == a
`, `
def keep(n: Nat, p: {n == n : Nat}) -> Nat:
  n
law retained:
  for a: Nat
  for p: {a == a : Nat}
  {keep(a, p) == a : Nat}
`));

test("function-valued fields can be called", () => compare(`import ./records.bend as R
law call:
  R.Action{x => x}.run(1n) == 1n
`, `import ./records.bend as R
law call:
  {1n == 1n : Nat}
`, dir => writeFileSync(join(dir, "records.bend"), "import Base\ntype Action is Type:\n  Action{run: Nat -> Nat}\n")));
