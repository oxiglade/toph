import { B, show, type Term } from "../bend.ts";
import { js_lib } from "../../vendor/bend/comp.ts";

const names = ["add", "sub", "mul", "div", "mod", "min", "max", "double", "is_lt", "is_le", "is_gt", "is_ge", "is_eq", "is_ne"].map(n => "Nat." + n);
let compiled: Promise<Record<string, Function>> | undefined;

async function library() {
  const book = B.book_nil();
  await B.book_load(book, B.BASE_BEND, "", new Map());
  B.book_valid(book);
  const done = book.order.length;
  const wrappers = names.map((name, i) => {
    const { doms, ret } = B.tele_unbind(book, book.tlds[name].T);
    const args = doms.map((_: unknown, j: number) => "n" + j);
    return `def fast${i}(${args.map((n: string) => n + ": Nat").join(", ")}) -> ${show(ret)}:\n  ${name}(${args.join(", ")})\n`;
  }).join("\n");
  B.parse_book(book, B.BEND_DIR, wrappers, "", {});
  B.book_valid(book, done);
  const source = js_lib(book, true);
  const exports = (await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"))).default;
  return Object.fromEntries(names.map((name, i) => [name, exports["fast" + i]]));
}

export async function accelerate(book: any) {
  const lib = await (compiled ??= library());
  const result = { ...book, tlds: { ...book.tlds } };
  const natural = (term: Term): number | undefined => {
    let n = 0, t = B.term_wnf(result, term);
    while (t.$ === "Ctr" && t.k === "Succ") { n++; t = B.term_wnf(result, t.x[0]); }
    if (t.$ === "Lit" && t.k === "Nat") return n + t.v;
    if (t.$ === "Ctr" && t.k === "Zero") return n;
    return undefined;
  };
  for (const name of names) {
    const def = book.tlds[name];
    if (!def?.b) continue;
    const wrap = (args: Term[]): Term => args.length < def.n
      ? B.Lam("n", args.length, (x: Term) => wrap([...args, x]))
      : evaluate(args);
    const evaluate = (args: Term[]): Term => {
      const ns = args.map(natural);
      if (ns.some(n => n === undefined || n > 281474976710655)) {
        return args.reduce((f, x) => B.App(f, x), def.v);
      }
      const value = lib[name](...ns);
      return typeof value === "boolean" ? B.Ctr(value ? "True" : "False", []) : B.Lit("Nat", value);
    };
    result.tlds[name] = { ...def, v: wrap([]) };
  }
  return result;
}
