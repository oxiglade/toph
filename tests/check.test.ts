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

test("accepted targets stop sampling early and sparse attempts do not become passes", async () => {
  const program = await load(fixture("budgets"));
  const opts = { ...options, n: 1000, samples: 20 };
  expect(checkLaw(program, "identity", opts).accepted).toBe(20);
  expect(checkLaw(program, "closed", opts).attempted).toBe(1);
  const sparse = checkLaw(program, "sparse", { ...opts, n: 30 });
  expect(sparse.status).toBe("unknown");
  expect(sparse.accepted).toBeLessThan(20);
  expect(sparse.reason).toContain("target");
});

test("the file budget runs cheap laws before spending the remainder on a loop", async () => {
  const completed: string[] = [];
  const report = await runFile(fixture("loop"), { ...options, time: 10, fileTime: 2 }, r => completed.push(r.law));
  expect(report.results.map(r => r.status)).toEqual(["timeout", "pass"]);
  expect(completed[0]).toBe("following");
  expect(report.wallMs).toBeLessThan(3000);
}, 6000);

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

test("false demo laws fail and every reported counterexample replays", async () => {
  const report = await runFile(fixture("demo-false"), { ...options, n: 300 });
  const plain = await load(fixture("demo-false"), false);
  expect(report.results).toHaveLength(4);
  for (const result of report.results) {
    expect(result.status).toBe("fail");
    expect(result.replayed).toBe(true);
    expect(replayLaw(plain, result.law, result.witness!)).toBe("fail");
  }
});

test("a counterexample whose plain replay times out is never reported", async () => {
  const report = await runFile(fixture("replay-timeout"), { ...options, n: 1, time: 0.05 });
  expect(["unknown", "timeout"]).toContain(report.results[0].status);
  expect(report.results[0].witness).toBeUndefined();
  expect(report.results[0].bindings).toBeUndefined();
  expect(report.results[1].status).toBe("pass");
});

test("a short scheduling trial reserves time for a slower counterexample replay", async () => {
  const report = await runFile(fixture("replay-budget"), { ...options, n: 1, time: 3, fileTime: 5 });
  expect(report.results.map(r => r.status)).toEqual(["fail", "pass"]);
  expect(report.results[0].replayed).toBe(true);
});

test("proof domains carrying data are searched and cannot justify a universal hypothesis", async () => {
  const program = await load(fixture("witness-domains"));
  const results = program.laws.map(law => checkLaw(program, law, options));
  expect(results.map(r => r.status)).toEqual(["pass", "unknown", "fail", "unknown"]);
  expect(results[2].bindings?.p).toBeDefined();
  expect(results[3].reason).toContain("hypothesis proof did not type-check");
  const proof = B.Ctr("Tuple", [B.Ctr("Tuple", [B.Lit("Nat", 1), B.Rfl()]), B.Rfl()]);
  B.term_check(program.originalBook, { t: B.Ref("nested_choice"), n: 0, def: "nested_choice", qs: [] },
    proof, B.Lone(), program.originalBook.tlds.nested_choice.T, B.ctx_nil(), 0);
});
