import { runFile } from "./run.ts";
import type { Options, Result } from "./engine.ts";
import { checkDefaults, checkHelp } from "../help.ts";
import { checkBendVersion } from "../version.ts";

export function format(r: Result): string {
  const share = r.attempted ? (100 * r.accepted / r.attempted).toFixed(1) : "0.0";
  const lines = [`${r.status.toUpperCase()} ${r.law}  ${r.accepted}/${r.attempted} accepted (${share}%)  ${(r.elapsedMs / 1000).toFixed(3)}s  seed=${r.seed}`];
  if (r.status === "fail") {
    lines.push(`  first counterexample: ${(r.firstFailureMs! / 1000).toFixed(3)}s; ${r.shrinkChecks} shrink checks`);
    for (const [name, value] of Object.entries(r.bindings ?? {})) lines.push(`  ${name} = ${value}`);
    lines.push(`  left:  ${r.left}`, `  right: ${r.right}`);
  }
  if (r.reason) lines.push("  " + r.reason);
  if (r.status === "vacuous") lines.push("  no instance passed every hypothesis");
  return lines.join("\n");
}

export async function main(args: string[]) {
  if (args.shift() !== "check" || !args[0] || args[0].startsWith("--")) throw new Error(checkHelp);
  const file = args.shift()!;
  const options: Options & { law?: string } = { ...checkDefaults };
  let json = false;
  while (args.length) {
    const flag = args.shift()!;
    if (flag === "--json") { json = true; continue; }
    if (!["--law", "--n", "--samples", "--size", "--seed", "--time", "--file-time"].includes(flag)) throw new Error("unknown option: " + flag);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error("missing value for " + flag);
    if (flag === "--law") { options.law = value; continue; }
    const n = Number(value);
    if (!Number.isFinite(n) || (["--time", "--file-time"].includes(flag) ? n <= 0 : !Number.isSafeInteger(n))
      || (["--n", "--samples"].includes(flag) && n <= 0)
      || (["--seed", "--size"].includes(flag) && (n < 0 || n > 0xffffffff))) {
      throw new Error("invalid value for " + flag + ": " + value);
    }
    options[flag === "--file-time" ? "fileTime" : flag.slice(2) as "n" | "seed" | "time" | "samples" | "size"] = n;
  }
  checkBendVersion();
  if (!file.endsWith(".law") && !file.endsWith(".bend")) throw new Error("check needs a .bend or .law file");
  const report = await runFile(file, options, json ? undefined : r => console.log(format(r)));
  if (json) console.log(JSON.stringify(report, null, 2));
  else console.log(`Checked ${report.results.length} laws in ${(report.wallMs / 1000).toFixed(3)}s (load/check ${(report.loadMs / 1000).toFixed(3)}s). Sampling is not a proof.`);
  return report.results.some(r => r.status === "fail") ? 1
    : report.results.some(r => r.status !== "pass") ? 2 : 0;
}
