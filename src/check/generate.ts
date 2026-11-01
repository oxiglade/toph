import { B, show, type Term } from "../bend.ts";

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
  constructor(private book: any, private rng: Random, private aligned: boolean) {
    this.number = rng.pick([0, 1, 2, 3, 9, 10]);
    this.string = rng.pick(["", "a", "b", "0"]);
    this.length = rng.pick([0, 1, 1, 2, 3, 4]);
  }
  value(type: Term, depth = 0): Term {
    const t = B.term_wnf(this.book, type);
    if (t.$ !== "ADT") throw new Unsupported("cannot generate " + show(t));
    const key = show(t);
    const old = this.pool.get(key) ?? [];
    if (old.length && this.rng.next() < 0.3) return this.rng.pick(old);
    let v: Term;
    if (t.k === "Nat" || t.k === "U32") {
      const boundaries = t.k === "Nat"
        ? [0, 1, 2, 3, 4, 8, 9, 10, 11, 16, 31, 32, 63, 64]
        : [0, 1, 2, 3, 9, 10, 255, 256, 65535, 65536, 2147483647, 2147483648, 4294967294, 4294967295];
      v = B.Lit(t.k, this.aligned ? this.number : this.rng.pick(boundaries));
    } else if (t.k === "String") {
      v = B.Lit("String", this.aligned ? this.string : this.rng.pick(["", "a", "b", "0", "aa", "é", "🙂"]));
    } else if (t.k === "Char") {
      v = B.Ctr("Chr", [B.Lit("U32", this.rng.pick([0, 32, 48, 97, 98, 233, 128578]))]);
    } else if (t.k === "List") {
      const n = depth > 4 ? 0 : this.aligned ? this.length : this.rng.pick([0, 1, 1, 2, 2, 3, 4, 6]);
      v = B.Ctr("Nil", []);
      for (let i = 0; i < n; i++) v = B.Ctr("Con", [this.value(t.x[1], depth + 1), v]);
    } else {
      const adt = this.book.tlds[t.k];
      let constructors = adt.c.filter((c: any) => !t.r.includes(c.k));
      if (depth > 5) {
        const ranked = constructors.map((c: any) => ({ c, rank: fields(this.book, t, c.k).reduce(
          (n: number, f: Term) => n + this.height(f, new Set([show(t)])), 0) }));
        const best = Math.min(...ranked.map((x: any) => x.rank));
        constructors = ranked.filter((x: any) => x.rank === best && Number.isFinite(best)).map((x: any) => x.c);
      }
      if (!constructors.length) throw new Unsupported("no bounded constructor for " + show(t));
      const c = this.rng.pick<any>(constructors);
      let tel = c.T;
      for (const parameter of t.x) tel = B.tele_head(this.book, tel, B.ctx_nil()).B(parameter);
      const values: Term[] = [];
      for (let i = 0; i < c.n; i++) {
        const all = B.tele_head(this.book, tel, B.ctx_nil());
        const field = this.value(all.A, depth + 1);
        values.push(field);
        tel = all.B(field);
      }
      v = B.Ctr(c.k, values);
    }
    old.push(v);
    this.pool.set(key, old);
    return v;
  }

  private height(type: Term, seen: Set<string>): number {
    const t = B.term_wnf(this.book, type);
    if (t.$ !== "ADT") return Infinity;
    if (["Nat", "U32", "String", "Char"].includes(t.k)) return 1;
    const key = show(t);
    if (seen.has(key)) return Infinity;
    const next = new Set([...seen, key]);
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
