import { resolve } from "node:path";
import { B, errorText, show, type Term } from "../bend.ts";
import { Generator, Random, Unsupported, smaller, weight } from "./generate.ts";
import { accelerate } from "./naturals.ts";

export type Options = { n: number; seed: number; time: number };
export type Program = { book: any; laws: string[]; loadMs: number };
export type Result = {
  law: string; status: "pass" | "fail" | "vacuous" | "unknown" | "timeout";
  attempted: number; accepted: number; elapsedMs: number; seed: number;
  firstFailureMs?: number; bindings?: Record<string, string>; left?: string; right?: string;
  reason?: string; shrinkChecks?: number;
  witness?: Term[];
};
type Decision = { ok: boolean; proof?: Term; left?: string; right?: string };
type Binding = { name: string; type: Term; value: Term };

export async function load(file: string, fast = true): Promise<Program> {
  const start = performance.now();
  const book = B.book_nil();
  await B.book_load(book, resolve(file), "", new Map());
  B.book_valid(book);
  const laws = [...new Set<string>(book.order)].filter(name => {
    const def = book.tlds[name];
    return def.$ === "Def" && def.l && !def.b;
  });
  return { book: fast ? await accelerate(book) : book, laws, loadMs: performance.now() - start };
}

class Deadline extends Error {}

class Evaluation {
  constructor(readonly book: any, readonly until: number) {}
  tick() { if (performance.now() >= this.until) throw new Deadline(); }
  whnf(t: Term): Term { this.tick(); return B.term_wnf(this.book, t); }

  normal(term: Term): Term {
    let t = this.whnf(term);
    if (t.$ === "Lit") return t.k === "String"
      ? B.term_higher(B.lit_of(Array.from(t.v as string, c => c.codePointAt(0)!))) : B.Lit(t.k, t.v);
    if (t.$ !== "Ctr") throw new Unsupported("equality has a non-concrete normal form: " + show(t));
    if (t.k === "Zero" || t.k === "Succ") {
      let n = 0;
      while (t.$ === "Ctr" && t.k === "Succ") { n++; t = this.whnf(t.x[0]); }
      if (t.$ === "Lit" && t.k === "Nat") return B.Lit("Nat", n + t.v);
      if (t.$ === "Ctr" && t.k === "Zero") return B.Lit("Nat", n);
      throw new Unsupported("open natural number");
    }
    if (t.k === "SNil" || t.k === "SCon") {
      const codes: number[] = [];
      while (t.$ === "Ctr" && t.k === "SCon") {
        const char = this.whnf(t.x[0]);
        if (char.$ !== "Ctr" || char.k !== "Chr") throw new Unsupported("open character");
        const code = this.normal(char.x[0]);
        if (code.$ !== "Lit" || code.k !== "U32") throw new Unsupported("open character code");
        codes.push(code.v);
        t = this.whnf(t.x[1]);
      }
      if (t.$ === "Lit" && t.k === "String") {
        codes.push(...Array.from(t.v as string, c => c.codePointAt(0)!));
        return B.term_higher(B.lit_of(codes));
      }
      if (t.$ === "Ctr" && t.k === "SNil") return B.term_higher(B.lit_of(codes));
      throw new Unsupported("open string");
    }
    const result = B.Ctr(t.k, t.x.map((x: Term) => this.normal(x)));
    if (t.k === "U32" || t.k === "F32") {
      const n = B.u32_from_term(result, t.k);
      if (n === null) throw new Unsupported("open machine number");
      return B.Lit(t.k, n);
    }
    return result;
  }

  proposition(type: Term, depth = 0): boolean {
    if (depth > 40) throw new Unsupported("recursive proposition shape");
    const t = this.whnf(type);
    if (t.$ === "Eql" || t.$ === "All") return true;
    if (t.$ !== "ADT") return false;
    if (t.k === "Unit" || t.k === "Empty") return true;
    if (t.k === "Sigma") {
      const a = t.x[2], b = B.App(t.x[3], B.Var("witness", 7000 + depth));
      return (this.proposition(a, depth + 1) && this.proposition(b, depth + 1))
        || this.constraint(a, depth + 1) || this.constraint(b, depth + 1);
    }
    return false;
  }

  private constraint(type: Term, depth: number): boolean {
    if (depth > 40) throw new Unsupported("recursive proposition shape");
    const t = this.whnf(type);
    if (t.$ === "Eql" || t.$ === "All") return true;
    if (t.$ !== "ADT") return false;
    return t.k === "Empty" || (t.k === "Sigma" && (this.constraint(t.x[2], depth + 1)
      || this.constraint(B.App(t.x[3], B.Var("witness", 7000 + depth)), depth + 1)));
  }

  decide(type: Term, depth = 0): Decision {
    if (depth > 100) throw new Unsupported("proposition nesting exceeds 100");
    const t = this.whnf(type);
    if (t.$ === "Eql") {
      const a = this.normal(t.a), b = this.normal(t.b);
      return JSON.stringify(a) === JSON.stringify(b)
        ? { ok: true, proof: B.Rfl() }
        : { ok: false, left: show(a), right: show(b) };
    }
    if (t.$ === "All") {
      if (!this.proposition(t.A)) throw new Unsupported("cannot decide an unbounded universal claim: " + show(t.A));
      const premise = this.decide(t.A, depth + 1);
      if (!premise.ok) return { ok: true, proof: B.Efq() };
      const conclusion = this.decide(t.B(premise.proof), depth + 1);
      return conclusion.ok ? { ok: true, proof: B.Lam(t.k, t.i, () => conclusion.proof) } : conclusion;
    }
    if (t.$ === "ADT") {
      if (t.k === "Unit") return { ok: true, proof: B.Ctr("Unit", []) };
      if (t.k === "Empty") return { ok: false, left: "Empty", right: "an inhabited type" };
      if (t.k === "Sigma") {
        if (this.proposition(t.x[2])) {
          const a = this.decide(t.x[2], depth + 1);
          if (!a.ok) return a;
          const b = this.decide(B.App(t.x[3], a.proof), depth + 1);
          return b.ok ? { ok: true, proof: B.Ctr("Tuple", [a.proof, b.proof]) } : b;
        }
        const variable = B.Var("witness", 10000 + depth);
        const body = B.App(t.x[3], variable);
        const solution = this.solve(body, variable.i);
        if (solution === false) return { ok: false, left: show(body), right: "an existential witness" };
        if (solution) {
          const result = this.decide(B.App(t.x[3], solution), depth + 1);
          return result.ok ? { ok: true, proof: B.Ctr("Tuple", [solution, result.proof]) } : result;
        }
        throw new Unsupported("existential needs a witness beyond constructor equality: " + show(t.x[2]));
      }
    }
    throw new Unsupported("cannot decide " + show(t));
  }

  solve(type: Term, index: number): Term | false | undefined {
    const t = this.whnf(type);
    if (t.$ === "Eql") {
      for (const [pattern, value] of [[t.a, t.b], [t.b, t.a]]) {
        let ground: Term;
        try { ground = this.normal(value); } catch (e) { if (e instanceof Unsupported) continue; throw e; }
        const match = this.match(pattern, ground, index);
        if (match !== undefined) return match;
      }
    }
    if (t.$ === "ADT" && t.k === "Empty") return false;
    if (t.$ === "ADT" && t.k === "Sigma" && this.proposition(t.x[2])) {
      const a = this.solve(t.x[2], index);
      if (a !== undefined) return a;
      return this.solve(B.App(t.x[3], B.Var("proof", index + 1000)), index);
    }
    return undefined;
  }

  match(pattern: Term, ground: Term, index: number): Term | false | undefined {
    let a = this.whnf(pattern), b = ground;
    if (a.$ === "Var" && a.i === index) return b;
    if (a.$ === "Lit" && b.$ === "Lit") return a.k === b.k && a.v === b.v ? undefined : false;
    if (a.$ === "Lit" && b.$ === "Ctr") a = B.lit_step(a);
    if (b.$ === "Lit" && a.$ === "Ctr") b = B.lit_step(b);
    if (a.$ !== "Ctr" || b.$ !== "Ctr") return undefined;
    if (a.k !== b.k) return false;
    let candidate: Term | undefined;
    for (let i = 0; i < a.x.length; i++) {
      const value = this.match(a.x[i], b.x[i], index);
      if (value === false) return false;
      if (value !== undefined) {
        if (candidate !== undefined && JSON.stringify(this.normal(candidate)) !== JSON.stringify(this.normal(value))) return false;
        candidate = value;
      }
    }
    return candidate;
  }
}

function instance(program: Program, name: string, ev: Evaluation, generator?: Generator, supplied?: Term[]) {
  const def = program.book.tlds[name];
  const bindings: Binding[] = [];
  let t = def.T;
  for (let i = 0; i < def.n; i++) {
    const all = ev.whnf(t);
    if (all.$ !== "All") throw new Unsupported("law binder is not a function");
    if (ev.proposition(all.A)) {
      const hypothesis = ev.decide(all.A);
      if (!hypothesis.ok) return { accepted: false, bindings };
      t = all.B(hypothesis.proof);
    } else {
      const value = supplied ? supplied[bindings.length] : generator!.value(all.A);
      if (value === undefined) throw new Unsupported("dependent binder changed during shrinking");
      if (supplied) {
        try {
          B.term_check(program.book, { t: B.Ref(name), n: 0, def: name, qs: [] }, value, B.Lone(), all.A, B.ctx_nil(), 0);
        } catch (e) {
          if ((e as any)?.$ === "Err") return { accepted: false, bindings };
          throw e;
        }
      }
      bindings.push({ name: all.k, type: all.A, value });
      t = all.B(value);
    }
  }
  return { accepted: true, bindings, decision: ev.decide(t) };
}

function lawSeed(seed: number, name: string) {
  let n = seed >>> 0;
  for (const c of name) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}

export function checkLaw(program: Program, name: string, options: Options): Result {
  const start = performance.now();
  const ev = new Evaluation(program.book, start + options.time * 1000);
  const rng = new Random(lawSeed(options.seed, name));
  const result: Result = { law: name, status: "pass", attempted: 0, accepted: 0, elapsedMs: 0, seed: options.seed };
  try {
    for (let i = 0; i < options.n; i++) {
      ev.tick();
      result.attempted++;
      const sample = instance(program, name, ev, new Generator(program.book, rng, i % 5 === 0));
      if (!sample.accepted) continue;
      result.accepted++;
      if (sample.decision!.ok) continue;
      result.status = "fail";
      result.firstFailureMs = performance.now() - start;
      let bindings = sample.bindings;
      let decision = sample.decision!;
      result.shrinkChecks = 0;
      try {
        let changed = true;
        while (changed && result.shrinkChecks < 500) {
          changed = false;
          for (let j = 0; j < bindings.length; j++) {
            for (const v of smaller(program.book, bindings[j].type, bindings[j].value)) {
              if (weight(v) >= weight(bindings[j].value)) continue;
              ev.tick();
              result.shrinkChecks++;
              const values = bindings.map((b, k) => j === k ? v : b.value);
              const shrunk = instance(program, name, ev, undefined, values);
              if (shrunk.accepted && !shrunk.decision!.ok) {
                bindings = shrunk.bindings;
                decision = shrunk.decision!;
                changed = true;
                break;
              }
              if (result.shrinkChecks >= 500) break;
            }
          }
        }
      } catch (e) {
        if (!(e instanceof Deadline || e instanceof Unsupported)) throw e;
        result.reason = "shrinking stopped: " + e.message;
      }
      result.bindings = Object.fromEntries(bindings.map(b => [b.name, show(b.value)]));
      result.witness = bindings.map(b => B.term_lower(b.value));
      result.left = decision.left;
      result.right = decision.right;
      break;
    }
    if (result.status === "pass" && result.accepted === 0) result.status = "vacuous";
  } catch (e) {
    result.status = e instanceof Deadline ? "timeout" : "unknown";
    result.reason = errorText(e);
  }
  result.elapsedMs = performance.now() - start;
  return result;
}

export function replayLaw(program: Program, name: string, values: Term[], time = 10) {
  const sample = instance(program, name, new Evaluation(program.book, performance.now() + time * 1000),
    undefined, values.map(v => B.term_higher(v)));
  return !sample.accepted ? "skip" : sample.decision!.ok ? "pass" : "fail";
}
