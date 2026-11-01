import { checkLaw, load } from "./engine.ts";
import { errorText } from "../bend.ts";

let program: Awaited<ReturnType<typeof load>>;
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "load") {
      program = await load(data.file);
      postMessage({ kind: "ready", laws: program.laws, loadMs: program.loadMs });
    } else {
      postMessage({ kind: "result", result: checkLaw(program, data.law, data.options) });
    }
  } catch (e) {
    postMessage({ kind: "error", error: errorText(e) });
  }
};
postMessage({ kind: "boot" });
