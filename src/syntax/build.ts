import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { B } from "../bend.ts";
import { desugarMapped, Fields } from "./desugar.ts";
import { parseModule } from "./parser.ts";
import { bendError, concat, mapped, originAt, sliceMapped, SourceError, type Mapped } from "./source.ts";

export async function build(input: string, output = input.replace(/\.law$/, ".bend")): Promise<string> {
  if (!input.endsWith(".law") || !output.endsWith(".bend")) throw new Error("build needs a .law input and a .bend output");
  input = realpathSync(input);
  output = resolve(output);
  if (!/^[A-Za-z_][\w-]*\.bend$/.test(basename(output))) throw new Error("output needs a Bend module filename (letters, digits, _ and -)");
  const stage = realpathSync(mkdtempSync(join(tmpdir(), "toph-build-")));
  const modules = new Map<string, string>();
  const active = new Set<string>();
  const prefix = basename(output, ".bend");
  const fields = new Fields(prefix + "_fields.bend");
  const generated = new Map<string, Mapped>();
  async function compile(file: string, name: string): Promise<void> {
    if (active.has(file)) throw new Error(".law import cycle: " + file);
    if (modules.has(file)) return;
    active.add(file);
    const source = readFileSync(file, "utf8");
    const module = parseModule(source, file);
    if (module.diagnostics.length) throw new SourceError(module.diagnostics);
    for (const imp of module.imports.filter(i => i.path.endsWith(".law"))) {
      const dependency = realpathSync(resolve(dirname(file), imp.path));
      const hash = createHash("sha256").update(relative(dirname(input), dependency)).digest("hex").slice(0, 12);
      await compile(dependency, prefix + "_" + hash + ".bend");
    }
    const result = await desugarMapped(source, file, stage, fields, modules);
    result.namespace = file === input ? "" : basename(name, ".bend");
    writeFileSync(join(stage, name), result.text);
    generated.set(name, result);
    if (fields.definitions.size) {
      const getters = { ...fields.mapped(), namespace: basename(fields.file, ".bend") };
      writeFileSync(join(stage, fields.file), getters.text);
      generated.set(fields.file, getters);
    }
    modules.set(file, join(stage, name));
    active.delete(file);
  }
  try {
    await compile(input, basename(output));
    const book = B.book_nil();
    const seen = new Map();
    await B.book_load(book, join(stage, basename(output)), "", seen);
    B.book_valid(book);
    mkdirSync(dirname(output), { recursive: true });
    const directory = realpathSync(dirname(output));
    for (const name of generated.keys()) {
      const destination = join(directory, name);
      if (existsSync(destination) && seen.has(realpathSync(destination))) {
        throw new Error("refusing to overwrite an input: " + destination);
      }
    }
    for (const [name, result] of generated) {
      const parts: Mapped[] = [];
      let offset = 0;
      for (const match of result.text.matchAll(/^(import )(\S+)( as \w+)$/gm)) {
        const target = resolve(stage, match[2]);
        if (dirname(target) === stage && generated.has(basename(target))) continue;
        parts.push(sliceMapped(result, offset, match.index),
          mapped(match[1] + "./" + relative(directory, target) + match[3], originAt(result, match.index)!));
        offset = match.index + match[0].length;
      }
      const relocated = concat(...parts, sliceMapped(result, offset, result.text.length));
      const sources = [...new Set(relocated.mappings.map(m => m.origin.source))];
      const map = {
        version: 1, file: name,
        sources: sources.map(s => relative(directory, resolve(s.file))),
        sourcesContent: sources.map(s => s.text),
        mappings: relocated.mappings.map(m => ({ start: m.start, end: m.end,
          source: sources.indexOf(m.origin.source), originalStart: m.origin.start, originalEnd: m.origin.end })),
      };
      writeFileSync(join(directory, name), relocated.text);
      writeFileSync(join(directory, name + ".map.json"), JSON.stringify(map) + "\n");
    }
    return output;
  } catch (error) {
    throw bendError(error, [...generated.values()]);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
