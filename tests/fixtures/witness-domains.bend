import Base

def Choice() -> Type:
  Exists(Nat, n => {n == n : Nat})

def chosen(p: Choice) -> Nat:
  (n, eq) = p
  n

law nested_choice:
  exs p: Choice
  {chosen(p) == 1n : Nat}

law impossible_hypothesis:
  for h: @p: Choice -> {chosen(p) == 0n : Nat}
  Empty

law witness_input:
  for p: Choice
  {chosen(p) == 0n : Nat}

law checked_hypothesis:
  for h: @eq: {0n == 0n : Nat} -> {eq == {==} : {0n == 0n : Nat}}
  Empty
