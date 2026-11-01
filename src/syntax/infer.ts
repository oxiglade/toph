import { B } from "../bend.ts";
import type { Expr as Node, Ty } from "./ast.ts";
import { at } from "./source.ts";
import { emit } from "./emit.ts";
import { Fields } from "./fields.ts";
export const type = (name: string, ...args: Ty[]): Ty => ({ name, args });
let nextId = 0;
export const fresh = (): Ty => ({ id: nextId++ });
const deref = (t: Ty): Ty => "id" in t && t.link ? deref(t.link) : t;
const head = (t: Ty) => { t = deref(t); return "name" in t ? t.name : "?"; };
const contains = (t: Ty, v: Ty): boolean => { t = deref(t); return t === v || "name" in t && t.args.some(x => contains(x, v)); };
export function unify(a: Ty, b: Ty) {
  a = deref(a); b = deref(b);
  if (a === b) return;
  if ("id" in a) { if (contains(b, a)) throw new Error("recursive type constraint"); a.link = b; return; }
  if ("id" in b) { if (contains(a, b)) throw new Error("recursive type constraint"); b.link = a; return; }
  if (a.name !== b.name || a.args.length !== b.args.length) throw new Error(`type mismatch: ${a.name} / ${b.name}`);
  a.args.forEach((x, i) => unify(x, b.args[i]));
}
export class Context {
  book = B.book_nil(); aliases: Record<string, string> = {}; projections = new Map<string, string>();
  constructor(readonly fields: Fields) {}
  fromB(t: any, vars = new Map<number, Ty>()): Ty {
    t = B.term_force(t);
    if (t.$ === "Var") {
      if (!vars.has(t.i)) vars.set(t.i, fresh());
      return vars.get(t.i)!;
    }
    if (t.$ === "Ref" || t.$ === "ADT") return type(t.k, ...(t.x ?? []).map((x: any) => this.fromB(x, vars)));
    if (t.$ === "Lit") return type(B.term_show(B.term_lower(t)));
    if (t.$ === "Eql") return type("Equality", this.fromB(t.a, vars), this.fromB(t.b, vars), this.fromB(t.T, vars));
    if (t.$ === "Ctr") return type("Construct", type(t.k), ...t.x.map((x: any) => this.fromB(x, vars)));
    if (t.$ === "Qua") return type(B.term_show(B.term_lower(t)));
    if (t.$ === "Typ") return type("Kind");
    if (t.$ === "Qnt") return type("Quant");
    if (t.$ === "All") return type("Fn", this.fromB(t.A, vars), this.fromB(t.B(B.Var(t.k, t.i)), vars));
    if (t.$ === "App") {
      const [f, xs] = B.term_unapply(t);
      if (f.$ === "Ref" && f.k === "Pair") return type("Pair", ...xs.map((x: any) => this.fromB(x, vars)));
      return type("Apply", this.fromB(f, vars), ...xs.map((x: any) => this.fromB(x, vars)));
    }
    throw new Error("unsupported signature type: " + B.term_show(B.term_lower(t)));
  }
  key(name: string) {
    const dot = name.indexOf(".");
    return dot >= 0 && this.aliases[name.slice(0, dot)] !== undefined ? this.aliases[name.slice(0, dot)] + ":" + name.slice(dot + 1) : name;
  }
  name(k: string) {
    for (const [a, ns] of Object.entries(this.aliases)) if (k.startsWith(ns + ":")) return a + "." + k.slice(ns.length + 1);
    return k;
  }
  format(t: Ty): string {
    t = deref(t);
    if ("id" in t) throw new Error("unresolved type; add an annotation");
    if (t.name === "Equality") return `{${this.format(t.args[0])} == ${this.format(t.args[1])} : ${this.format(t.args[2])}}`;
    if (t.name === "Construct") return `${this.format(t.args[0])}{${t.args.slice(1).map(x => this.format(x)).join(", ")}}`;
    if (t.name === "Fn") return `(${this.format(t.args[0])} -> ${this.format(t.args[1])})`;
    if (t.name === "Pair") return `(${this.format(t.args[0])} & ${this.format(t.args[1])})`;
    if (t.name === "Apply") return `${this.format(t.args[0])}(${t.args.slice(1).map(x => this.format(x)).join(", ")})`;
    return this.name(t.name) + (t.args.length ? "<" + t.args.map(x => this.format(x)).join(", ") + ">" : "");
  }
  value(n: Node, env: Map<string, Ty>): Ty {
    if (n.tag === "group") return this.value(n.xs[0], env);
    if (n.tag === "+") return this.value(n.xs[0], env);
    if (n.tag === "ctor") return type("Construct", type(this.key(n.xs[0].text)), ...n.xs.slice(1).map(x => this.value(x, env)));
    if (n.tag === "ann" && n.xs[0].tag === "op" && ["==", "!="].includes(n.xs[0].text)) return this.value(n.xs[0], env);
    if (n.tag === "op" && ["==", "!="].includes(n.text)) {
      const equality = type("Equality", this.value(n.xs[0], env), this.value(n.xs[1], env), n.xs[0].ty!);
      return n.text === "==" ? equality : type("Fn", equality, type("Empty"));
    }
    if (n.tag === "name") return type(this.key(n.text));
    if (n.tag === "generic") return type(this.key(n.text), ...(n.implicit ?? []), ...n.xs.map(x => this.value(x, env)));
    if (n.tag === "call") return type("Apply", ...n.xs.map(x => this.value(x, env)));
    if (n.tag === "op" && ["&", "->"].includes(n.text)) return type(n.text === "&" ? "Pair" : "Fn", ...n.xs.map(x => this.value(x, env)));
    if (n.prop || n.ty && head(n.ty) === "Kind") return type(this.emit(n));
    throw new Error("unsupported type value: " + n.tag);
  }
  signature(k: string, constructor = false) {
    const def = constructor ? this.book.ctrs[k] : this.book.tlds[k];
    if (!def) throw new Error("unknown definition: " + k);
    const vars = new Map<number, Ty>(), params: { name: string; ty: Ty; value: Ty; erased: boolean }[] = [];
    let t = def.T;
    while (t.$ === "All") {
      const v = this.fromB(B.Var(t.k, t.i), vars);
      params.push({ name: t.k, ty: this.fromB(t.A, vars), value: v, erased: t.q.$ === "None" });
      t = t.B(B.Var(t.k, t.i));
    }
    return { params, ret: this.fromB(t, vars) };
  }
  infer(n: Node, env: Map<string, Ty>, expected?: Ty): Ty {
    return at(n.span, () => this.inferNode(n, env, expected));
  }
  inferNode(n: Node, env: Map<string, Ty>, expected?: Ty): Ty {
    if (n.tag === "group") {
      n.ty = this.infer(n.xs[0], env, expected);
      return n.ty;
    }
    const infer = (x: Node, e?: Ty) => this.infer(x, env, e);
    let t: Ty;
    if (n.tag === "name") {
      if (env.has(n.text)) t = env.get(n.text)!;
      else if (n.text.includes(".") && env.has(n.text.split(".")[0])) {
        const [base, ...fields] = n.text.split("."); let x: Node = { tag: "name", text: base, xs: [], span: { ...n.span, end: n.span.start + base.length } };
        for (const field of fields) x = { tag: "field", text: field, xs: [x], span: { ...n.span, end: x.span.end + field.length + 1 } };
        Object.assign(n, x); return this.infer(n, env, expected);
      } else if (/^\d+n$/.test(n.text)) t = type("Nat");
      else if (/^\d+$/.test(n.text)) t = type("U32");
      else if (n.text.startsWith('"')) t = type("String");
      else if (/^&[012]$/.test(n.text)) t = type("Quant");
      else if (n.text === "Quant") t = type("Kind");
      else if (["Type", "Data"].includes(n.text)) t = type("Kind");
      else { const s = this.signature(this.key(n.text)); t = s.params.reduceRight((r, p) => type("Fn", p.ty, r), s.ret); }
    } else if (["call", "ctor", "generic"].includes(n.tag)) {
      const name = n.tag === "generic" ? n.text : n.xs[0].text;
      const args = n.tag === "generic" ? n.xs : n.xs.slice(1);
      if (n.tag === "call" && (n.xs[0].tag !== "name" || name.includes(".") && env.has(name.split(".")[0]))) {
        t = infer(n.xs[0]);
        for (const x of args) { const a = fresh(), b = fresh(); unify(t, type("Fn", a, b)); infer(x, a); t = b; }
      } else if (env.has(name)) {
        t = env.get(name)!;
        for (const x of args) { const a = fresh(), b = fresh(); unify(t, type("Fn", a, b)); infer(x, a); t = b; }
      } else {
        const s = this.signature(this.key(name), n.tag === "ctor");
        const firstLive = s.params.findIndex(p => !p.erased);
        const omitted = n.tag === "call" && firstLive > 0 && args.length === s.params.length - firstLive;
        const quantities = s.params.findIndex(p => head(p.ty) !== "Quant");
        const defaults = n.tag === "generic" && args.length < s.params.length ? Math.min(s.params.length - args.length, quantities < 0 ? s.params.length : quantities) : 0;
        if (defaults) {
          n.implicit ??= Array.from({ length: defaults }, () => type("&1"));
          n.implicit.forEach((v, i) => unify(s.params[i].value, v));
        }
        const skip = n.tag === "ctor" ? s.params.length - args.length : omitted ? firstLive : defaults;
        if (skip < 0) throw new Error("too many constructor fields: " + name);
        if (n.tag === "ctor" && args.length !== this.book.ctrs[this.key(name)].n) throw new Error("wrong constructor field count: " + name);
        if (omitted) n.implicit = s.params.slice(0, skip).map(p => p.value);
        if (args.length + skip > s.params.length) throw new Error("too many arguments: " + name);
        args.forEach((x, i) => {
          const p = s.params[i + skip]; infer(x, p.ty);
          if (["Kind", "Quant"].includes(head(p.ty)) || contains(s.ret, p.value) || s.params.some(p2 => contains(p2.ty, p.value))) {
            at(x.span, () => unify(p.value, this.value(x, env)));
          }
        });
        t = s.params.slice(args.length + skip).reduceRight((r, p) => type("Fn", p.ty, r), s.ret);
      }
    } else if (n.tag === "field") {
      const receiver = infer(n.xs[0]), r = deref(receiver);
      if (!("name" in r)) throw new Error("unresolved record receiver");
      const adt = this.book.tlds[r.name];
      if (adt?.$ !== "ADT" || adt.c.length !== 1 || adt.n !== 0) throw new Error("field requires a concrete single-constructor record");
      const ctor = adt.c[0], s = this.signature(ctor.k, true), index = s.params.findIndex(p => p.name === n.text);
      if (index < 0) throw new Error("unknown field: " + n.text);
      t = s.params[index].ty;
      if (this.aliases.Fields !== undefined) throw new Error("Fields is reserved for generated projections");
      const [namespace, record] = r.name.split(":"), alias = this.fields.alias(namespace);
      const name = "project." + alias + "." + record + "." + n.text; n.field = "Fields." + name;
      const fields = s.params.map((_, i) => "f" + i);
      const canonical = (text: string) => {
        return text.replace(/\b([A-Za-z_]\w*)\./g, (match, name) =>
          this.aliases[name] === undefined ? match : this.fields.alias(this.aliases[name]) + ".");
      };
      const definition = `def ${name}(value: ${canonical(this.format(receiver))}) -> ${canonical(this.format(t))}:\n  ${canonical(this.name(ctor.k))}{${fields.join(", ")}} = value\n  ${fields[index]}\n`;
      this.fields.definitions.set(name, definition); if (!this.fields.origins.has(name)) this.fields.origins.set(name, n.span); this.projections.set(name, definition);
    } else if (n.tag === "tuple") {
      const ts = n.xs.map(() => fresh());
      t = ts.reduceRight((r, x, i) => i === ts.length - 1 ? x : type("Pair", x, r));
      if (expected) unify(t, expected);
      n.xs.forEach((x, i) => infer(x, ts[i]));
    } else if (n.tag === "list") {
      t = type("List", fresh(), fresh()); if (expected) unify(t, expected);
      const r = deref(t) as { name: string; args: Ty[] }; n.xs.forEach(x => infer(x, r.args[1]));
    } else if (n.tag === "+") {
      const value = n.xs[0];
      if (value.tag !== "generic") throw new Error("expected a quantified datatype after +");
      const s = this.signature(this.key(value.text));
      let count = 0;
      while (s.params[count] && head(s.params[count].ty) === "Quant") count++;
      if (!count) throw new Error("expected a quantified datatype after +");
      if (value.xs.length !== s.params.length - count) throw new Error("omit leading quantities after +");
      value.implicit = Array.from({ length: count }, () => type("&2"));
      t = infer(value, expected);
    } else if (n.tag === "succ") { infer(n.xs[0], type("Nat")); t = type("Nat"); }
    else if (n.tag === "not") { infer(n.xs[0], type("Bool")); t = type("Bool"); }
    else if (n.tag === "ann") {
      infer(n.xs[1], type("Kind"));
      const annotation = this.value(n.xs[1], env), value = n.xs[0];
      if (value.tag === "op" && ["==", "!="].includes(value.text)) {
        value.xs.forEach(x => infer(x, annotation)); value.ty = type("Kind"); t = type("Kind");
      } else { t = annotation; infer(value, t); }
    }
    else if (n.tag === "bind") {
      infer(n.xs[0], type("Kind"));
      const inner = new Map(env); inner.set(n.text.slice(1).replace(/^[+-]/, ""), this.value(n.xs[0], env));
      this.infer(n.xs[1], inner, type("Kind")); t = type("Kind");
    } else if (n.tag === "op") {
      const [a, b] = n.xs;
      if (n.text === "=>") {
        const input = fresh(), output = fresh(); t = type("Fn", input, output); if (expected) unify(t, expected);
        const inner = new Map(env); inner.set(a.tag === "+" ? a.xs[0].text : a.text, input); this.infer(b, inner, output);
      } else if (["&", "->"].includes(n.text)) { infer(a, type("Kind")); infer(b, type("Kind")); t = type("Kind"); }
      else if (["==", "!="].includes(n.text)) { const at = infer(a); infer(b, at); t = type("Kind"); }
      else if (["&&", "||"].includes(n.text)) { infer(a, type("Bool")); infer(b, type("Bool")); t = type("Bool"); }
      else if (n.text === "++") { infer(a, type("String")); infer(b, type("String")); t = type("String"); }
      else if (n.text === "<>") {
        t = type("List", fresh(), fresh()); if (expected) unify(t, expected);
        const r = deref(t) as { name: string; args: Ty[] }; infer(a, r.args[1]); infer(b, t);
      } else { const at = infer(a); infer(b, at); t = ["<", "<=", ">", ">="].includes(n.text) ? type("Bool") : at; }
    } else throw new Error("unsupported expression: " + n.tag);
    n.ty = t;
    if (expected) {
      if (head(expected) === "Kind" && head(t) === "Bool") n.prop = true;
      else unify(t, expected);
    }
    return t;
  }
  pattern(n: Node, t: Ty, env: Map<string, Ty>) {
    return at(n.span, () => this.patternNode(n, t, env));
  }
  patternNode(n: Node, t: Ty, env: Map<string, Ty>) {
    if (n.tag === "group") return this.pattern(n.xs[0], t, env);
    if (n.tag === "+") return this.pattern(n.xs[0], t, env);
    if (n.tag === "name" && /^[a-z_]\w*$/.test(n.text)) { if (n.text !== "_") env.set(n.text, t); return; }
    if (n.tag === "succ") { unify(t, type("Nat")); return this.pattern(n.xs[0], t, env); }
    if (n.tag === "op" && n.text === "<>") {
      const a = fresh(); unify(t, type("List", fresh(), a));
      this.pattern(n.xs[0], a, env); this.pattern(n.xs[1], t, env); return;
    }
    if (n.tag === "tuple") {
      const ts = n.xs.map(() => fresh());
      unify(t, ts.reduceRight((r, x, i) => i === ts.length - 1 ? x : type("Pair", x, r)));
      n.xs.forEach((x, i) => this.pattern(x, ts[i], env)); return;
    }
    if (n.tag === "list") {
      const element = fresh(); unify(t, type("List", fresh(), element));
      n.xs.forEach(x => this.pattern(x, element, env)); return;
    }
    if (n.tag === "ctor") {
      if (n.xs.length - 1 !== this.book.ctrs[this.key(n.xs[0].text)]?.n) throw new Error("wrong constructor field count");
      const s = this.signature(this.key(n.xs[0].text), true); unify(t, s.ret);
      const fields = s.params.slice(s.params.length - n.xs.length + 1);
      n.xs.slice(1).forEach((x, i) => this.pattern(x, fields[i].ty, env)); return;
    }
    this.infer(n, env, t);
  }
  emit(n: Node): string { return emit(n, t => this.format(t)).text; }
}
