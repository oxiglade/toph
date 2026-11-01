#!/usr/bin/env bun
import { main as check } from "./check/cli.ts";
import { errorText } from "./bend.ts";
import { checkBendVersion, version } from "./version.ts";
import { build } from "./syntax/build.ts";

async function main(args: string[]): Promise<number> {
  checkBendVersion();
  if (args.length === 1 && args[0] === "--version") { console.log(version); return 0; }
  if (!args.length || args[0] === "--help") {
    console.log("toph check <LAWS.bend|LAWS.law> [--law NAME] [--n N] [--seed S] [--time SECONDS] [--json]\ntoph build <LAWS.law> [-o out.bend]\ntoph --version");
    return 0;
  }
  if (args[0] === "build") {
    const input = args[1];
    if (!input || (args.length !== 2 && !(args.length === 4 && args[2] === "-o"))) {
      throw new Error("usage: toph build <LAWS.law> [-o out.bend]");
    }
    console.log(await build(input, args[3]));
    return 0;
  }
  return check(args);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error("toph: " + errorText(error));
  process.exitCode = 2;
}
