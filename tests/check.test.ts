import { expect, test } from "bun:test";
import { checkLaw, load, replayLaw } from "../src/check/engine.ts";
import { runFile } from "../src/check/run.ts";

const options = { n: 100, seed: 42, time: 10 };
const fixture = (name: string) => `${import.meta.dir}/fixtures/${name}.bend`;

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
