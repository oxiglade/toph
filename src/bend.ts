import * as B from "../vendor/bend/bend.ts";

export { B };
export type Term = B.HTerm;

export function errorText(error: any): string {
  return error?.$ === "Err" ? B.err_show(error) : String(error);
}

export function show(term: Term): string {
  return B.term_show(B.term_lower(term));
}
