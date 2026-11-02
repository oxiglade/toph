import Base

law false_add:
  for +a: U32
  {U32.add(a, 1) == a : U32}

law add_one:
  for +a: U32
  {U32.add(a, 1) == U32.inc(a) : U32}
