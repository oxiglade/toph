import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as B from "../../vendor/bend/bend.ts";

const errorText = (error: any): string => error?.$ === "Err" ? B.err_show(error) : String(error);

export type Source = { file: string; text: string };
export type Span = { source: Source; start: number; end: number };
export type Diagnostic = { message: string; span: Span };
export type Mapping = { start: number; end: number; origin: Span };
export type Mapped = { text: string; mappings: Mapping[]; namespace?: string };

export function location(span: Span): string {
  const before = span.source.text.slice(0, span.start).split("\n");
  return `${span.source.file}:${before.length}:${before.at(-1)!.length + 1}`;
}

export function excerpt(span: Span): string {
  const before = span.source.text.slice(0, span.start).split("\n");
  const line = before.length, column = before.at(-1)!.length;
  const text = span.source.text.split("\n")[line - 1].replace(/\r$/, "");
  const width = Math.max(1, Math.min(span.end - span.start, text.length - column));
  return `${line}>| ${text}\n${" ".repeat(String(line).length)} | ${text.slice(0, column).replace(/[^\t]/g, " ")}${"^".repeat(width)}`;
}

export class SourceError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map(d => `${location(d.span)}: ${d.message}\n${excerpt(d.span)}`).join("\n\n"));
    this.name = "SourceError";
  }
}

export function at<T>(span: Span, action: () => T): T {
  try { return action(); }
  catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError([{ span, message: error instanceof Error ? error.message : errorText(error) }]);
  }
}

export function mapped(text: string, origin: Span): Mapped {
  return { text, mappings: text.length ? [{ start: 0, end: text.length, origin }] : [] };
}

export function concat(...parts: Mapped[]): Mapped {
  let text = "";
  const mappings: Mapping[] = [];
  for (const part of parts) {
    mappings.push(...part.mappings.map(m => ({ ...m, start: m.start + text.length, end: m.end + text.length })));
    text += part.text;
  }
  return { text, mappings };
}

export function joinMapped(parts: Mapped[], separator: Mapped): Mapped {
  return concat(...parts.flatMap((part, i) => i ? [separator, part] : [part]));
}

export function originAt(output: Mapped, start: number, end = start + 1): Span | undefined {
  if (start === output.text.length) return output.mappings.at(-1)?.origin;
  const candidates = output.mappings.filter(m => m.start < end && m.end > start);
  candidates.sort((a, b) => (a.origin.end - a.origin.start) - (b.origin.end - b.origin.start));
  return candidates[0]?.origin ?? output.mappings.find(m => m.start <= start && m.end > start)?.origin;
}

export function sliceMapped(output: Mapped, start: number, end: number): Mapped {
  return {
    text: output.text.slice(start, end),
    mappings: output.mappings.filter(m => m.start < end && m.end > start).map(m => ({
      ...m, start: Math.max(start, m.start) - start, end: Math.min(end, m.end) - start,
    })),
  };
}

function bendBody(output: Mapped): Mapped {
  const parts: Mapped[] = [];
  let offset = 0, imports = true;
  for (const line of output.text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("import ")) imports = false;
    const end = Math.min(output.text.length, offset + line.length + 1);
    parts.push(sliceMapped(output, imports && trimmed.startsWith("import ") ? offset + line.length : offset, end));
    offset = end;
  }
  return { ...concat(...parts), namespace: output.namespace };
}

export function bendError(error: unknown, outputs: Mapped[]): Error {
  const err = error as B.Err;
  if (err?.$ !== "Err" || !err.spn) return error instanceof Error ? error : new Error(errorText(error));
  const output = outputs.flatMap(o => [o, bendBody(o)]).find(o => o.text === err.spn!.file.str && (o.namespace === undefined || o.namespace === err.spn!.file.ns));
  const origin = output && originAt(output, err.spn.beg, Math.max(err.spn.end, err.spn.beg + 1));
  if (!origin) return new Error(errorText(error));
  const detail = B.err_show({ ...err, spn: undefined });
  const generated = { source: { file: "generated Bend", text: output!.text }, start: err.spn.beg, end: err.spn.end };
  return new Error(`${location(origin)}: Bend ${detail}\n${excerpt(origin)}\nGenerated Bend:\n${excerpt(generated)}`);
}

export function savedBendError(error: B.Err): string | undefined {
  const file = error.spn?.file as (B.File & { dir?: string }) | undefined;
  const name = /^# toph-map: ([A-Za-z_][\w-]*\.bend\.map\.json)\n/.exec(file?.str ?? "")?.[1];
  if (!file?.dir || !name) return;
  try {
    const data = JSON.parse(readFileSync(join(file.dir, name), "utf8"));
    if (data.version !== 1 || data.file + ".map.json" !== name) return;
    const sources: Source[] = data.sources.map((path: string, i: number) => ({
      file: resolve(file.dir!, path), text: data.sourcesContent[i],
    }));
    const output: Mapped = {
      text: readFileSync(join(file.dir, data.file), "utf8"), namespace: file.ns,
      mappings: data.mappings.map((m: any) => ({ start: m.start, end: m.end,
        origin: { source: sources[m.source], start: m.originalStart, end: m.originalEnd } })),
    };
    return bendError(error, [output]).message;
  } catch { return; }
}
