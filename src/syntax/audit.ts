import { dirname, resolve } from "node:path";
import { B } from "../bend.ts";

export async function audit(original: string, generated: string) {
  const book = B.book_nil(), seen = new Map();
  const root = dirname(resolve(original));
  await B.book_load(book, resolve(original), "original", seen, undefined, root);
  await B.book_load(book, resolve(generated), "generated", seen, undefined, root);
  B.book_valid(book);
  const rename: Record<string, string> = {};
  for (const name of Object.keys(book.tlds)) {
    if (name.startsWith("original:") && !book.tlds[name.replace("original:", "generated:")]) {
      throw new Error("missing generated definition: " + name);
    }
    if (name.startsWith("generated:")) rename[name] = name.replace("generated:", "original:");
  }
  function rebase(t: any): any {
    if (Array.isArray(t)) return t.map(rebase);
    if (t === null || typeof t !== "object") return t;
    return Object.fromEntries(Object.entries(t).filter(([k]) => k !== "s").map(([k, v]) =>
      [k, k === "k" && typeof v === "string" ? rename[v] ?? v : rebase(v)]));
  }
  return Object.entries(rename).map(([newName, oldName]) => {
    const newer = book.tlds[newName], older = book.tlds[oldName];
    if (!older) throw new Error("missing audit definition: " + newName);
    const sameType = B.term_compare("EQ", book, older.T, B.term_higher(rebase(B.term_lower(newer.T))));
    const sameBody = newer.v === null ? null : older.v !== null && B.term_compare("EQ", book, older.v, B.term_higher(rebase(B.term_lower(newer.v))));
    return { newName, oldName, sameType, sameBody };
  });
}
