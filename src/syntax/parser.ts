import type { Declaration, Expr, Module, Parameter, Statement } from "./ast.ts";
import { lex, type Token } from "./lexer.ts";
import { SourceError, type Diagnostic, type Source, type Span } from "./source.ts";

export const precedence: Record<string, number> = { "=>": 1, "->": 2, "&": 3, "||": 4, "&&": 5, "==": 6, "!=": 6, "<": 7, "<=": 7, ">": 7, ">=": 7, "<>": 8, "++": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
const rightAssociative = new Set(["=>", "->", "&", "<>", "++"]);
const reserved = new Set(["law", "def", "import", "as", "when", "exs", "match", "case", "for", "type", "do", "return", "where", "is"]);

class Parser {
  i = 0;
  depth = 0;
  tokens: Token[];
  diagnostics: Diagnostic[];
  constructor(readonly source: Source) {
    const result = lex(source);
    this.tokens = result.tokens;
    this.diagnostics = result.diagnostics;
  }
  get current() { return this.tokens[this.i]; }
  get previous() { return this.tokens[Math.max(0, this.i - 1)]; }
  is(text: string) { return this.current.text === text; }
  take(text: string): boolean { if (!this.is(text)) return false; this.i++; return true; }
  need(text: string) { if (!this.take(text)) this.fail(`expected '${text}', got ${this.describe()}`); }
  describe() { return this.current.kind === "eof" ? "end of file" : this.current.kind === "newline" ? "end of line" : JSON.stringify(this.current.text); }
  fail(message: string, span = this.current.span): never { throw new SourceError([{ message, span }]); }
  span(start: number): Span { return { source: this.source, start, end: this.previous.span.end }; }
  node(tag: Expr["tag"], text: string, start: number, ...xs: Expr[]): Expr { return { tag, text, xs, span: this.span(start) }; }
  name(qualified = false): Token {
    const token = this.current;
    if (token.kind !== "name" || reserved.has(token.text) || !qualified && token.text.includes(".")) this.fail("expected a name");
    this.i++;
    return token;
  }
  newlines() { while (this.current.kind === "newline") this.i++; }
  inside() {
    if (this.depth) {
      let next = this.i;
      while (this.tokens[next].kind === "newline") next++;
      if (this.tokens[next].column > 0 || [")", "]", "}", ">"].includes(this.tokens[next].text)) this.i = next;
    }
  }
  endLine() {
    if (this.current.kind !== "newline" && this.current.kind !== "eof") this.fail(`unexpected ${this.describe()}; expected end of line`);
    this.newlines();
  }
  recover(error: unknown) {
    if (!(error instanceof SourceError)) throw error;
    this.diagnostics.push(...error.diagnostics);
    this.depth = 0;
    if (this.current.column === 0 && ["law", "def", "import"].includes(this.current.text)) return;
    while (this.current.kind !== "newline" && this.current.kind !== "eof") this.i++;
    this.newlines();
  }
  list(end: string): Expr[] {
    const xs: Expr[] = [];
    this.depth++; this.inside();
    if (!this.take(end)) {
      do { this.inside(); if (this.is(end)) break; xs.push(this.expr()); this.inside(); } while (this.take(","));
      this.need(end);
    }
    this.depth--;
    return xs;
  }
  expr(min = 0, pattern = false): Expr {
    this.inside();
    const token = this.current, start = token.span.start;
    let n: Expr;
    if (this.take("(")) {
      this.depth++; const first = this.expr(); this.inside();
      if (this.take(",")) {
        const rest = this.list(")");
        if (!rest.length) this.fail("a tuple needs at least two elements", this.span(start));
        n = this.node("tuple", "", start, first, ...rest);
      }
      else if (this.take(":")) { const ty = this.expr(); this.inside(); this.need(")"); n = this.node("ann", "", start, first, ty); }
      else { this.need(")"); n = this.node("group", "", start, first); }
      this.depth--;
    } else if (this.take("[")) n = this.node("list", "", start, ...this.list("]"));
    else if (this.take("{")) {
      this.depth++; const value = this.expr(); this.inside(); this.need(":");
      const ty = this.expr(); this.inside(); this.need("}"); this.depth--;
      n = this.node("ann", "", start, value, ty);
    } else if (this.take("not") || this.take("+")) n = this.node(token.text as "not" | "+", "", start, this.expr(11, pattern));
    else if (token.kind === "number" && token.text.endsWith("n+")) { this.i++; n = this.node("succ", token.text, start, this.expr(11, pattern)); }
    else if (this.take("&") || this.take("@")) {
      if (token.text === "&" && this.current.kind === "number" && ["0", "1", "2"].includes(this.current.text)) {
        n = this.node("name", "&" + this.current.text, start); this.i++; n.span = this.span(start);
      } else {
        if (token.text === "&" && (this.is("+") || this.is("-"))) this.fail("existential binders are affine; omit the quantity");
        const quant = this.take("+") ? "+" : this.take("-") ? "-" : "";
        const name = this.name().text; this.need(":"); const ty = this.expr(3); this.need("->");
        n = this.node("bind", token.text + quant + name, start, ty, this.expr(2));
      }
    } else if (["name", "number", "string"].includes(token.kind) && !reserved.has(token.text)) {
      this.i++; n = this.node("name", token.text, start);
    } else this.fail(`expected an expression, got ${this.describe()}`);
    while (true) {
      this.inside();
      const op = this.current.text;
      if (this.take("(")) n = this.node("call", "", start, n, ...this.list(")"));
      else if (this.take("{")) n = this.node("ctor", "", start, n, ...this.list("}"));
      else if (this.take(".")) n = this.node("field", this.name().text, start, n);
      else if (op === "<" && n.tag === "name" && this.current.span.start === n.span.end && /^[A-Z]/.test(n.text.split(".").at(-1)!)) {
        this.i++; this.depth++; this.inside(); const xs: Expr[] = [];
        do { xs.push(this.expr(8)); this.inside(); } while (this.take(",") && !this.is(">"));
        this.need(">"); this.depth--; n = this.node("generic", n.text, start, ...xs);
      } else if (precedence[op] !== undefined && precedence[op] >= min && !(pattern && op === "+")) {
        this.i++;
        if (this.current.kind === "newline") {
          let next = this.i; while (this.tokens[next].kind === "newline") next++;
          if (this.tokens[next].column > 0 && !reserved.has(this.tokens[next].text)) this.i = next;
        }
        const rhs = this.expr(precedence[op] + Number(!rightAssociative.has(op)), pattern);
        if (op === "=>" && n.tag !== "name" && !(n.tag === "+" && n.xs[0].tag === "name")) this.fail("a lambda binds one name", n.span);
        n = this.node("op", op, start, n, rhs);
      } else break;
    }
    return n;
  }
  parameter(typed: boolean): Parameter {
    this.inside(); const start = this.current.span.start;
    const quant = this.take("+") ? "+" : this.take("-") ? "-" : "";
    const name = this.name().text;
    const annotation = this.take(":") ? this.expr() : undefined;
    if (typed && !annotation) this.fail("expected a type annotation");
    return { name, quant, annotation, span: this.span(start) };
  }
  parameters(typed: boolean): Parameter[] {
    const parameters: Parameter[] = [];
    this.depth++; this.inside();
    while (!this.take(")")) {
      const p = this.parameter(typed);
      if (parameters.some(x => x.name === p.name)) this.fail("duplicate parameter: " + p.name, p.span);
      parameters.push(p); this.inside();
      if (!this.take(",")) { this.need(")"); break; }
      this.inside();
    }
    this.depth--;
    return parameters;
  }
  declaration(): Declaration {
    const start = this.current.span.start, kind = this.current.text as "law" | "def"; this.i++;
    const name = this.name(kind === "def").text;
    const parameters = this.take("(") ? this.parameters(kind === "def") : [];
    if (kind === "def" && this.previous.text !== ")") this.fail("expected a parameter list");
    const result = kind === "def" ? (this.need("->"), this.expr()) : undefined;
    this.need(":"); const header = this.span(start); this.endLine();
    const premises: Expr[] = [], witnesses: Parameter[] = [], body: Statement[] = [];
    if (this.current.column === 0 || this.current.kind === "eof") this.fail("expected an indented body");
    const indent = this.current.column;
    if (kind === "def") body.push(...this.suite(indent));
    else {
      let phase = 0;
      while (this.current.column > 0 && this.current.kind !== "eof") {
        try {
          if (this.current.column !== indent) this.fail("unexpected indentation");
          if (this.take("when")) {
            if (phase > 0) this.fail("when must precede witnesses and the conclusion");
            premises.push(this.expr());
          } else if (this.take("exs")) {
            if (phase > 1) this.fail("exs must precede the conclusion");
            if (this.is("+") || this.is("-")) this.fail("existential binders are affine; omit the quantity");
            phase = 1; const p = this.parameter(true);
            if ([...parameters, ...witnesses].some(x => x.name === p.name)) this.fail("duplicate binder: " + p.name, p.span);
            witnesses.push(p);
          } else {
            if (phase === 2) this.fail("expected one law conclusion");
            phase = 2; const value = this.expr(); body.push({ kind: "expr", value, span: value.span });
          }
          this.endLine();
        } catch (error) { this.recover(error); }
      }
      if (!body.length) this.diagnostics.push({ message: "expected a law conclusion", span: header });
    }
    return { kind, name, parameters, result, premises, witnesses, body, header, span: this.span(start) };
  }
  suite(indent: number): Statement[] {
    const body: Statement[] = [];
    while (this.current.kind !== "eof" && this.current.column >= indent && this.current.column > 0) {
      try {
        if (this.current.column !== indent) this.fail("unexpected indentation");
        body.push(this.statement(indent));
      } catch (error) { this.recover(error); }
    }
    if (!body.length) this.fail("expected a body");
    return body;
  }
  terms(pattern = false): Expr[] {
    const xs: Expr[] = [];
    do { xs.push(this.expr(0, pattern)); this.take(","); } while (!this.is(":") && this.current.kind !== "eof" && this.current.kind !== "newline");
    this.need(":"); return xs;
  }
  statement(indent: number): Statement {
    const start = this.current.span.start;
    if (this.take("match")) {
      const values = this.terms(); this.endLine();
      const cases: Extract<Statement, { kind: "match" }>["cases"] = [];
      const caseIndent = this.current.column;
      if (caseIndent <= indent) this.fail("expected indented cases");
      while (this.current.column === caseIndent && this.take("case")) {
        const caseStart = this.previous.span.start, patterns = this.terms(true);
        if (patterns.length !== values.length) this.fail("expected one pattern per match value");
        let body: Statement[];
        if (this.current.kind === "newline") {
          this.endLine(); if (this.current.column <= caseIndent) this.fail("expected an indented case body");
          body = this.suite(this.current.column);
        } else body = [this.statement(caseIndent)];
        cases.push({ patterns, body, span: this.span(caseStart) });
      }
      if (!cases.length) this.fail("expected at least one case");
      return { kind: "match", values, cases, span: this.span(start) };
    }
    const erased = this.take("-");
    const pattern = this.expr();
    const annotation = this.take(":") ? this.expr() : undefined;
    if (this.take("=")) {
      const value = this.expr(); this.endLine();
      return { kind: "let", pattern, annotation, value, erased, span: this.span(start) };
    }
    if (erased || annotation) this.fail("expected '=' in a binding");
    this.endLine();
    return { kind: "expr", value: pattern, span: pattern.span };
  }
  module(): Module {
    const imports: Module["imports"] = [], declarations: Declaration[] = [];
    this.newlines();
    while (this.current.kind !== "eof") {
      try {
        if (this.current.column !== 0) this.fail("expected a declaration at the start of the line");
        if (this.take("import")) {
          const start = this.previous.span.start, pathStart = this.current.span.start;
          let end = pathStart;
          while (this.current.kind !== "newline" && this.current.kind !== "eof") {
            if (end !== pathStart && this.current.span.start !== end) break;
            end = this.current.span.end; this.i++;
          }
          const path = this.source.text.slice(pathStart, end);
          const alias = this.take("as") ? this.name().text : undefined;
          if (path !== "Base" && (!/\.(law|bend)$/.test(path) || !alias)) this.fail("expected Base or a .law/.bend path with an alias");
          if (path === "Base" && alias) this.fail("Base does not take an alias");
          imports.push({ path, alias, span: this.span(start) }); this.endLine();
        } else if (this.is("law") || this.is("def")) {
          const declaration = this.declaration();
          if (declarations.some(d => d.name === declaration.name)) this.fail("duplicate declaration: " + declaration.name, declaration.header);
          declarations.push(declaration);
        } else this.fail("expected import, law or def");
      } catch (error) { this.recover(error); }
    }
    this.diagnostics.sort((a, b) => a.span.start - b.span.start);
    return { source: this.source, imports, declarations, diagnostics: this.diagnostics };
  }
}

export function parseModule(text: string, file: string): Module {
  return new Parser({ text, file }).module();
}
