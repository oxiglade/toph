import { resolve } from "node:path";
import { B, errorText, show, type Term } from "../bend.ts";
import { Generator, Random, Unsupported, smaller, weight } from "./generate.ts";
import { accelerate } from "./naturals.ts";
import { Constraints, type Variable } from "./constraints.ts";
import { loadLaw } from "../syntax/build.ts";

export type Options = { n: number; seed: number; time: number; samples?: number; fileTime?: number; size?: number };
export type Program = { book: any; originalBook: any; laws: string[] };
export type Result = {
  law: string; status: "pass" | "fail" | "vacuous" | "unknown" | "timeout";
  attempted: number; accepted: number; elapsedMs: number; seed: number;
  firstFailureMs?: number; bindings?: Record<string, string>; left?: string; right?: string;
  reason?: string; shrinkChecks?: number;
  replayed?: boolean;
  witness?: Term[];
};
type Decision = { ok: boolean; proof?: Term; left?: string; right?: string };
type Binding = { name: string; type: Term; value: Term };

export async function load(file: string, fast = true): Promise<Program> {
  const book = file.endsWith(".law") ? await loadLaw(file) : B.book_nil();
  if (!file.endsWith(".law")) {
    await B.book_load(book, resolve(file), "", new Map());
    B.book_valid(book);
  }
  const laws = [...new Set<string>(book.order)].filter(name => {
    const def = book.tlds[name];
    return def.$ === "Def" && def.l && !def.b;
  });
  return { book: fast ? await accelerate(book) : book, originalBook: book, laws };
}

class Deadline extends Error {
  constructor(message = "per-law time budget exhausted") { super(message); }
}

class Evaluation {
  constructor(readonly book: any, readonly until: number) {}
  tick() { if (performance.now() >= this.until) throw new Deadline(); }
  whnf(t: Term): Term { this.tick(); return B.term_wnf(this.book, t); }

  normal(term: Term): Term {
    let t = this.whnf(term);
    if (t.$ === "Rfl") return B.Rfl();
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

  proofOnly(type: Term, depth = 0): boolean {
    if (depth > 40) throw new Unsupported("recursive proposition shape");
    const t = this.whnf(type);
    if (t.$ === "Eql") return true;
    if (t.$ !== "ADT") return false;
    if (t.k === "Unit" || t.k === "Empty") return true;
    return t.k === "Sigma" && this.proofOnly(t.x[2], depth + 1)
      && this.proofOnly(B.App(t.x[3], B.Var("proof", -200000 - depth)), depth + 1);
  }

  decide(type: Term, depth = 0): Decision {
    if (depth > 100) throw new Unsupported("proposition nesting exceeds 100");
    const t = this.whnf(type);
    if (t.$ === "Eql") {
      if (this.whnf(t.T).$ === "All") {
        throw new Unsupported("equality of IO programs or functions is unsupported: " + show(t.T));
      }
      const a = this.normal(t.a), b = this.normal(t.b);
      return B.term_compare("EQ", this.book, a, b)
        ? { ok: true, proof: B.Rfl() }
        : { ok: false, left: show(a), right: show(b) };
    }
    if (t.$ === "All") {
      if (!this.proofOnly(t.A)) throw new Unsupported("cannot decide an unbounded universal claim: " + show(t.A));
      const premise = this.decide(t.A, depth + 1);
      if (!premise.ok) return { ok: true, proof: B.Efq() };
      const conclusion = this.decide(t.B(premise.proof), depth + 1);
      return conclusion.ok ? { ok: true, proof: B.Lam(t.k, t.i, () => conclusion.proof) } : conclusion;
    }
    if (t.$ === "ADT") {
      if (t.k === "Unit") return { ok: true, proof: B.Ctr("Unit", []) };
      if (t.k === "Empty") return { ok: false, left: "Empty", right: "an inhabited type" };
      if (t.k === "Sigma") {
        if (this.proofOnly(t.x[2])) {
          const a = this.decide(t.x[2], depth + 1);
          if (!a.ok) return a;
          const b = this.decide(B.App(t.x[3], a.proof), depth + 1);
          return b.ok ? { ok: true, proof: B.Ctr("Tuple", [a.proof, b.proof]) } : b;
        }
        return this.existential(t, depth);
      }
    }
    throw new Unsupported("cannot decide " + show(t));
  }

  private tryNormal(term: Term): Term | undefined {
    try { return this.normal(term); }
    catch (e) { if (e instanceof Unsupported) return undefined; throw e; }
  }

  private existential(type: Term, depth: number): Decision {
    const constraints = new Constraints(this.book, () => this.tick());
    const variables: Variable[] = [];
    let body = type;
    while (true) {
      const t = this.whnf(body);
      if (t.$ !== "ADT" || t.k !== "Sigma" || this.proofOnly(t.x[2])) break;
      const variable = constraints.variable("witness");
      variables.push(variable);
      body = B.App(t.x[3], variable);
    }
    const equations: Extract<Term, { $: "Eql" }>[] = [];
    const collect = (type: Term, depth: number) => {
      if (depth > 100) throw new Unsupported("existential nesting exceeds 100");
      const t = this.whnf(type);
      if (t.$ === "Eql") equations.push(t);
      if (t.$ === "ADT" && t.k === "Sigma" && this.proofOnly(t.x[2])) {
        collect(t.x[2], depth + 1);
        collect(B.App(t.x[3], B.Var("proof", -200000 - depth)), depth + 1);
      }
    };
    collect(body, depth);
    for (let pass = 0; pass <= variables.length; pass++) {
      for (const equation of equations) {
        const result = constraints.equal(equation.a, equation.b)
          ?? this.solveAppend(equation.a, equation.b, constraints);
        if (result === false) return { ok: false, left: show(equation), right: "an existential witness" };
      }
    }
    const solutions = variables.map(variable => this.tryNormal(variable));
    const forced = solutions.every(v => v !== undefined);
    let reason = "no satisfying witness";
    for (let trial = 0; trial < (forced ? 1 : 64); trial++) {
      const values: Term[] = [];
      const generator = new Generator(this.book, new Random(trial + 1), false);
      let claim = type;
      try {
        for (let i = 0; i < variables.length; i++) {
          const t = this.whnf(claim);
          const domain = this.whnf(t.x[2]);
          const value = solutions[i] ?? (domain.$ === "ADT" && domain.k === "Nat" && trial < 32
            ? B.Lit("Nat", trial) : generator.value(domain));
          B.term_check(this.book, { t: B.Ref("witness"), n: 0, def: "witness", qs: [] },
            value, B.Lone(), domain, B.ctx_nil(), 0);
          values.push(value);
          claim = B.App(t.x[3], value);
        }
        const result = this.decide(claim, depth + 1);
        if (result.ok) return { ok: true, proof: values.reduceRight((p, v) => B.Ctr("Tuple", [v, p]), result.proof!) };
        if (forced) return result;
      } catch (e) {
        if (!(e instanceof Unsupported) && (e as any)?.$ !== "Err") throw e;
        reason = errorText(e);
      }
    }
    throw new Unsupported("existential search exhausted: " + reason);
  }

  private solveAppend(left: Term, right: Term, constraints: Constraints): boolean | undefined {
    for (const [pattern, ground] of [[left, right], [right, left]]) {
      const [head, args] = B.term_unapply(this.whnf(pattern));
      if (head.$ !== "Ref" || head.k !== "String.append" || args.length !== 2) continue;
      const value = this.tryNormal(ground);
      if (value?.$ !== "Lit" || value.k !== "String") continue;
      for (const index of [0, 1]) {
        const fixed = this.tryNormal(args[1 - index]);
        if (fixed?.$ !== "Lit" || fixed.k !== "String") continue;
        const matches = index === 0 ? value.v.endsWith(fixed.v) : value.v.startsWith(fixed.v);
        if (!matches) return false;
        const rest = index === 0 ? value.v.slice(0, value.v.length - fixed.v.length) : value.v.slice(fixed.v.length);
        return constraints.equal(args[index], B.Lit("String", rest));
      }
    }
    return undefined;
  }

}

function instance(ev: Evaluation, name: string, generator?: Generator, supplied?: Term[]) {
  const def = ev.book.tlds[name];
  const bindings: Binding[] = [];
  let t = def.T;
  for (let i = 0; i < def.n; i++) {
    const all = ev.whnf(t);
    if (all.$ !== "All") throw new Unsupported("law binder is not a function");
    if (ev.proofOnly(all.A) || ev.whnf(all.A).$ === "All") {
      const hypothesis = ev.decide(all.A);
      if (!hypothesis.ok) return { accepted: false, bindings };
      try {
        B.term_check(ev.book, { t: B.Ref(name), n: 0, def: name, qs: [] },
          hypothesis.proof!, B.Lone(), all.A, B.ctx_nil(), 0);
      } catch (e) {
        if ((e as any)?.$ !== "Err") throw e;
        throw new Unsupported("generated hypothesis proof did not type-check");
      }
      t = all.B(hypothesis.proof);
    } else {
      const value = supplied ? supplied[bindings.length] : generator!.value(all.A);
      if (value === undefined) throw new Unsupported("dependent binder changed during shrinking");
      if (supplied) {
        try {
          B.term_check(ev.book, { t: B.Ref(name), n: 0, def: name, qs: [] }, value, B.Lone(), all.A, B.ctx_nil(), 0);
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
  const target = Math.min(options.n, options.samples ?? options.n);
  const result: Result = { law: name, status: "pass", attempted: 0, accepted: 0, elapsedMs: 0, seed: options.seed };
  try {
    for (let i = 0; i < options.n; i++) {
      ev.tick();
      result.attempted++;
      const sample = instance(ev, name,
        new Generator(program.book, rng, i % 5 === 0, i % ((options.size ?? 4) + 1)));
      if (!sample.accepted) continue;
      result.accepted++;
      if (sample.decision!.ok) {
        if (program.book.tlds[name].n === 0 || result.accepted >= target) {
          result.reason = program.book.tlds[name].n === 0 ? "closed claim evaluated once" : "accepted sample target reached";
          break;
        }
        continue;
      }
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
              const shrunk = instance(ev, name, undefined, values);
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
      let replay;
      try {
        replay = instance(new Evaluation(program.originalBook, ev.until), name, undefined, bindings.map(b => b.value));
      } catch (e) {
        if (e instanceof Deadline) throw new Deadline("counterexample replay time budget exhausted");
        throw new Unsupported("counterexample replay could not finish: " + errorText(e));
      }
      if (!replay.accepted || replay.decision!.ok) {
        throw new Unsupported("counterexample rejected by unaccelerated replay");
      }
      result.replayed = true;
      decision = replay.decision!;
      result.bindings = Object.fromEntries(bindings.map(b => [b.name, show(b.value)]));
      result.witness = bindings.map(b => B.term_lower(b.value));
      result.left = decision.left;
      result.right = decision.right;
      break;
    }
    if (result.status === "pass" && result.accepted === 0) result.status = "vacuous";
    else if (result.status === "pass" && options.samples !== undefined
      && result.accepted < target && program.book.tlds[name].n !== 0) {
      result.status = "unknown";
      result.reason = "attempt limit reached before accepted sample target";
    }
    if (result.status === "pass" && !result.reason) result.reason = "attempt limit reached";
  } catch (e) {
    result.status = e instanceof Deadline ? "timeout" : "unknown";
    result.reason = errorText(e);
  }
  result.elapsedMs = performance.now() - start;
  return result;
}

export function replayLaw(program: Program, name: string, values: Term[]) {
  const sample = instance(new Evaluation(program.originalBook, performance.now() + 10000), name, undefined, values.map(v => B.term_higher(v)));
  return !sample.accepted ? "skip" : sample.decision!.ok ? "pass" : "fail";
}
