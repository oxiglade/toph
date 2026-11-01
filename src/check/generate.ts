import { B, show, type Term } from "../bend.ts";
import { Constraints } from "./constraints.ts";

export class Unsupported extends Error {}

export class Random {
  constructor(public state: number) {}
  next(): number {
    this.state |= 0;
    this.state = this.state + 0x6d2b79f5 | 0;
    let t = Math.imul(this.state ^ this.state >>> 15, 1 | this.state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  pick<T>(values: T[]): T { return values[Math.floor(this.next() * values.length)]; }
}

export function fields(book: any, type: Term, constructor: string, values: Term[] = []): Term[] {
  const adt = B.term_wnf(book, type);
  let tel = book.ctrs[constructor].T;
  for (const parameter of adt.x) tel = B.tele_head(book, tel, B.ctx_nil()).B(parameter);
  const result: Term[] = [];
  for (let i = 0; i < book.ctrs[constructor].n; i++) {
    const all = B.tele_head(book, tel, B.ctx_nil());
    result.push(all.A);
    tel = all.B(values[i] ?? B.Var("field", 9000 + i));
  }
  return result;
}

export class Generator {
  private pool = new Map<string, Term[]>();
  private number: number;
  private string: string;
  private length: number;
  private nodes = 0;
  constructor(private book: any, private rng: Random, private aligned: boolean, private size = 64) {
    this.number = rng.pick([0, 1, 2, 3, 9, 10].filter(n => n <= size));
    this.string = rng.pick(["", "a", "b", "0"]);
    this.length = rng.pick([0, 1, 1, 2, 3, 4]);
  }
  value(type: Term, depth = 0): Term {
    if (++this.nodes > 2000 || depth > 80) throw new Unsupported("generation size limit");
    const t = B.term_wnf(this.book, type);
    if (t.$ === "Eql") {
      if (B.term_compare("EQ", this.book, t.a, t.b)) return B.Rfl();
      throw new Unsupported("constructor equality is not inhabited: " + show(t));
    }
    if (t.$ !== "ADT") throw new Unsupported("cannot generate " + show(t));
    const key = show(t);
    const old = this.pool.get(key) ?? [];
    if (old.length && this.rng.next() < 0.3) return this.rng.pick(old);
    let v: Term;
    if (t.k === "Nat" || t.k === "U32") {
      const boundaries = t.k === "Nat"
        ? [0, 1, 2, 3, 4, 8, 9, 10, 11, 16, 31, 32, 63, 64]
        : [0, 1, 2, 3, 9, 10, 255, 256, 65535, 65536, 2147483647, 2147483648, 4294967294, 4294967295];
      v = B.Lit(t.k, this.aligned ? this.number : this.rng.pick(t.k === "Nat"
        ? [...boundaries.filter(n => n <= this.size), Math.floor(this.rng.next() * (this.size + 1))] : boundaries));
    } else if (t.k === "F32") {
      v = B.Lit("F32", this.rng.pick([0, 0x80000000, 1, 0x80000001,
        0x007fffff, 0x00800000, 0x7f7fffff, 0xff7fffff, 0x7f800000, 0xff800000,
        0x7fc00000, 0x7fc00001, ...[1, -1, 0.5, -0.5, 2, 10].map(B.f32_to_bits)]));
    } else if (t.k === "String") {
      v = B.Lit("String", this.aligned ? this.string : this.rng.pick(["", "a", "b", "0", "aa", "é", "🙂"]));
    } else if (t.k === "Char") {
      v = B.Ctr("Chr", [B.Lit("U32", this.rng.pick([0, 32, 48, 97, 98, 233, 128578]))]);
    } else if (t.k === "List") {
      const n = depth > 4 ? 0 : Math.min(this.size, this.aligned ? this.length : this.rng.pick([0, 1, 1, 2, 2, 3, 4, 6]));
      v = B.Ctr("Nil", []);
      for (let i = 0; i < n; i++) v = B.Ctr("Con", [this.value(t.x[1], depth + 1), v]);
    } else {
      v = this.construct(t, depth);
    }
    old.push(v);
    this.pool.set(key, old);
    return v;
  }

  private construct(t: Extract<Term, { $: "ADT" }>, depth: number): Term {
    const constructors = this.book.tlds[t.k].c.filter((c: any) => !t.r.includes(c.k))
      .map((c: any) => ({ c, order: this.rng.next(), rank: depth >= Math.min(4, this.size)
        ? fields(this.book, t, c.k).reduce((n: number, f: Term) => n + this.height(f, new Set([t.k])), 0) : 0 }))
      .sort((a: any, b: any) => a.rank - b.rank || a.order - b.order);
    let reason = "no constructors";
    for (const { c } of constructors) {
      const constraints = new Constraints(this.book);
      let tel = c.T;
      for (const parameter of t.x) tel = B.tele_head(this.book, tel, B.ctx_nil()).B(parameter);
      const slots = [];
      for (let i = 0; i < c.n; i++) {
        const all = B.tele_head(this.book, tel, B.ctx_nil());
        const variable = constraints.variable(all.k);
        slots.push({ type: all.A, variable });
        tel = all.B(variable);
      }
      try {
        for (const slot of slots) {
          const type = B.term_wnf(this.book, slot.type);
          if (type.$ === "Eql" && constraints.equal(type.a, type.b) === false) {
            throw new Unsupported("incompatible constructor index");
          }
        }
        const fill = (term: Term): Term => {
          const value = B.term_wnf(this.book, term);
          if (value.$ === "Var") {
            const slot = slots.find(s => s.variable === value);
            if (!slot) throw new Unsupported("unresolved constructor field");
            value.v = this.value(slot.type, depth + 1);
            return value.v;
          }
          return value.$ === "Ctr" ? B.Ctr(value.k, value.x.map(fill)) : value;
        };
        const value = B.Ctr(c.k, slots.map(s => fill(s.variable)));
        return value;
      } catch (e) {
        if (!(e instanceof Unsupported)) throw e;
        reason = e.message;
      }
    }
    throw new Unsupported("no bounded constructor for " + show(t) + ": " + reason);
  }

  private height(type: Term, seen: Set<string>): number {
    const t = B.term_wnf(this.book, type);
    if (t.$ === "Eql") return 0;
    if (t.$ !== "ADT" || seen.has(t.k)) return Infinity;
    if (["Nat", "U32", "F32", "String", "Char"].includes(t.k)) return 1;
    const next = new Set([...seen, t.k]);
    return 1 + Math.min(...this.book.tlds[t.k].c.map((c: any) =>
      fields(this.book, t, c.k).reduce((n: number, f: Term) => n + this.height(f, next), 0)));
  }
}

export function* smaller(book: any, type: Term, value: Term): IterableIterator<Term> {
  const v = B.term_wnf(book, value);
  if (v.$ === "Lit" && (v.k === "Nat" || v.k === "U32")) {
    for (const n of new Set([0, 1, Math.floor(v.v / 2), v.v - 1])) {
      if (n >= 0 && n < v.v) yield B.Lit(v.k, n);
    }
  } else if (v.$ === "Lit" && v.k === "String" && v.v.length) {
    yield B.Lit("String", "");
    if (v.v.length > 1) yield B.Lit("String", v.v.slice(0, Math.floor(v.v.length / 2)));
  } else if (v.$ === "Ctr") {
    const t = B.term_wnf(book, type);
    if (t.$ !== "ADT") return;
    if (v.k === "Con") yield v.x[1];
    for (const c of book.tlds[t.k].c) {
      if (c.n === 0 && c.k !== v.k && !t.r.includes(c.k)) yield B.Ctr(c.k, []);
    }
    const types = fields(book, t, v.k, v.x);
    for (let i = 0; i < v.x.length; i++) {
      for (const field of smaller(book, types[i], v.x[i])) {
        yield B.Ctr(v.k, v.x.map((x: Term, j: number) => i === j ? field : x));
      }
    }
  }
}

export function weight(term: Term): number {
  if (term.$ === "Lit") return 1 + (typeof term.v === "number" ? term.v : term.v.length);
  return 1 + (term.x?.reduce((n: number, x: Term) => n + weight(x), 0) ?? 0);
}
