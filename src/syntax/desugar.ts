import { realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { B } from "../bend.ts";
type Ty = { name: string; args: Ty[] } | { id: number; link?: Ty };
type Node = { tag: string; text: string; xs: Node[]; ty?: Ty; prop?: boolean; field?: string; implicit?: Ty[]; source?: string; lo?: number; hi?: number };
const type = (name: string, ...args: Ty[]): Ty => ({ name, args });
let nextId = 0;
const fresh = (): Ty => ({ id: nextId++ });
const deref = (t: Ty): Ty => "id" in t && t.link ? deref(t.link) : t;
const head = (t: Ty) => { t = deref(t); return "name" in t ? t.name : "?"; };
const contains = (t: Ty, v: Ty): boolean => { t = deref(t); return t === v || "name" in t && t.args.some(x => contains(x, v)); };
function unify(a: Ty, b: Ty) {
  a = deref(a); b = deref(b);
  if (a === b) return;
  if ("id" in a) { a.link = b; return; }
  if ("id" in b) { b.link = a; return; }
  if (a.name !== b.name || a.args.length !== b.args.length) throw new Error(`type mismatch: ${a.name} / ${b.name}`);
  a.args.forEach((x, i) => unify(x, b.args[i]));
}
const node = (tag: string, text = "", ...xs: Node[]): Node => ({ tag, text, xs });
const prec: Record<string, number> = { "=>": 1, "->": 2, "&": 3, "||": 4, "&&": 5,
  "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7, "<>": 8, "++": 8,
  "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
const verbs: Record<string, string> = { "+": "add", "-": "sub", "*": "mul", "/": "div",
  "%": "mod", "<": "is_lt", "<=": "is_le", ">": "is_gt", ">=": "is_ge" };
class Parser {
  ts: string[]; positions: number[]; i = 0;
  constructor(readonly source: string, readonly pattern = false) {
    const matches = [...source.matchAll(/"(?:\\.|[^"\\])*"|\d+n\+|\d+n?|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*|==|!=|=>|->|<>|<=|>=|&&|\|\||\+\+|[^\s]/g)];
    this.ts = matches.map(m => m[0]); this.positions = matches.map(m => m.index!);
  }
  stamp(n: Node, start: number) {
    n.source = this.source; n.lo = this.positions[start]; n.hi = this.positions[this.i - 1] + this.ts[this.i - 1].length;
  }
  peek() { return this.ts[this.i]; }
  take(s: string) { if (this.peek() !== s) return false; this.i++; return true; }
  need(s: string) { if (!this.take(s)) throw new Error(`expected ${s}, got ${this.peek()}`); }
  list(end: string) {
    const xs: Node[] = [];
    if (!this.take(end)) { do { xs.push(this.expr()); } while (this.take(",")); this.need(end); }
    return xs;
  }
  expr(min = 0): Node {
    const start = this.i;
    const s = this.ts[this.i++];
    if (!s) throw new Error("missing expression");
    let n: Node;
    if (s === "(") {
      n = this.expr();
      if (this.take(",")) n = node("tuple", "", n, ...this.list(")"));
      else this.need(")");
    }
    else if (s === "[") n = node("list", "", ...this.list("]"));
    else if (s === "{") {
      n = this.expr();
      if (this.take(":")) n = node("ann", "", n, this.expr());
      this.need("}");
    } else if (s === "not" || s === "+") n = node(s, "", this.expr(11));
    else if (/^\d+n\+$/.test(s)) n = node("succ", s, this.expr(11));
    else if (s === "&" && /^\d$/.test(this.peek())) n = node("name", "&" + this.ts[this.i++]);
    else if (s === "&" || s === "@") {
      const name = this.ts[this.i++]; this.need(":");
      const ty = this.expr(3); this.need("->");
      n = node("bind", s + name, ty, this.expr(2));
    } else n = node("name", s);
    this.stamp(n, start);
    while (this.i < this.ts.length) {
      const op = this.peek();
      if (op === "(" || op === "{") {
        this.i++; n = node(op === "(" ? "call" : "ctor", "", n, ...this.list(op === "(" ? ")" : "}"));
      } else if (op === ".") { this.i++; n = node("field", this.ts[this.i++], n); }
      else if (op === "<" && n.tag === "name" && /^(Sigma|List|Maybe)$/.test(n.text)) {
        this.i++; const xs: Node[] = [];
        do { xs.push(this.expr(8)); } while (this.take(","));
        this.need(">"); n = node("generic", n.text, ...xs);
      } else if (prec[op] !== undefined && prec[op] >= min && !(this.pattern && op === "+")) {
        this.i++;
        const right = ["=>", "->", "&", "<>", "++"].includes(op);
        n = node("op", op, n, this.expr(prec[op] + Number(!right)));
      } else break;
      this.stamp(n, start);
    }
    return n;
  }
  all() {
    const n = this.expr();
    if (this.i !== this.ts.length) throw new Error("unexpected tokens: " + this.ts.slice(this.i).join(" "));
    return n;
  }
}
const parse = (s: string) => new Parser(s).all();
export class Fields {
  definitions = new Map<string, string>();
  namespaces = new Map<string, string>();
  constructor(readonly file = "fields.bend") {}
  alias(namespace: string): string {
    if (!this.namespaces.has(namespace)) this.namespaces.set(namespace, "Module" + this.namespaces.size);
    return this.namespaces.get(namespace)!;
  }
  source(): string {
    return "import Base\n" + [...this.namespaces].map(([ns, alias]) => `import ./${ns}.bend as ${alias}`).join("\n")
      + "\n\n" + [...this.definitions.values()].join("\n");
  }
}
class Context {
  book = B.book_nil(); aliases: Record<string, string> = {}; projections = new Map<string, string>();
  constructor(readonly fields: Fields) {}
  fromB(t: any, vars = new Map<number, Ty>()): Ty {
    t = B.term_force(t);
    if (t.$ === "Var") {
      if (!vars.has(t.i)) vars.set(t.i, fresh());
      return vars.get(t.i)!;
    }
    if (t.$ === "Ref" || t.$ === "ADT") return type(t.k, ...(t.x ?? []).map((x: any) => this.fromB(x, vars)));
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
    if (t.name === "Fn") return `(${this.format(t.args[0])} -> ${this.format(t.args[1])})`;
    if (t.name === "Pair") return `(${this.format(t.args[0])} & ${this.format(t.args[1])})`;
    if (t.name === "Apply") return `${this.format(t.args[0])}(${t.args.slice(1).map(x => this.format(x)).join(", ")})`;
    return this.name(t.name) + (t.args.length ? "<" + t.args.map(x => this.format(x)).join(", ") + ">" : "");
  }
  value(n: Node, env: Map<string, Ty>): Ty {
    if (n.tag === "name") return type(this.key(n.text));
    if (n.tag === "generic") return type(this.key(n.text), ...n.xs.map(x => this.value(x, env)));
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
    const infer = (x: Node, e?: Ty) => this.infer(x, env, e);
    let t: Ty;
    if (n.tag === "name") {
      if (env.has(n.text)) t = env.get(n.text)!;
      else if (n.text.includes(".") && env.has(n.text.split(".")[0])) {
        const [base, ...fields] = n.text.split("."); let x = node("name", base);
        for (const field of fields) x = node("field", field, x);
        Object.assign(n, x); return this.infer(n, env, expected);
      } else if (/^\d+n$/.test(n.text)) t = type("Nat");
      else if (/^\d+$/.test(n.text)) t = type("U32");
      else if (n.text.startsWith('"')) t = type("String");
      else if (/^&[012]$/.test(n.text)) t = type("Quant");
      else if (["Type", "Data"].includes(n.text)) t = type("Kind");
      else { const s = this.signature(this.key(n.text)); t = s.params.reduceRight((r, p) => type("Fn", p.ty, r), s.ret); }
    } else if (["call", "ctor", "generic"].includes(n.tag)) {
      const name = n.tag === "generic" ? n.text : n.xs[0].text;
      const args = n.tag === "generic" ? n.xs : n.xs.slice(1);
      if (env.has(name)) {
        t = env.get(name)!;
        for (const x of args) { const a = fresh(), b = fresh(); unify(t, type("Fn", a, b)); infer(x, a); t = b; }
      } else {
        const s = this.signature(this.key(name), n.tag === "ctor");
        const firstLive = s.params.findIndex(p => !p.erased);
        const omitted = n.tag === "call" && firstLive > 0 && args.length === s.params.length - firstLive;
        const skip = n.tag === "ctor" ? s.params.length - args.length : omitted ? firstLive : 0;
        if (omitted) n.implicit = s.params.slice(0, skip).map(p => p.value);
        if (args.length + skip > s.params.length) throw new Error("too many arguments: " + name);
        args.forEach((x, i) => {
          const p = s.params[i + skip]; infer(x, p.ty);
          if (["Kind", "Quant"].includes(head(p.ty)) || contains(s.ret, p.value) || s.params.some(p2 => contains(p2.ty, p.value))) {
            unify(p.value, this.value(x, env));
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
      const [namespace, record] = r.name.split(":"), alias = this.fields.alias(namespace);
      const name = "project." + alias + "." + record + "." + n.text; n.field = "Fields." + name;
      const fields = s.params.map((_, i) => "f" + i);
      const canonical = (text: string) => {
        return text.replace(/\b([A-Za-z_]\w*)\./g, (match, name) =>
          this.aliases[name] === undefined ? match : this.fields.alias(this.aliases[name]) + ".");
      };
      const definition = `def ${name}(value: ${canonical(this.format(receiver))}) -> ${canonical(this.format(t))}:\n  ${canonical(this.name(ctor.k))}{${fields.join(", ")}} = value\n  ${fields[index]}\n`;
      this.fields.definitions.set(name, definition); this.projections.set(name, definition);
    } else if (n.tag === "tuple") {
      const ts = n.xs.map(() => fresh());
      t = ts.reduceRight((r, x, i) => i === ts.length - 1 ? x : type("Pair", x, r));
      if (expected) unify(t, expected);
      n.xs.forEach((x, i) => infer(x, ts[i]));
    } else if (n.tag === "list") {
      t = type("List", fresh(), fresh()); if (expected) unify(t, expected);
      const r = deref(t) as { name: string; args: Ty[] }; n.xs.forEach(x => infer(x, r.args[1]));
    } else if (n.tag === "succ") { infer(n.xs[0], type("Nat")); t = type("Nat"); }
    else if (n.tag === "not") { infer(n.xs[0], type("Bool")); t = type("Bool"); }
    else if (n.tag === "ann") { t = this.value(n.xs[1], env); infer(n.xs[0], t); }
    else if (n.tag === "bind") {
      const inner = new Map(env); inner.set(n.text.slice(1), this.value(n.xs[0], env));
      this.infer(n.xs[1], inner, type("Kind")); t = type("Kind");
    } else if (n.tag === "op") {
      const [a, b] = n.xs;
      if (n.text === "=>") {
        const input = fresh(), output = fresh(); t = type("Fn", input, output); if (expected) unify(t, expected);
        const inner = new Map(env); inner.set(a.text, input); this.infer(b, inner, output);
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
    if (n.tag === "+") return this.pattern(n.xs[0], t, env);
    if (n.tag === "name" && /^[a-z_]\w*$/.test(n.text)) { if (n.text !== "_") env.set(n.text, t); return; }
    if (n.tag === "succ") { unify(t, type("Nat")); return this.pattern(n.xs[0], t, env); }
    if (n.tag === "op" && n.text === "<>") {
      const a = fresh(); unify(t, type("List", fresh(), a));
      this.pattern(n.xs[0], a, env); this.pattern(n.xs[1], t, env); return;
    }
    if (n.tag === "ctor") {
      const s = this.signature(this.key(n.xs[0].text), true); unify(t, s.ret);
      const fields = s.params.slice(s.params.length - n.xs.length + 1);
      n.xs.slice(1).forEach((x, i) => this.pattern(x, fields[i].ty, env)); return;
    }
    this.infer(n, env, t);
  }
  emit(n: Node): string {
    const e = (x: Node) => this.emit(x);
    const original = () => {
      if (n.source === undefined) return n.text;
      let result = n.source.slice(n.lo, n.hi);
      for (const x of [...n.xs].filter(x => x.lo !== undefined).sort((a, b) => b.lo! - a.lo!)) {
        result = result.slice(0, x.lo! - n.lo!) + e(x) + result.slice(x.hi! - n.lo!);
      }
      return result;
    };
    if (n.prop) {
      const x = n.tag === "not" ? n.xs[0] : n, value = n.tag === "not" ? "False" : "True";
      return `{${this.emit({ ...x, prop: false })} == ${value}{} : Bool}`;
    }
    if (n.tag === "name") return n.text;
    if (n.tag === "field") return n.field + "(" + e(n.xs[0]) + ")";
    if (n.tag === "call" || n.tag === "ctor") {
      let result = original();
      if (n.implicit) {
        const at = result.indexOf("(") + 1;
        result = result.slice(0, at) + n.implicit.map(t => this.format(t)).join(", ") + ", " + result.slice(at);
      }
      return result;
    }
    if (["generic", "tuple", "list", "succ", "+", "ann", "bind"].includes(n.tag)) return original();
    if (n.tag === "not") return "Bool.not(" + e(n.xs[0]) + ")";
    if (n.tag === "op") {
      const [a, b] = n.xs;
      if (["==", "!="].includes(n.text)) {
        const between = n.source?.slice(a.hi, b.lo) ?? ` ${n.text} `;
        return `{${e(a)}${between}${e(b)} : ${this.format(a.ty!)}}`;
      }
      if (verbs[n.text]) return `${this.format(a.ty!)}.${verbs[n.text]}(${e(a)}, ${e(b)})`;
      return original();
    }
    throw new Error("cannot emit " + n.tag);
  }
}
const blocks = (s: string) => s.split(/(?=^(?:law|def) )/m);
export async function desugar(source: string, file: string, outputDir = dirname(resolve(file)), fields = new Fields(), modules = new Map<string, string>()): Promise<string> {
  const ctx = new Context(fields), seen = new Map(), imports: string[] = [];
  for (const m of source.matchAll(/^import (\S+)(?: as (\w+))?/gm)) {
    const imported = m[1] === "Base" ? B.BASE_BEND : realpathSync(resolve(dirname(file), m[1]));
    const target = modules.get(imported) ?? imported;
    const ns = m[1] === "Base" ? "" : relative(outputDir, target).replace(/\.bend$/, "");
    await B.book_load(ctx.book, target, ns, seen, undefined, outputDir);
    if (m[2]) ctx.aliases[m[2]] = ns;
    imports.push(m[1] === "Base" ? "import Base" : `import ./${relative(outputDir, target)} as ${m[2]}`);
  }
  const defs = blocks(source).slice(1);
  const signatures = defs.filter(s => s.startsWith("def ")).map(s => s.slice(0, s.indexOf(":\n") + 2) + "  ?body\n").join("\n");
  B.parse_book(ctx.book, outputDir + "/", signatures, "", ctx.aliases);
  const output: string[] = [];
  for (const block of defs) {
    const env = new Map<string, Ty>(), firstEnd = block.indexOf(":\n");
    const header = block.slice(0, firstEnd + 1), body = block.slice(firstEnd + 2).trimEnd();
    if (block.startsWith("law ")) {
      const m = /^law (\w+)(?:\(([\s\S]*)\))?:$/.exec(header);
      if (!m) throw new Error("invalid law header: " + header);
      const ps = new Parser(m[2] ?? ""), parameters: { name: string; quant: string; annotation?: Node }[] = [];
      while (ps.peek()) {
        const quant = ps.take("+") ? "+" : ps.take("-") ? "-" : "", name = ps.ts[ps.i++];
        const annotation = ps.take(":") ? ps.expr() : undefined;
        env.set(name, fresh()); parameters.push({ name, quant, annotation }); if (!ps.take(",")) break;
      }
      const lines = body.split("\n"), whens: Node[] = [];
      while (lines[0]?.trimStart().startsWith("when ")) whens.push(parse(lines.shift()!.trim().slice(5)));
      const witnesses: { name: string; annotation: Node }[] = [];
      while (lines[0]?.trimStart().startsWith("exs ")) {
        const p = new Parser(lines.shift()!.trim().slice(4)), name = p.ts[p.i++]; p.need(":");
        witnesses.push({ name, annotation: p.expr() });
        if (p.peek()) throw new Error("unexpected existential tokens");
      }
      const conclusion = parse(lines.join("\n"));
      for (const p of parameters) if (p.annotation) {
        ctx.infer(p.annotation, env, type("Kind"));
        unify(env.get(p.name)!, ctx.value(p.annotation, env));
      }
      for (const w of witnesses) {
        ctx.infer(w.annotation, env, type("Kind"));
        env.set(w.name, ctx.value(w.annotation, env));
      }
      ctx.infer(conclusion, env, type("Kind"));
      for (const w of whens) ctx.infer(w, env, type("Kind"));
      const binder = (p: typeof parameters[number]) => p.quant + p.name + ": " + (p.annotation ? ctx.emit(p.annotation) : ctx.format(env.get(p.name)!));
      const h = `law ${m[1]}:` + parameters.map(p => "\n  for " + binder(p)).join("");
      let hypothesis = 0;
      output.push(h + "\n" + whens.map(w => {
        while (env.has("hypothesis" + hypothesis)) hypothesis++;
        const name = "hypothesis" + hypothesis++;
        return `  for ${name}: ${ctx.emit(w)}`;
      }).join("\n")
        + (whens.length ? "\n" : "") + witnesses.map(w => `  exs ${w.name}: ${ctx.emit(w.annotation)}\n`).join("")
        + "  " + ctx.emit(conclusion) + "\n");
    } else {
      const name = /^def ([\w.]+)/.exec(header)![1], sig = ctx.signature(name);
      sig.params.forEach(p => env.set(p.name, p.ty));
      const lines = body.split("\n"), compiled: string[] = [];
      const scopes: { indent: number; env: Map<string, Ty>; match?: Node[] }[] = [{ indent: 0, env }];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i], indent = line.length - line.trimStart().length;
        if (!line.trim()) continue;
        while (scopes.length > 1 && indent <= scopes.at(-1)!.indent) scopes.pop();
        let scope = scopes.at(-1)!, text = line.trim(), prefix = " ".repeat(indent);
        if (text.startsWith("match ")) {
          const p = new Parser(text.slice(6, -1)), xs: Node[] = [];
          while (p.peek()) { const x = p.expr(); ctx.infer(x, scope.env); xs.push(x); }
          compiled.push(line); scopes.push({ indent, env: scope.env, match: xs }); continue;
        }
        if (text.startsWith("case ")) {
          const colon = text.indexOf(":"), p = new Parser(text.slice(5, colon), true), inner = new Map(scope.env);
          for (const x of scope.match ?? []) ctx.pattern(p.expr(), x.ty!, inner);
          if (p.peek()) throw new Error("extra pattern: " + text);
          scope = { indent, env: inner }; scopes.push(scope);
          prefix += text.slice(0, colon + 1);
          if (!text.slice(colon + 1).trim()) { compiled.push(prefix); continue; }
          prefix += " ";
          text = text.slice(colon + 1).trim();
        }
        while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].length - lines[i + 1].trimStart().length > indent) text += "\n" + lines[++i];
        const assignment = /^(.*?) = (.*)$/.exec(text);
        if (assignment) {
          const v = parse(assignment[2]), t = ctx.infer(v, scope.env); ctx.pattern(parse(assignment[1]), t, scope.env);
          compiled.push(prefix + assignment[1] + " = " + ctx.emit(v));
        } else {
          const v = parse(text); ctx.infer(v, scope.env, sig.ret);
          compiled.push(prefix + ctx.emit(v));
        }
      }
      output.push(header + "\n" + compiled.join("\n") + "\n");
    }
  }
  if (ctx.projections.size) imports.push(`import ./${fields.file} as Fields`);
  return imports.join("\n") + "\n\n" + output.join("\n");
}
