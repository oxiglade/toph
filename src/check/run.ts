import type { Options, Result } from "./engine.ts";

export async function runFile(file: string, options: Options & { law?: string }, onResult?: (r: Result) => void) {
  const start = performance.now();
  const until = start + (options.fileTime ?? 30) * 1000;
  const remaining = () => Math.max(0, until - performance.now());
  let worker: Worker | undefined;
  function ask(message: object | undefined, ms: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("worker deadline")), Math.max(0, Math.min(ms, remaining())));
      worker!.onmessage = ({ data }) => {
        clearTimeout(timer);
        data.kind === "error" ? reject(new Error(data.error)) : resolve(data);
      };
      worker!.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
      if (message) worker!.postMessage(message);
    });
  }
  async function open() {
    const entry = import.meta.url.startsWith("file:///$bunfs/") ? "./check/worker.ts" : "./worker.ts";
    worker = new Worker(new URL(entry, import.meta.url));
    await ask(undefined, 30000);
    return ask({ kind: "load", file }, 30000);
  }
  function timeout(law: string, elapsedMs: number): Result {
    return { law, status: "timeout", seed: options.seed, attempted: 0, accepted: 0, elapsedMs,
      reason: remaining() <= 1 ? "per-file time budget exhausted"
        : "normalizer interrupted; instance counts unavailable" };
  }
  async function execute(law: string, opts: Options): Promise<Result> {
    if (remaining() <= 0) return timeout(law, 0);
    const began = performance.now();
    try {
      if (!worker) await open();
      const time = Math.min(opts.time, remaining() / 1000);
      return (await ask({ kind: "check", law, options: { ...opts, time } }, time * 1000 + 10)).result;
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "worker deadline") throw e;
      worker?.terminate();
      worker = undefined;
      return timeout(law, performance.now() - began);
    }
  }
  const results = new Map<string, Result>();
  const finish = (result: Result) => { results.set(result.law, result); onResult?.(result); };
  try {
    const ready = await open();
    const laws: string[] = options.law ? ready.laws.filter((n: string) => n === options.law) : ready.laws;
    if (!laws.length) throw new Error(options.law ? "law not found: " + options.law : "no laws found");
    const pending: { law: string; cost: number; elapsedMs: number }[] = [];
    for (const law of laws) {
      if (laws.length === 1) { pending.push({ law, cost: 0, elapsedMs: 0 }); continue; }
      const probe = await execute(law, { ...options, n: 1, samples: 1, time: Math.min(0.05, options.time) });
      if (probe.status === "fail" || probe.status === "unknown"
        || (probe.status === "pass" && (ready.closed.includes(law) || Math.min(options.n, options.samples ?? options.n) === 1))) {
        finish(probe);
      } else {
        pending.push({ law, cost: probe.status === "timeout" ? Infinity : probe.elapsedMs,
          elapsedMs: probe.elapsedMs });
      }
    }
    pending.sort((a, b) => a.cost - b.cost);
    for (const item of pending) {
      const time = Math.max(0, options.time - item.elapsedMs / 1000);
      const result = time > 0 ? await execute(item.law, { ...options, time }) : timeout(item.law, 0);
      result.elapsedMs += item.elapsedMs;
      finish(result);
    }
    return { file, options, loadMs: ready.loadMs, wallMs: performance.now() - start,
      results: laws.map(law => results.get(law)!) };
  } finally {
    worker?.terminate();
  }
}
