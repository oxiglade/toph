import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { B } from "../bend.ts";
import { desugarMapped } from "./desugar.ts";
import { Fields } from "./fields.ts";
import { parseModule } from "./parser.ts";
import { bendError, concat, mapped, originAt, sliceMapped, SourceError, type Mapped } from "./source.ts";

function outputDirectory(directory: string): string {
  return lstatSync(directory, { throwIfNoEntry: false }) ? realpathSync(directory)
    : join(outputDirectory(dirname(directory)), basename(directory));
}

export async function loadLaw(input: string) {
  const directory = dirname(realpathSync(input));
  const files = readdirSync(directory);
  let prefix = "LAWS";
  for (let i = 0; files.some(name => name === prefix + ".bend" || name.startsWith(prefix + "_")); i++) {
    prefix = "LAWS_check" + i;
  }
  return (await compileLaw(input, join(directory, prefix + ".bend"))).book;
}

async function compileLaw(input: string, output: string) {
  if (!input.endsWith(".law") || !output.endsWith(".bend")) throw new Error("build needs a .law input and a .bend output");
  input = realpathSync(input);
  output = resolve(output);
  if (!/^[A-Za-z_][\w-]*\.bend$/.test(basename(output))) throw new Error("output needs a Bend module filename (letters, digits, _ and -)");
  const directory = outputDirectory(dirname(output));
  const modules = new Map<string, string>();
  const active = new Set<string>();
  const inputs = new Set<string>();
  const prefix = basename(output, ".bend");
  const fields = new Fields(prefix + "_fields.bend");
  const generated = new Map<string, Mapped>();
  const sources = new Map<string, string>();
  function generate(name: string, result: Mapped) {
    generated.set(name, result);
    sources.set(join(directory, name), result.text);
  }
  async function compile(file: string, name: string): Promise<void> {
    if (active.has(file)) throw new Error(".law import cycle: " + file);
    if (modules.has(file)) return;
    active.add(file);
    inputs.add(file);
    const source = readFileSync(file, "utf8");
    const module = parseModule(source, file);
    if (module.diagnostics.length) throw new SourceError(module.diagnostics);
    for (const imp of module.imports.filter(i => i.path.endsWith(".law"))) {
      const dependency = realpathSync(resolve(dirname(file), imp.path));
      const hash = createHash("sha256").update(relative(dirname(input), dependency)).digest("hex").slice(0, 12);
      await compile(dependency, prefix + "_" + hash + ".bend");
    }
    const body = await desugarMapped(source, file, directory, fields, modules, sources, inputs);
    const origin = { source: body.mappings[0].origin.source, start: 0, end: source.length };
    const result = concat(mapped(`# toph-map: ${name}.map.json\n`, origin), body);
    result.namespace = file === input ? "" : basename(name, ".bend");
    generate(name, result);
    if (fields.definitions.size) {
      const body = fields.mapped();
      generate(fields.file, { ...concat(mapped(`# toph-map: ${fields.file}.map.json\n`, body.mappings[0].origin), body), namespace: basename(fields.file, ".bend") });
    }
    modules.set(file, join(directory, name));
    active.delete(file);
  }
  try {
    await compile(input, basename(output));
    for (const file of sources.keys()) {
      if (inputs.has(file)) throw new Error("refusing to overwrite an input or linked output: " + file);
    }
    const book = B.book_nil();
    const seen = new Map();
    await B.book_load(book, join(directory, basename(output)), "", seen, undefined, undefined, sources);
    B.book_valid(book);
    for (const file of seen.keys()) if (!sources.has(file)) inputs.add(file);
    return { book, generated, inputs, output, directory };
  } catch (error) {
    throw bendError(error, [...generated.values()]);
  }
}

export async function build(input: string, output = input.replace(/\.law$/, ".bend")): Promise<string> {
  const compiled = await compileLaw(input, output);
  const { directory, generated, inputs } = compiled;
  mkdirSync(directory, { recursive: true });
  for (const name of [...generated.keys()].flatMap(name => [name, name + ".map.json"])) {
    const destination = join(directory, name);
    const entry = lstatSync(destination, { throwIfNoEntry: false });
    if (!entry) continue;
    if (entry.isSymbolicLink() || entry.nlink > 1 || inputs.has(realpathSync(destination))) {
      throw new Error("refusing to overwrite an input or linked output: " + destination);
    }
    if (!entry.isFile()) throw new Error("output is not a regular file: " + destination);
  }
  for (const [name, result] of generated) {
    const parts: Mapped[] = [];
    let offset = 0;
    for (const match of result.text.matchAll(/^(import )(\S+)( as \w+)$/gm)) {
      const target = resolve(directory, match[2]);
      if (dirname(target) === directory && generated.has(basename(target))) continue;
      parts.push(sliceMapped(result, offset, match.index), mapped(match[0], originAt(result, match.index)!));
      offset = match.index + match[0].length;
    }
    const serialized = concat(...parts, sliceMapped(result, offset, result.text.length));
    const sources = [...new Set(serialized.mappings.map(m => m.origin.source))];
    const map = {
      version: 1, file: name,
      sources: sources.map(s => relative(directory, resolve(s.file))),
      sourcesContent: sources.map(s => s.text),
      mappings: serialized.mappings.map(m => ({ start: m.start, end: m.end,
        source: sources.indexOf(m.origin.source), originalStart: m.origin.start, originalEnd: m.origin.end })),
    };
    writeFileSync(join(directory, name), result.text);
    writeFileSync(join(directory, name + ".map.json"), JSON.stringify(map) + "\n");
  }
  return compiled.output;
}
