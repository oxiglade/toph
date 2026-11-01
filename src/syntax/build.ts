import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { B, errorText } from "../bend.ts";
import { desugar, Fields } from "./desugar.ts";

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
  const generated = new Map<string, string>();
  async function compile(file: string, name: string): Promise<void> {
    if (active.has(file)) throw new Error(".law import cycle: " + file);
    if (modules.has(file)) return;
    active.add(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import (\S+\.law) as \w+/gm)) {
      const dependency = realpathSync(resolve(dirname(file), match[1]));
      const hash = createHash("sha256").update(relative(dirname(input), dependency)).digest("hex").slice(0, 12);
      await compile(dependency, prefix + "_" + hash + ".bend");
    }
    const text = await desugar(source, file, stage, fields, modules);
    writeFileSync(join(stage, name), text);
    if (fields.definitions.size) writeFileSync(join(stage, fields.file), fields.source());
    generated.set(name, text);
    modules.set(file, join(stage, name));
    active.delete(file);
  }
  try {
    await compile(input, basename(output));
    if (fields.definitions.size) generated.set(fields.file, fields.source());
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
    for (const [name, text] of generated) {
      const relocated = text.replace(/^(import )(\S+)( as \w+)$/gm, (line, before, path, after) => {
        const target = resolve(stage, path);
        if (dirname(target) === stage && generated.has(basename(target))) return line;
        return before + "./" + relative(directory, target) + after;
      });
      writeFileSync(join(directory, name), relocated);
    }
    return output;
  } catch (error) {
    throw new Error(errorText(error));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
