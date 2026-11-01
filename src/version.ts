import bend from "../vendor/bend/version.json";
import pkg from "../package.json";

export const version = `toph ${pkg.version} (Bend ${bend.version})`;

export function checkBendVersion(): void {
  const executable = Bun.which("bend");
  if (!executable) throw new Error(`toph requires Bend ${bend.version}; bend was not found on PATH`);
  const result = Bun.spawnSync([executable, "version"], { timeout: 10000 });
  const installed = /^bend (\d+\.\d+\.\d+)\s*$/.exec(result.stdout.toString().trim())?.[1];
  if (result.exitCode !== 0 || !installed) throw new Error("could not read the installed Bend version (bend version)");
  if (installed !== bend.version) throw new Error(`toph requires Bend ${bend.version} to match its vendored compiler; found ${installed}`);
}
