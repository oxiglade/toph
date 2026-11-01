import type { Expr, Ty } from "./ast.ts";
import { at, concat, joinMapped, mapped, type Mapped } from "./source.ts";

export const verbs: Record<string, string> = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod", "<": "is_lt", "<=": "is_le", ">": "is_gt", ">=": "is_ge" };

export function emit(n: Expr, format: (t: Ty) => string): Mapped {
  return at(n.span, () => {
    const e = (x: Expr) => emit(x, format);
    const m = (text: string) => mapped(text, n.span);
    const wrap = (before: string, value: Mapped, after: string) => concat(m(before), value, m(after));
    const args = (xs: Expr[]) => joinMapped(xs.map(e), m(", "));
    if (n.prop) {
      let x = n;
      while (x.tag === "group") x = x.xs[0];
      return wrap("{", concat(e({ ...(x.tag === "not" ? x.xs[0] : x), prop: false }), m(` == ${x.tag === "not" ? "False" : "True"}{} : Bool`)), "}");
    }
    switch (n.tag) {
      case "name": return m(n.text);
      case "group": return wrap("(", e(n.xs[0]), ")");
      case "tuple": return wrap("(", args(n.xs), ")");
      case "list": return wrap("[", args(n.xs), "]");
      case "succ": return wrap(n.text + "(", e(n.xs[0]), ")");
      case "+": return concat(m("+"), e(n.xs[0]));
      case "not": return wrap("Bool.not(", e(n.xs[0]), ")");
      case "field": return wrap(n.field + "(", e(n.xs[0]), ")");
      case "call": case "ctor": {
        const implicit = n.implicit?.map(t => m(format(t))) ?? [];
        const values = [...implicit, ...n.xs.slice(1).map(e)];
        return concat(e(n.xs[0]), wrap(n.tag === "call" ? "(" : "{", joinMapped(values, m(", ")), n.tag === "call" ? ")" : "}"));
      }
      case "generic": {
        const values = [...(n.implicit?.map(t => m(format(t))) ?? []), ...n.xs.map(e)];
        return wrap(n.text + "<", joinMapped(values, m(", ")), ">");
      }
      case "ann": {
        const [value, ty] = n.xs;
        if (value.tag === "op" && ["==", "!="].includes(value.text)) {
          return wrap("{", concat(e(value.xs[0]), mapped(` ${value.text} `, value.span), e(value.xs[1]), m(" : "), e(ty)), "}");
        }
        return wrap("{", concat(e(value), m(" : "), e(ty)), "}");
      }
      case "bind": return wrap("(" + n.text + ": ", concat(e(n.xs[0]), m(" -> "), e(n.xs[1])), ")");
      case "op": {
        const [a, b] = n.xs;
        if (["==", "!="].includes(n.text)) {
          const ty = at(a.span, () => format(a.ty!));
          return wrap("{", concat(e(a), m(` ${n.text} `), e(b), m(" : " + ty)), "}");
        }
        if (verbs[n.text]) {
          const name = at(a.span, () => format(a.ty!)) + "." + verbs[n.text];
          return wrap(name + "(", concat(e(a), m(", "), e(b)), ")");
        }
        return wrap("(", concat(e(a), m(` ${n.text} `), e(b)), ")");
      }
    }
  });
}
