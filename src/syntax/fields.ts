import { concat, mapped, type Mapped, type Span } from "./source.ts";
export class Fields {
  origins = new Map<string, Span>();
  definitions = new Map<string, string>();
  namespaces = new Map<string, string>();
  constructor(readonly file = "fields.bend") {}
  alias(namespace: string): string {
    if (!this.namespaces.has(namespace)) this.namespaces.set(namespace, "Module" + this.namespaces.size);
    return this.namespaces.get(namespace)!;
  }
  mapped(): Mapped {
    const origin = this.origins.values().next().value!;
    return concat(mapped("import Base\n" + [...this.namespaces].map(([ns, alias]) => `import ./${ns}.bend as ${alias}`).join("\n") + "\n\n", origin),
      ...[...this.definitions].map(([name, text]) => mapped(text + "\n", this.origins.get(name)!)));
  }
  source(): string { return this.mapped().text; }
}
