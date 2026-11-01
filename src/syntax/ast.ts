import type { Diagnostic, Source, Span } from "./source.ts";

export type Ty = { name: string; args: Ty[] } | { id: number; link?: Ty };
export type Expr = {
  tag: "name" | "call" | "ctor" | "generic" | "field" | "tuple" | "list" | "succ" | "not" | "+" | "ann" | "bind" | "op" | "group";
  text: string;
  xs: Expr[];
  span: Span;
  ty?: Ty;
  prop?: boolean;
  field?: string;
  implicit?: Ty[];
};
export type Parameter = { name: string; quant: string; annotation?: Expr; span: Span };
export type Import = { path: string; alias?: string; span: Span };
export type Statement =
  | { kind: "expr"; value: Expr; span: Span }
  | { kind: "let"; pattern: Expr; value: Expr; annotation?: Expr; erased: boolean; span: Span }
  | { kind: "match"; values: Expr[]; cases: { patterns: Expr[]; body: Statement[]; span: Span }[]; span: Span };
export type Declaration = {
  kind: "law" | "def";
  name: string;
  parameters: Parameter[];
  result?: Expr;
  premises: Expr[];
  witnesses: Parameter[];
  body: Statement[];
  span: Span;
  header: Span;
};
export type Module = { source: Source; imports: Import[]; declarations: Declaration[]; diagnostics: Diagnostic[] };
