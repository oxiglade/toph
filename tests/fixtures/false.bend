import Base

law successor_is_identity:
  for n: Nat
  {1n+n == n : Nat}

law positive_is_zero:
  for +n: Nat
  for positive: {Nat.is_gt(n, 0n) == True{} : Bool}
  {n == 0n : Nat}

law all_lists_are_empty:
  for xs: List<Nat>
  {xs == [] : List<Nat>}
