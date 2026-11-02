import { checkLaw, load } from "./engine.ts";
import { errorText } from "../bend.ts";

let program: Awaited<ReturnType<typeof load>>;
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "load") {
      const start = performance.now();
      program = await load(data.file);
      postMessage({ kind: "ready", laws: program.laws,
        closed: program.laws.filter(name => program.book.tlds[name].n === 0), loadMs: performance.now() - start });
    } else {
      postMessage({ kind: "result", result: checkLaw(program, data.law, data.options) });
    }
  } catch (e) {
    postMessage({ kind: "error", error: errorText(e) });
  }
};
postMessage({ kind: "boot" });
