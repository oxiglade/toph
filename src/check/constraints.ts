import { B, type Term } from "../bend.ts";

export type Variable = Extract<Term, { $: "Var" }>;

export class Constraints {
  readonly variables = new Set<Variable>();
  constructor(readonly book: any, readonly tick = () => {}) {}

  variable(name: string): Variable {
    const v = B.Var(name, -100000 - this.variables.size) as Variable;
    this.variables.add(v);
    return v;
  }

  equal(left: Term, right: Term): boolean | undefined {
    this.tick();
    let a = B.term_wnf(this.book, left), b = B.term_wnf(this.book, right);
    if (a === b) return true;
    for (const [variable, value] of [[a, b], [b, a]]) {
      if (variable.$ === "Var" && this.variables.has(variable)) {
        if (!this.assignable(value, variable)) return undefined;
        variable.v = value;
        return true;
      }
    }
    if (a.$ === "Lit" && b.$ === "Lit") return a.k === b.k && a.v === b.v;
    if (a.$ === "Lit" && b.$ === "Ctr") a = B.lit_step(a);
    if (b.$ === "Lit" && a.$ === "Ctr") b = B.lit_step(b);
    if (a.$ === "Rfl" && b.$ === "Rfl") return true;
    if (a.$ !== "Ctr" || b.$ !== "Ctr") return undefined;
    if (a.k !== b.k || a.x.length !== b.x.length) return false;
    let decided = true;
    for (let i = 0; i < a.x.length; i++) {
      const result = this.equal(a.x[i], b.x[i]);
      if (result === false) return false;
      if (result === undefined) decided = false;
    }
    return decided ? true : undefined;
  }

  private assignable(term: Term, variable: Variable): boolean {
    this.tick();
    const t = B.term_wnf(this.book, term);
    if (t.$ === "Var") return t !== variable && this.variables.has(t);
    if (t.$ === "Lit" || t.$ === "Rfl") return true;
    return t.$ === "Ctr" && t.x.every(x => this.assignable(x, variable));
  }
}
