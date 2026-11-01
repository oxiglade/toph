# Toph

Toph checks [Bend](https://github.com/bendlang/bend) laws before you prove them, and lets you write
them shorter.

Bend 2 lets you state laws your code must keep and prove that it keeps them. `toph check` tests
every law on generated inputs and prints a counterexample when one fails, usually in milliseconds,
so you learn that a law or the code is wrong before anyone spends time on a proof. `toph build`
compiles `.law` files, a shorter syntax for law files, into plain Bend.

Toph is not part of Bend and is not made by the Bend team.

## Install

Download the binary for your platform from the
[releases page](https://github.com/oxiglade/toph/releases) and check it against
`SHA256SUMS`. Toph needs `bend` 2.0.39 on your `PATH` and refuses to run with another version,
since it reads laws with Bend's own parser and checker at that release.

To build from source with [devenv](https://devenv.sh):

```sh
devenv shell -- bun run build   # writes dist/toph
```

## Check laws

```python
law sort_removes_zero:
  for xs: List<&2, Nat>
  {Sort.count(0n, Sort.sort(xs)) == 0n : Nat}
```

```text
$ toph check LAWS.bend
FAIL sort_removes_zero  3/3 accepted (100.0%)  0.001s  seed=42
  first counterexample: 0.000s; 2 shrink checks
  xs = [0n]
  left:  1n
  right: 0n
```

Toph builds inputs from each binder's type, favouring small values, boundary values and values
shared between binders, since that is where laws usually break. A `for` premise filters the inputs,
and the share that passes is reported, so a law whose premise almost never holds is visible. Every
counterexample is shrunk and then replayed on Bend's own normalizer before it is reported.

A pass means no counterexample was found, not that the law holds: the proof is still Bend's job.
On the 43 laws in Bend 2.0.39's demos, Toph decides all but two. One compares two IO programs and
the other depends on a float subtraction the normalizer leaves unevaluated; both are reported as
undecided rather than guessed. `toph check --help` lists the sampling and time limits and the exit
codes.

## Write shorter laws

A `.law` file holds laws only. Types are inferred from the definitions the law uses, `==` needs no
type, `when` takes a Bool premise, and operators and field access work as you would expect. Code and
proofs stay in ordinary `.bend` files.

```python
law sort_perm:
  for +x  : Nat
  for +xs : List<&2, Nat>
  {Sort.count(x, Sort.sort(xs)) == Sort.count(x, xs) : Nat}
```

```python
law sort_perm(+x, +xs):
  Sort.count(x, Sort.sort(xs)) == Sort.count(x, xs)
```

`toph build LAWS.law` writes `LAWS.bend` beside it, which your `PROOF.bend` imports as usual, and
`toph check LAWS.law` builds and checks in one step. Every construct is sugar for existing Bend;
[docs/SYNTAX.md](docs/SYNTAX.md) gives the exact translation of each. Nothing is reordered or
simplified, and a type that cannot be inferred is an error, not a guess. Errors point at the `.law`
line that caused them, including errors Bend reports in the generated code.

## License

Apache-2.0. Toph includes source files from Bend 2.0.39, also Apache-2.0; see
[vendor/bend/NOTICE](vendor/bend/NOTICE).
