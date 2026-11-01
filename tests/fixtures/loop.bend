import Base

@unsafe def spin(n: Nat) -> Nat:
  spin(n)

law looping:
  {spin(0n) == 0n : Nat}

law following:
  Unit
