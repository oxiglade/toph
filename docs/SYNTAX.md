# `.law` syntax for Bend 2.0.39

Toph compiles a module of imports, typed helpers and laws into plain Bend
2.0.39. It infers omitted law parameter types and leading erased call
arguments from signatures and expression constraints. Bend checks the
result before any output is written. The examples below are fresh; the
integration fixtures also exercise six public Bend demos.

## Grammar

This EBNF describes the accepted surface. `INDENT` and `DEDENT` denote
changes in indentation, not literal tokens. A suite uses one consistent
indentation level; nested suites must be deeper. Use spaces, not tabs.
Blank lines and `#` comments are ignored outside strings. LF and CRLF are
accepted. Declaration keywords start in column one.

```ebnf
module       = { import | law | helper } ;
import       = "import", ("Base" | path, "as", name), NEWLINE ;
path         = non_whitespace_path_ending_in_law_or_bend ;
law          = "law", name, ["(", [parameters], ")"], ":", NEWLINE,
               INDENT, {"when", expr, NEWLINE},
               {"exs", typed_parameter, NEWLINE}, expr, NEWLINE, DEDENT ;
helper       = "def", qualified_name, "(", [typed_parameters], ")",
               "->", expr, ":", NEWLINE, INDENT, body, DEDENT ;
parameters   = parameter, {",", parameter}, [","] ;
parameter    = [quantity], name, [":", expr] ;
typed_parameters = typed_parameter, {",", typed_parameter}, [","] ;
typed_parameter  = [quantity], name, ":", expr ;
quantity     = "+" | "-" ;
body         = {binding, NEWLINE}, (expr, NEWLINE | match) ;
binding      = ["-"], pattern, [":", expr], "=", expr ;
match        = "match", terms, ":", NEWLINE, INDENT, case, {case}, DEDENT ;
case         = "case", patterns, ":",
               (expr, NEWLINE | NEWLINE, INDENT, body, DEDENT) ;
terms        = expr, {[","], expr} ;
patterns     = pattern, {[","], pattern} ;
pattern      = name | "_" | "+", name | literal
             | qualified_name, "{", [patterns_with_commas], "}"
             | "[", [patterns_with_commas], "]"
             | "(", pattern, ",", patterns_with_commas, ")"
             | "(", pattern, ")" | natural_successor, pattern
             | pattern, "<>", pattern ;
patterns_with_commas = pattern, {",", pattern}, [","] ;
expr         = primary, {suffix | infix, expr} ;
primary      = qualified_name | literal | "&0" | "&1" | "&2"
             | "(", expr, ")" | "(", expr, ",", arguments, ")"
             | "[", [arguments], "]"
             | "(", expr, ":", expr, ")" | "{", expr, ":", expr, "}"
             | "not", expr | "+", expr | natural_successor, expr
             | ("@" | "&"), [quantity], name, ":", expr, "->", expr ;
suffix       = "(", [arguments], ")" | "{", [arguments], "}"
             | ".", name | "<", arguments, ">" ;
arguments    = expr, {",", expr}, [","] ;
infix        = "*" | "/" | "%" | "+" | "-" | "<>" | "++"
             | "<" | "<=" | ">" | ">=" | "==" | "!="
             | "&&" | "||" | "&" | "->" | "=>" ;
literal      = digits | digits, "n" | string ;
natural_successor = digits, "n+" ;
name         = (letter | "_"), {letter | digit | "_"} ;
qualified_name = name, {".", name} ;
```

Letters in identifiers are ASCII. Names may not be declaration/control
keywords. Strings use double quotes and Bend's escapes; a physical newline
inside a string is an error. Escape validity is checked by Bend. Integers
without a suffix have type `U32`; `23n` has type `Nat`. Numeric range checks
belong to Bend. There are no negative, floating-point or character literals.

The EBNF expression production is resolved by this precedence table,
tightest first:

| Operators | Association |
| --- | --- |
| Calls, constructors, type arguments, fields | left |
| `not`, prefix `+`, natural successor | prefix |
| `* / %` | left |
| `+ -` | left |
| `<> ++` | right |
| `< <= > >=` | left |
| `== !=` | left |
| `&&` | left |
| `||` | left |
| `&` | right |
| `->` | right |
| `=>` | right |

A lambda's left operand is one name, optionally prefixed with `+`.
`@` and `&` binders consume their annotation above arrow precedence and
scope over their body through arrow precedence; parenthesize a function
type annotation or a larger lambda body where necessary. Type argument
syntax attaches directly to a qualified name whose final component starts
with an uppercase letter: `List<Nat>`, `TE.Expr<t>`. Inside angle brackets,
parenthesize arguments containing comparison or lower-precedence operators.
`x < y` is a comparison. Constructors have named heads, such as `Some{x}`.

Parenthesized expressions, argument lists and headers can span lines.
A line may also continue immediately after an infix operator, provided the
next token is indented. Otherwise a newline ends the expression. A closing
delimiter may align with the declaration. A missing delimiter does not
consume the following declaration during recovery. Trailing commas are
accepted in call, constructor, list and parameter lists. A tuple needs at
least two elements; `()` is an empty call argument list, not a value.

## Laws, types and scopes

```law
law bounded(+n: Nat, limit):
  when n < limit
  n <= limit
```

expands to:

```bend
law bounded:
  for +n: Nat
  for limit: Nat
  for hypothesis0: {Nat.is_lt(n, limit) == True{} : Bool}
  {Nat.is_le(n, limit) == True{} : Bool}
```

A plain parameter is affine, `+` is unrestricted and `-` is erased. The
compiler preserves parameter order and quantities. It never infers a
quantity from usage count. `law closed:` and `law closed():` both emit
`law closed:`. Parameter annotations constrain inference; an unused
unannotated parameter is an error at its binder.

Each `when` becomes a fresh affine `for hypothesisN: P(condition)` after
the header parameters, in source order. Names skip header parameters,
existential witnesses, imported aliases and available definitions. Premises
are neither merged nor simplified. A proof that must be referenced or
unrestricted belongs in an explicitly named header parameter.

Typed `exs` binders follow premises, retain their quantities and order, and
remain `exs` in Bend. Each witness is visible in later witness annotations
and the conclusion, never in a premise. Duplicate header or witness names
are rejected. Header order is also the order of Bend's dependent telescope;
Bend rejects references to later binders.

Inference uses imported and local helper signatures, explicit annotations,
constructor signatures and literal types. An equality constrains its two
operands to one type. Tuples infer right-nested products, and lists constrain
element types and quantities without choosing an unresolved quantity.
`List<T>` explicitly uses Bend's default `List<&1, T>`; `+List<T>` selects
`&2`. The same rule applies to other quantified datatypes, such as `Maybe`.
`+D<...>` supplies all leading quantity parameters as `&2`; its surface
arguments omit those quantities.

Function-applied types, such as `IO(Unit)` and `TE.Val(t)`, and indexed
ADTs, such as `TE.Expr<t>`, retain their indices. Arguments occurring in
later parameter types or the result substitute their values as well as
constraining their types. Two different named indices remain different.
This is structural signature inference, without dependent normalization,
instance search or general higher-kinded unification.

## Expression expansion

`E(e)` means expansion in a value position; `P(e)` means expansion where
a proposition/type is expected. Parentheses are inserted to preserve the
parsed tree; they do not change its meaning.

| Surface | Bend expansion |
| --- | --- |
| `a == b` | `{E(a) == E(b) : T}`, where `T` is their common inferred type |
| `a != b` | `{E(a) != E(b) : T}` |
| `{a == b : T}` | `{E(a) == E(b) : E(T)}`, using the explicit operand type |
| `{a != b : T}` | `{E(a) != E(b) : E(T)}` |
| `(e : T)` or `{e : T}` | `{E(e) : E(T)}` |
| `P(b)` for a Boolean expression | `{E(b) == True{} : Bool}` |
| `P(not b)` | `{E(b) == False{} : Bool}` |
| `E(not b)` | `Bool.not(E(b))` |
| `P(a & b)` | `(P(a) & P(b))` |
| `P(a -> b)` | `(P(a) -> P(b))` |
| `a && b`, `a || b` | `(E(a) && E(b))`, `(E(a) || E(b))` |
| `a ++ b` | `(E(a) ++ E(b))`, constraining both operands to `String` |
| `a <> b` | `(E(a) <> E(b))`, constraining `b` to a list of `a`'s type |
| `(a, b, c)` | `(E(a), E(b), E(c))`, with type `A & (B & C)` |
| `[a, b]` | `[E(a), E(b)]` |
| `k{a, b}` | `k{E(a), E(b)}` |
| `f(a, b)` | `E(f)(E(a), E(b))`, plus any recovered erased prefix |
| `x => e`, `+x => e` | `(x => E(e))`, `(+x => E(e))` |
| `@q x: T -> p`, `&q x: T -> p` | `(@q x: E(T) -> P(p))`, `(&q x: E(T) -> P(p))`; `q` is optional `+`/`-` without a space |
| `kn+e` | `kn+(E(e))`, Bend's natural successor syntax |

Names, string contents, numeric literals and explicit quantities are
preserved. Existing Bend list, tuple, constructor and binding semantics
apply. A tuple equality is never split into a conjunction. `not` takes a
Boolean, not an arbitrary proposition. Parentheses around `not b` do not
change the false-lifting rule. Boolean-valued `&&` and `||` are lifted as a
whole when used in a proposition position.

Proposition positions include law conclusions and premises, operands of
`&`/`->`, binder bodies, helper bodies declared `Type` or `Data`, and call
arguments whose signatures expect a type. Expressions already having a
kind remain propositions. Equality is a proposition, not a Boolean test;
use `Nat.is_eq`, `String.eq` and other Base functions for Boolean equality.

For numeric operands of resolved type `T`:

| Operator | Bend expansion |
| --- | --- |
| `+ - * / %` | `T.add`, `T.sub`, `T.mul`, `T.div`, `T.mod`, each applied to `E(a), E(b)` |
| `< <= > >=` | `T.is_lt`, `T.is_le`, `T.is_gt`, `T.is_ge`, each applied to `E(a), E(b)` |

Those functions must exist and have the appropriate signatures. No
coercion, reassociation or arithmetic simplification is performed. Thus
`1n + 2n * 3n - 4n` becomes
`Nat.sub(Nat.add(1n, Nat.mul(2n, 3n)), 4n)`.
The contiguous `n+` in `1n+p` belongs to successor notation. Arithmetic
addition uses a separate token, as in `1n + p`.

## Erased arguments

A fully saturated call may omit its entire leading erased prefix when the
supplied arguments and expected result determine it uniquely. Toph inserts
the solved values in signature order:

```law
law size(xs: +List<Nat>):
  List.length(xs) == List.length(&2, Nat, xs)
```

Both calls emit `List.length(&2, Nat, xs)`. There is no partial prefix
omission, live-argument omission, default inferred `&2`, or implicit
partial application. An explicit partial call keeps its supplied arguments.
`List.length([])` is ambiguous without further type/quantity context and
reports an error at the call. Constructor parameters are inferred from
fields and expected type according to Bend's constructor signature; the
number of explicit fields must match exactly.

## Helpers and fields

Helpers require typed Bend signatures and preserve their declared binder
quantities. Their bodies use the surface expressions above. Bindings and
matches become the same Bend constructs with expanded expressions:

```law
def sum(pair: Nat & Nat) -> Nat:
  (a, b) = pair
  a + b

def copy(n: Nat) -> Nat:
  match n:
    case 0n: 0n
    case 1n+p: 1n+copy(p)
```

`sum`'s result becomes `Nat.add(a, b)`. `copy` keeps its cases and recursive
call. Cases can contain nested bodies and matches. Each match has exactly
one pattern per scrutinee. Pattern binders, constructor fields, tuple/list
patterns, wildcards, `+` markers and successor patterns keep their Bend
meaning. Local bindings scope over the remaining body; branch bindings
remain within that branch. Bend still enforces matchability, exhaustiveness,
quantities and decreasing recursion. A computed match scrutinee may parse
but be rejected by Bend. Typed and erased local bindings are supported;
parallel bindings and semicolon-separated bodies are not.

`receiver.field` requires an already known, monomorphic datatype with one
constructor and the named field. For an imported record
`Counter{value: Nat}`, `r.value` becomes
`Fields.project.Module0.Counter.value(r)`. Its shared companion contains:

```bend
import Base
import ./records.bend as Module0

def project.Module0.Counter.value(value: Module0.Counter) -> Nat:
  Module0.Counter{f0} = value
  f0
```

`ModuleN` is allocated per defining module. All `.law` modules in a build
share the same getter for a record/field. The receiver is evaluated once;
repeated source projections remain repeated uses. No quantity is changed.
Bend checks generated getters, including attempts to return an erased field.
`Fields` is reserved when projections are used.

Qualified names resolve through imports and definitions. A dotted name
whose first component is a local value is a field access; a suffix on a
computed expression is also a field access. A field name alone never
chooses a record type. Generic records, multiple-constructor projections,
dependent field types and record updates are unsupported.

## Output, maps and errors

`build` compiles `.law` dependencies before their importers, shares field
projections, and validates the complete book. `.bend` imports retain Bend's
meaning; generated import paths are relative to the output directory.
Imported `.law` modules get deterministic companion names based on their
relative paths. Cycles and overwriting an imported implementation are errors.

Each generated `.bend` has a `.bend.map.json` companion. This is Toph's
version-1 interval map, not the JavaScript source-map format:

- `file` is the generated basename; `sources` contains paths relative to
  that output directory, with original text in `sourcesContent`.
- Each `mappings` entry has half-open UTF-16 offsets `start`, `end` in the
  generated text, a `source` index, and `originalStart`, `originalEnd`.
- Every generated character has an origin. Inserted syntax maps to its
  owning expression or binder. Getter bodies map to the first field access
  requesting that getter. EOF errors use the final mapping.

Both `build` validation and `check file.law` use the maps before removing
any temporary output. Bend's import-line removal is accounted for, and
module identity distinguishes equal generated texts from different files.
Bend errors include the original source and generated Bend context.
Quantity errors may point to a binder, as Bend's own checker does.

For example, an inference failure is printed as:

```text
bad.law:3:9: type mismatch: Bool / Nat
3>|   0n == True{}
  |         ^^^^^^
```

Syntax recovery synchronizes at statement and declaration boundaries and
collects several errors in a file. Inference collects errors across
independent declarations; it stops within a failing declaration. Bend
validation reports its first error. Unresolved inferred types point at the
expression requiring them; unused parameters point at their binder.

This frontend does not accept all Bend syntax. Put ADT declarations,
proofs, foreign/unsafe definitions, template binders, `do` blocks, rewrites,
reflection escapes, array syntax, bitwise operators and literal forms not
listed above in imported `.bend` files. Helper signatures must be explicit
Bend types; use `{a == b : T}` for an equality in a helper signature.
General dependent inference and normalization remain outside the grammar's
type-inference contract.
