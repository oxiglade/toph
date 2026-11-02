import { realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { B } from "../bend.ts";
import type { Declaration, Expr, Parameter, Statement, Ty } from "./ast.ts";
import { Context, fresh, type, unify } from "./infer.ts";
import { emit } from "./emit.ts";
import { Fields } from "./fields.ts";
import { parseModule } from "./parser.ts";
import { at, bendError, concat, joinMapped, mapped, SourceError, type Diagnostic, type Mapped } from "./source.ts";

export async function desugarMapped(source: string, file: string, outputDir = dirname(resolve(file)), fields = new Fields(), modules = new Map<string, string>(), sources?: ReadonlyMap<string, string>, inputs?: Set<string>): Promise<Mapped> {
  const module = parseModule(source, file);
  if (module.diagnostics.length) throw new SourceError(module.diagnostics);
  const ctx = new Context(fields), seen = new Map(), imports: Mapped[] = [];
  const resolved = module.imports.map(imp => {
    const imported = at(imp.span, () => imp.path === "Base" ? B.BASE_BEND : realpathSync(resolve(dirname(file), imp.path)));
    const target = modules.get(imported) ?? imported;
    const ns = imp.path === "Base" ? "" : relative(outputDir, target).replace(/\.bend$/, "");
    return { imp, imported, target, ns };
  });
  for (const { imported, target, ns } of resolved) {
    if (!modules.has(imported)) await B.book_load(ctx.book, target, ns, seen, undefined, outputDir);
  }
  for (const path of seen.keys()) inputs?.add(path);
  for (const { imp, target, ns } of resolved) {
    await B.book_load(ctx.book, target, ns, seen, undefined, outputDir, sources);
    if (imp.alias) {
      if (ctx.aliases[imp.alias] !== undefined) throw new SourceError([{ message: "duplicate import alias: " + imp.alias, span: imp.span }]);
      ctx.aliases[imp.alias] = ns;
    }
    imports.push(mapped(imp.path === "Base" ? "import Base\n" : `import ./${relative(outputDir, target)} as ${imp.alias}\n`, imp.span));
  }
  const e = (n: Expr) => emit(n, t => ctx.format(t));
  const binder = (p: Parameter, env?: Map<string, Ty>) => concat(mapped(p.quant + p.name + ": ", p.span),
    p.annotation ? e(p.annotation) : mapped(at(p.span, () => ctx.format(env!.get(p.name)!)), p.span));
  const header = (d: Declaration) => concat(mapped("def " + d.name + "(", d.header),
    joinMapped(d.parameters.map(p => binder(p)), mapped(", ", d.header)), mapped(") -> ", d.header), e(d.result!), mapped(":\n", d.header));
  const signatures = concat(...module.declarations.filter(d => d.kind === "def").map(d => concat(header(d), mapped("  ?body\n", d.header))));
  try { B.parse_book(ctx.book, outputDir + "/", signatures.text, "", ctx.aliases); }
  catch (error) { throw bendError(error, [signatures]); }
  function body(statements: Statement[], env: Map<string, Ty>, expected: Ty, indent: number): Mapped {
    const parts: Mapped[] = [];
    for (const [index, statement] of statements.entries()) {
      const m = (text: string) => mapped(text, statement.span);
      const pad = " ".repeat(indent);
      at(statement.span, () => {
        if (index < statements.length - 1 && statement.kind !== "let") throw new Error("only bindings may precede a body's result");
        if (statement.kind === "expr") {
          ctx.infer(statement.value, env, expected);
          parts.push(concat(m(pad), e(statement.value), m("\n")));
        } else if (statement.kind === "let") {
          if (index === statements.length - 1) throw new Error("expected a result after the binding");
          let annotation: Ty | undefined;
          if (statement.annotation) {
            ctx.infer(statement.annotation, env, type("Kind")); annotation = ctx.value(statement.annotation, env);
          }
          const value = ctx.infer(statement.value, env, annotation);
          ctx.pattern(statement.pattern, value, env);
          parts.push(concat(m(pad + (statement.erased ? "-" : "")), e(statement.pattern),
            ...(statement.annotation ? [m(": "), e(statement.annotation)] : []), m(" = "), e(statement.value), m("\n")));
        } else {
          statement.values.forEach(value => ctx.infer(value, env));
          parts.push(concat(m(pad + "match "), joinMapped(statement.values.map(e), m(", ")), m(":\n")));
          for (const branch of statement.cases) {
            const inner = new Map(env), bm = (text: string) => mapped(text, branch.span);
            branch.patterns.forEach((pattern, i) => ctx.pattern(pattern, statement.values[i].ty!, inner));
            parts.push(concat(bm(pad + "  case "), joinMapped(branch.patterns.map(e), bm(", ")), bm(":\n"), body(branch.body, inner, expected, indent + 4)));
          }
        }
      });
    }
    return concat(...parts);
  }
  const output: Mapped[] = [], diagnostics: Diagnostic[] = [];
  for (const d of module.declarations) {
    try {
      const env = new Map<string, Ty>();
      if (d.kind === "def") {
        const signature = at(d.header, () => ctx.signature(d.name));
        signature.params.forEach(p => { unify(p.value, type(p.name)); env.set(p.name, p.ty); });
        output.push(concat(header(d), body(d.body, env, signature.ret, 2), mapped("\n", d.span)));
        continue;
      }
      d.parameters.forEach(p => env.set(p.name, fresh()));
      for (const p of d.parameters) if (p.annotation) {
        ctx.infer(p.annotation, env, type("Kind"));
        at(p.annotation.span, () => unify(env.get(p.name)!, ctx.value(p.annotation!, env)));
      }
      const premisesEnv = new Map(env);
      for (const w of d.witnesses) {
        ctx.infer(w.annotation!, env, type("Kind"));
        env.set(w.name, ctx.value(w.annotation!, env));
      }
      const value = (d.body[0] as Extract<Statement, { kind: "expr" }>).value;
      ctx.infer(value, env, type("Kind"));
      for (const premise of d.premises) ctx.infer(premise, premisesEnv, type("Kind"));
      const conclusion = concat(mapped("  ", value.span), e(value), mapped("\n", value.span));
      const names = new Set([...env.keys(), ...Object.keys(ctx.aliases), ...Object.keys(ctx.book.tlds)]);
      let hypothesis = 0;
      const premises = d.premises.map(premise => {
        while (names.has("hypothesis" + hypothesis)) hypothesis++;
        return concat(mapped(`  for hypothesis${hypothesis++}: `, premise.span), e(premise), mapped("\n", premise.span));
      });
      output.push(concat(mapped(`law ${d.name}:\n`, d.header),
        ...d.parameters.map(p => concat(mapped("  for ", p.span), binder(p, env), mapped("\n", p.span))),
        ...premises, ...d.witnesses.map(w => concat(mapped("  exs ", w.span), binder(w), mapped("\n", w.span))), conclusion, mapped("\n", d.span)));
    } catch (error) {
      if (!(error instanceof SourceError)) throw error;
      diagnostics.push(...error.diagnostics);
    }
  }
  if (diagnostics.length) throw new SourceError(diagnostics.sort((a, b) => a.span.start - b.span.start));
  if (ctx.projections.size) imports.push(mapped(`import ./${fields.file} as Fields\n`, fields.origins.get(ctx.projections.keys().next().value!)!));
  const origin = { source: module.source, start: 0, end: source.length };
  return concat(...imports, mapped("\n", origin), ...output);
}

export async function desugar(source: string, file: string): Promise<string> {
  return (await desugarMapped(source, file)).text;
}
