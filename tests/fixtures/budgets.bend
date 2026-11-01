import Base

law sparse:
  for +n: Nat
  for eq: {n == 0n : Nat}
  {n == 0n : Nat}

law closed:
  {1n == 1n : Nat}

law identity:
  for +n: Nat
  {n == n : Nat}
