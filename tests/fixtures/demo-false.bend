import Base
import ./bend/proof_insertion_sort/main.bend as Sort
import ./bend/proof_numerics/main.bend as Num
import ./bend/proof_typed_eval/main.bend as TE
import ./bend/io_http_fetch/main.bend as Fetch

law sort_removes_zero:
  for xs: List<&2, Nat>
  {Sort.count(0n, Sort.sort(xs)) == 0n : Nat}

law remainder_is_divisor:
  for +n: Nat
  for +m: Nat
  exs q: Nat
  exs r: Nat
  {(q, r) == Num.divmod(n, 1n+m) : Nat & Nat} & {r == 1n+m : Nat}

law optimizer_is_identity:
  for t: TE.Ty
  for +e: TE.Expr<t>
  {TE.opt(t, e) == e : TE.Expr<t>}

law http_body_is_empty:
  for s: String
  {Fetch.http_body("\r\n\r\n" ++ s) == "" : String}
