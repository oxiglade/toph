import Base

type Vec<-n: Nat> is Data:
  VNil{eq: {0n == n : Nat}}
  VCon{k: Nat, head: Nat, tail: Vec<k>, eq: {1n+k == n : Nat}}

type Tree is Data:
  Branch{left: Tree, right: Tree}
  Leaf{a: Nat, b: Nat, c: Nat}

type Alias is Data:
  Alias{n: Nat, xs: Vec<n>, m: Nat, eq: {n == m : Nat}}

law indexed_identity:
  for n: Nat
  for v: Vec<n>
  {v == v : Vec<n>}
