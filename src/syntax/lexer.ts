import type { Diagnostic, Source, Span } from "./source.ts";

export type Token = { kind: "name" | "number" | "string" | "symbol" | "newline" | "eof"; text: string; span: Span; column: number };
const head = (c: string) => /[A-Za-z_]/.test(c);
const tail = (c: string) => /[A-Za-z_0-9]/.test(c);
const digit = (c: string) => /[0-9]/.test(c);
const doubles = new Set(["==", "!=", "=>", "->", "<>", "<=", ">=", "&&", "||", "++"]);

export function lex(source: Source): { tokens: Token[]; diagnostics: Diagnostic[] } {
  const tokens: Token[] = [], diagnostics: Diagnostic[] = [];
  const text = source.text;
  let i = 0, lineStart = 0;
  const emit = (kind: Token["kind"], start: number) => tokens.push({ kind, text: text.slice(start, i), span: { source, start, end: i }, column: start - lineStart });
  while (i < text.length) {
    const start = i, c = text[i];
    if (c === " " || c === "\r") { i++; continue; }
    if (c === "\t") {
      diagnostics.push({ message: "use spaces for indentation and spacing", span: { source, start, end: ++i } });
      continue;
    }
    if (c === "#") { while (i < text.length && text[i] !== "\n") i++; continue; }
    if (c === "\n") { i++; emit("newline", start); lineStart = i; continue; }
    if (head(c)) {
      i++;
      while (i < text.length && (tail(text[i]) || text[i] === "." && head(text[i + 1] ?? ""))) i++;
      emit("name", start); continue;
    }
    if (digit(c)) {
      while (i < text.length && digit(text[i])) i++;
      if (text[i] === "n") { i++; if (text[i] === "+") i++; }
      emit("number", start); continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") {
        if (text[i] === "\\" && text[i + 1] !== "\n" && i + 1 < text.length) i++;
        i++;
      }
      if (text[i] === '"') i++;
      else diagnostics.push({ message: "unterminated string literal", span: { source, start, end: i } });
      emit("string", start); continue;
    }
    if (doubles.has(text.slice(i, i + 2))) i += 2;
    else i++;
    if (!"(){}[],:.+-*/%<>=&@".includes(c) && !doubles.has(text.slice(start, i))) {
      diagnostics.push({ message: `unexpected character ${JSON.stringify(c)}`, span: { source, start, end: i } });
    }
    emit("symbol", start);
  }
  tokens.push({ kind: "eof", text: "", span: { source, start: i, end: i }, column: i - lineStart });
  return { tokens, diagnostics };
}
