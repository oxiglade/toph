import { expect, test } from "bun:test";
import { checkLaw, load, replayLaw } from "../src/check/engine.ts";
import { runFile } from "../src/check/run.ts";
import { B } from "../src/bend.ts";

const options = { n: 100, seed: 42, time: 10 };
const fixture = (name: string) => `${import.meta.dir}/fixtures/${name}.bend`;

test("a counterexample is withheld when unaccelerated replay disagrees", async () => {
  const program = await load(fixture("replay"));
  program.book.tlds["Nat.add"] = { ...program.book.tlds["Nat.add"],
    v: B.Lam("a", 0, () => B.Lam("b", 1, () => B.Lit("Nat", 0))) };
  const result = checkLaw(program, "successor", options);
  expect(result.status).toBe("unknown");
  expect(result.reason).toContain("replay");
  expect(result.bindings).toBeUndefined();
  expect(result.witness).toBeUndefined();
});

test("typed evaluator laws compare data with equality evidence", async () => {
  const program = await load(`${import.meta.dir}/fixtures/bend/proof_typed_eval/LAWS.bend`);
  for (const name of program.laws) expect(checkLaw(program, name, options).status).toBe("pass");
});

test("existentials solve joint equalities and search without treating exhaustion as failure", async () => {
  const program = await load(fixture("witnesses"));
  const results = program.laws.map(name => checkLaw(program, name, options));
  expect(results.map(r => r.status)).toEqual(["pass", "pass", "unknown", "fail", "pass"]);
  expect(results[2].reason).toContain("search");
  expect(results[3].replayed).toBe(true);
});

test("demo existential witnesses satisfy the entire claim", async () => {
  for (const [demo, law] of [["proof_numerics", "divmod_ok"], ["io_http_fetch", "body_suffix"]]) {
    const program = await load(`${import.meta.dir}/fixtures/bend/${demo}/LAWS.bend`);
    expect(checkLaw(program, law, options).status).toBe("pass");
  }
});

test("F32 equality uses Bend bits and IO equality stops before evaluating programs", async () => {
  const report = await runFile(fixture("floats"), { ...options, n: 20, time: 0.5 });
  expect(report.results.map(r => r.status)).toEqual(["pass", "fail", "unknown", "unknown"]);
  expect(report.results[1].replayed).toBe(true);
  expect(report.results[2].reason).toContain("F32.add");
  expect(report.results[3].reason).toContain("IO");
});

test("false laws produce small counterexamples that replay without acceleration", async () => {
  const fast = await load(fixture("false"));
  const plain = await load(fixture("false"), false);
  const results = fast.laws.map(name => checkLaw(fast, name, options));
  expect(results.map(r => r.status)).toEqual(["fail", "fail", "fail"]);
  expect(results[0].bindings).toEqual({ n: "0n" });
  expect(results[1].bindings).toEqual({ n: "1n" });
  expect(results[2].bindings).toEqual({ xs: "[0n]" });
  for (const result of results) expect(replayLaw(plain, result.law, result.witness!)).toBe("fail");
});

test("passes, vacuity and unknowns remain distinct", async () => {
  const program = await load(fixture("decisions"));
  const statuses = Object.fromEntries(program.laws.map(name => [name, checkLaw(program, name, options).status]));
  expect(statuses).toEqual({ identity: "pass", vacuous: "vacuous", structural_witness: "pass",
    unknown_witness: "unknown", function_input: "unknown", arithmetic: "pass" });
  const plain = await load(fixture("decisions"), false);
  expect(checkLaw(plain, "arithmetic", options).status).toBe("pass");
});

test("a stuck normalizer is interrupted and the next law runs", async () => {
  const report = await runFile(fixture("loop"), { ...options, n: 1, time: 0.05 });
  expect(report.results.map(r => r.status)).toEqual(["timeout", "pass"]);
}, 10000);

for (const demo of ["proof_insertion_sort", "app_pong_game_2d"]) {
  test(`Bend's ${demo} laws pass generated inputs`, async () => {
    const program = await load(`${import.meta.dir}/fixtures/bend/${demo}/LAWS.bend`);
    expect(program.laws.length).toBe(2);
    for (const law of program.laws) {
      const result = checkLaw(program, law, options);
      expect(result.status).toBe("pass");
      expect(result.accepted).toBe(100);
    }
  });
}
