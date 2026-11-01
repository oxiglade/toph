import Base

law identity:
  for n: Nat
  {n == n : Nat}

law vacuous:
  for impossible: Empty
  Empty

law structural_witness:
  exs n: Nat
  {Some{n} == Some{5n} : Maybe<Nat>}

law unknown_witness:
  exs n: Nat
  {Nat.add(n, 1n) == 500n : Nat}

law function_input:
  for f: Nat -> Nat
  {f(1n) == 0n : Nat}

law arithmetic:
  for +a: Nat
  for +b: Nat
  {Nat.add(a, b) == Nat.add(b, a) : Nat} &
  {Nat.mul(a, 2n) == Nat.double(a) : Nat} &
  {Nat.div(a, 0n) == 0n : Nat} &
  {Nat.mod(a, 0n) == a : Nat}
