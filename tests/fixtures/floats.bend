import Base

def rebuild(x: F32) -> F32:
  match x:
    case F32{bits}:
      F32{bits}

def from_bits(x: U32) -> F32:
  match x:
    case U32{bits}:
      F32{bits}

law float_identity:
  for +x: F32
  {rebuild(x) == x : F32}

law signed_zero_differs:
  {0.0 == from_bits(2147483648) : F32}

law opaque_arithmetic:
  {F32.add(1.0, 2.0) == 3.0 : F32}

@unsafe def spin(n: Nat) -> String:
  spin(n)

law io_is_unsupported:
  {IO.print(spin(0n)) == IO.print("hello") : IO(Unit)}
