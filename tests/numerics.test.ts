import { beforeAll, expect, test } from "bun:test";
import { B, show, type Term } from "../src/bend.ts";
import { accelerate } from "../src/check/numerics.ts";
import { checkLaw, load, replayLaw } from "../src/check/engine.ts";

let plain: any, fast: any;
beforeAll(async () => {
  plain = B.book_nil();
  await B.book_load(plain, B.BASE_BEND, "", new Map());
  B.book_valid(plain);
  fast = await accelerate(plain);
});

const values = [0, 1, 31, 65537, 0x80000000, 0xffffffff];
const call = (name: string, args: Term[]) => args.reduce((f, x) => B.App(f, x), B.Ref("U32." + name));

function matches(name: string, args: Term[], kind: "U32" | "Bool") {
  const result = B.term_wnf(fast, call(name, args));
  if (kind === "U32") expect(result.$).toBe("Lit");
  const expected = B.term_snf(plain, call(name, args));
  if (kind === "U32") {
    expect(result.k).toBe("U32");
    expect(result.v).toBe(B.u32_from_term(expected));
  } else {
    expect(show(result)).toBe(show(expected));
  }
}

for (const name of ["add", "sub", "mul", "div", "mod", "min", "max", "and", "or", "xor",
  "is_eq", "is_ne", "is_lt", "is_le", "is_gt", "is_ge"]) {
  test(`concrete U32.${name} matches the normalizer at boundaries`, () => {
    for (const a of values) for (const b of values) {
      matches(name, [B.Lit("U32", a), B.Lit("U32", b)], name.startsWith("is_") ? "Bool" : "U32");
    }
  });
}

for (const name of ["inc", "not", "shl", "shr", "is_zero"]) {
  test(`concrete U32.${name} matches the normalizer at boundaries`, () => {
    for (const a of values) matches(name, [B.Lit("U32", a)], name === "is_zero" ? "Bool" : "U32");
  });
}

for (const name of ["shln", "shrn"]) {
  test(`U32.${name} uses Nat shift counts without masking at 32`, () => {
    for (const a of values) for (const n of [0, 1, 31, 32, 33, 64]) {
      matches(name, [B.Lit("U32", a), B.Lit("Nat", n)], "U32");
    }
  });
}

test("U32 acceleration handles constructor words and computed arguments", () => {
  const word = B.lit_step(B.Lit("U32", 0xffffffff));
  matches("mul", [word, call("add", [B.Lit("U32", 1), B.Lit("U32", 1)])], "U32");
  matches("shln", [word, B.Ctr("Succ", [B.Ctr("Zero", [])])], "U32");
});

test("open U32 arguments resume after falling back to Bend evaluation", () => {
  for (const name of ["add", "mul", "shln"]) {
    const x = B.Var("x", 0);
    const args = [B.Lit("U32", 1), x];
    const suspended = B.term_wnf(fast, call(name, args));
    expect(suspended.$).not.toBe("Lit");
    x.v = B.Lit(name === "shln" ? "Nat" : "U32", 3);
    expect(B.u32_from_term(B.term_snf(fast, suspended)))
      .toBe(B.u32_from_term(B.term_snf(plain, call(name, args))));
  }
});

test("a computed U32 with an open shift count stays suspended", () => {
  const n = B.Var("n", 0);
  const term = call("add", [call("shln", [B.Lit("U32", 1), n]), B.Lit("U32", 1)]);
  const suspended = B.term_wnf(fast, term);
  expect(suspended.$).not.toBe("Lit");
  n.v = B.Lit("Nat", 3);
  expect(B.u32_from_term(B.term_snf(fast, suspended))).toBe(9);
});

test("U32 counterexamples replay against the untouched normalizer", async () => {
  const program = await load(`${import.meta.dir}/fixtures/u32.bend`);
  const result = checkLaw(program, "false_add", { n: 100, seed: 42, time: 10 });
  expect(result.status).toBe("fail");
  expect(result.replayed).toBe(true);
  expect(replayLaw(program, result.law, result.witness!)).toBe("fail");
});

test("U32 acceleration disagreements cannot report a counterexample", async () => {
  const program = await load(`${import.meta.dir}/fixtures/u32.bend`);
  program.book.tlds["U32.add"] = { ...program.book.tlds["U32.add"],
    v: B.Lam("a", 0, () => B.Lam("b", 1, () => B.Lit("U32", 0))) };
  const result = checkLaw(program, "add_one", { n: 100, seed: 42, time: 10 });
  expect(result.status).toBe("unknown");
  expect(result.reason).toContain("replay");
  expect(result.witness).toBeUndefined();
  expect(result.bindings).toBeUndefined();
});
