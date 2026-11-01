import Base

law joint_witnesses:
  for +n: Nat
  exs q: Nat
  exs r: Nat
  {(q, r) == (Nat.add(n, 100n), n) : Nat & Nat} &
  {Nat.add(q, r) == Nat.add(Nat.add(n, 100n), n) : Nat}

law searched_witness:
  exs n: Nat
  {Nat.mul(n, n) == 9n : Nat}

law search_exhausted:
  exs n: Nat
  {Nat.mul(n, n) == 2n : Nat}

law conflicting_witness:
  exs n: Nat
  {(n, n) == (0n, 1n) : Nat & Nat}

law later_constraint:
  exs n: Nat
  {Nat.mul(n, n) == 25n : Nat} & {n == 5n : Nat}
