#!/usr/bin/env bun
import { main as check } from "./check/cli.ts";
import { errorText } from "./bend.ts";
import { checkBendVersion, version } from "./version.ts";

async function main(args: string[]): Promise<number> {
  checkBendVersion();
  if (args.length === 1 && args[0] === "--version") { console.log(version); return 0; }
  return check(args);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error("toph: " + errorText(error));
  process.exitCode = 2;
}
