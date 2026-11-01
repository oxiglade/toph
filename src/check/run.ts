import type { Options, Result } from "./engine.ts";

export async function runFile(file: string, options: Options & { law?: string }, onResult?: (r: Result) => void) {
  const start = performance.now();
  let worker: Worker;
  function ask(message: object | undefined, ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker deadline")), ms);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        data.kind === "error" ? reject(new Error(data.error)) : resolve(data);
      };
      worker.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
      if (message) worker.postMessage(message);
    });
  }
  async function open() {
    const entry = import.meta.url.startsWith("file:///$bunfs/") ? "./check/worker.ts" : "./worker.ts";
    worker = new Worker(new URL(entry, import.meta.url));
    await ask(undefined, 30000);
    return ask({ kind: "load", file }, 30000);
  }
  const results: Result[] = [];
  try {
    const ready = await open();
    const laws = options.law ? ready.laws.filter((n: string) => n === options.law) : ready.laws;
    if (!laws.length) throw new Error(options.law ? "law not found: " + options.law : "no laws found");
    for (let i = 0; i < laws.length; i++) {
      let result: Result;
      try {
        result = (await ask({ kind: "check", law: laws[i], options }, options.time * 1000 + 100)).result;
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "worker deadline") throw e;
        worker!.terminate();
        result = { law: laws[i], status: "timeout", seed: options.seed, attempted: 0, accepted: 0,
          elapsedMs: options.time * 1000, reason: "normalizer interrupted; instance counts unavailable" };
        if (i + 1 < laws.length) await open();
      }
      results.push(result);
      onResult?.(result);
    }
    return { file, options, loadMs: ready.loadMs, wallMs: performance.now() - start, results };
  } finally {
    worker!?.terminate();
  }
}
