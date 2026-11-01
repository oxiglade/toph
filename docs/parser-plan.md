# Parser implementation plan

The step 2 brief defines the scope: a documented `.law` grammar for Bend
2.0.39, recoverable syntax errors, expression-level inference diagnostics,
and source maps used by both build and check. Existing demos must continue
to audit equal. Checker internals remain outside this change.

1. Add a lexer and recursive-descent module/body parser with a precedence
   expression parser. Preserve source offsets on all nodes. Test recovery,
   comments, multiline syntax, annotations, patterns and every operator.
2. Move desugaring onto that tree. Keep structural signature inference,
   attach inference failures to the smallest responsible expression, and
   emit mapped fragments for all generated text, including projections.
3. Use parsed imports in the dependency builder and translate structured
   Bend errors before temporary output is removed. Test both CLI commands,
   imported helpers, inferred arguments and generated projections.
4. Document grammar and expansion rules with fresh examples. Run construct
   audits, demo proofs, the complete test suite and the standalone build;
   review and commit the result, then write the external step report.

Review cases: malformed input must not disappear; comments and newlines
must not alter strings or scopes; premise names must avoid capture;
imported modules and shared fields must retain their own origins; no
generated character may lack a mapping. No general dependent unification,
proof syntax, foreign definitions or new Bend constructs are promised.
