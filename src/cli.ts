#!/usr/bin/env bun
import { main as check } from "./check/cli.ts";
import { errorText } from "./bend.ts";
import { checkBendVersion, version } from "./version.ts";
import { build } from "./syntax/build.ts";
import { buildHelp, checkHelp, help } from "./help.ts";

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--version") { console.log(version); return 0; }
  if (!args.length || (args.length === 1 && ["help", "--help"].includes(args[0]))) {
    console.log(help);
    return 0;
  }
  if (args.length === 2 && args[1] === "--help" && ["check", "build"].includes(args[0])) {
    console.log(args[0] === "check" ? checkHelp : buildHelp);
    return 0;
  }
  if (args[0] === "build") {
    const input = args[1];
    if (!input || (args.length !== 2 && !(args.length === 4 && args[2] === "-o"))) {
      throw new Error(buildHelp);
    }
    checkBendVersion();
    console.log(await build(input, args[3]));
    return 0;
  }
  if (args[0] !== "check") throw new Error("unknown command or arguments; use toph help");
  return check(args);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error("toph: " + errorText(error));
  process.exitCode = 2;
}
