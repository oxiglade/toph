import { expect, test } from "bun:test";
import { B, show } from "../src/bend.ts";
import { load } from "../src/check/engine.ts";
import { Generator, Random } from "../src/check/generate.ts";

test("indexed constructors generate only inhabited, well-typed values", async () => {
  const { book } = await load(`${import.meta.dir}/fixtures/bend/proof_typed_eval/LAWS.bend`, false);
  const constructors = new Set<string>();
  for (const kind of ["main:TNum", "main:TBool"]) {
    const type = B.ADT("main:Expr", [B.Ctr(kind, [])]);
    const rng = new Random(42);
    for (let i = 0; i < 40; i++) {
      const value = new Generator(book, rng, false).value(type);
      B.term_check(book, { t: B.Ref("opt_sound"), n: 0, def: "opt_sound", qs: [] }, value, B.Lone(), type, B.ctx_nil(), 0);
      constructors.add(value.k);
    }
  }
  expect([...constructors].sort()).toEqual(["main:Add", "main:Bit", "main:If", "main:IsZero", "main:Num"]);
});

test("constructor equalities determine earlier fields before recursive generation", async () => {
  const { book } = await load(`${import.meta.dir}/fixtures/indexed.bend`, false);
  for (const n of [0, 1, 2, 4]) {
    const type = B.ADT("Vec", [B.Lit("Nat", n)]);
    for (let seed = 0; seed < 10; seed++) {
      const value = new Generator(book, new Random(seed), false).value(type);
      B.term_check(book, { t: B.Ref("indexed_identity"), n: 0, def: "indexed_identity", qs: [] }, value, B.Lone(), type, B.ctx_nil(), 0);
      expect(show(value).match(/VCon/g)?.length ?? 0).toBe(n);
    }
  }
});

test("bounded generation prefers terminating constructors over smaller recursive ones", async () => {
  const { book } = await load(`${import.meta.dir}/fixtures/indexed.bend`, false);
  const value = new Generator(book, new Random(19), false).value(B.ADT("Tree", []));
  expect(show(value)).toContain("Leaf");
});

test("equality aliases fill later fields before generating their dependents", async () => {
  const { book } = await load(`${import.meta.dir}/fixtures/indexed.bend`, false);
  const type = B.ADT("Alias", []);
  const value = new Generator(book, new Random(19), false).value(type);
  B.term_check(book, { t: B.Ref("indexed_identity"), n: 0, def: "indexed_identity", qs: [] }, value, B.Lone(), type, B.ctx_nil(), 0);
  expect(value.k).toBe("Alias");
});
