export const checkDefaults = { n: 3000, samples: 100, size: 4, seed: 42, time: 10, fileTime: 30 };

const exitCodes = `Exit codes:
  0  All sampled laws passed, build succeeded, or help/version printed.
  1  At least one replayed counterexample (even if other laws are undecided).
  2  Invalid arguments, input/Bend/build error, or an unknown, vacuous or timed-out
     check with no counterexample.`;

export const checkHelp = `Usage: toph check <LAWS.bend|LAWS.law> [options]
Sample laws and shrink counterexamples. Sampling is not a proof.

Options:
  --law NAME           Check one exact law name (default: all laws).
  --n ATTEMPTS         Maximum attempts per law (positive integer; default: ${checkDefaults.n}).
  --samples ACCEPTED   Accepted sample target per law, capped by --n
                       (positive integer; default: ${checkDefaults.samples}).
  --size N             Generated natural/collection size bound
                       (integer 0..4294967295; default: ${checkDefaults.size}).
  --seed S             Random seed (integer 0..4294967295; default: ${checkDefaults.seed}).
  --time SECONDS       Time budget per law (positive number; default: ${checkDefaults.time}).
  --file-time SECONDS  Time budget per file, including load and scheduling
                       (positive number; default: ${checkDefaults.fileTime}).
  --json               Print a JSON report (default: human-readable text).
  --help               Show this help; use without an input file.

Closed claims run once. U32/F32 generation retains machine boundaries.
.law input is compiled in a temporary directory.

${exitCodes}`;

export const buildHelp = `Usage: toph build <LAWS.law> [-o out.bend]
Compile and validate .law source as Bend.

Options:
  -o FILE  Output .bend file (default: input path with .law replaced by .bend).
           Imported .law helpers, field projections and source maps are written
           beside the output as needed.
  --help   Show this help; use without an input file.

${exitCodes}`;

export const help = `Toph samples Bend laws and compiles .law source.

Commands:
  help       Show all commands, options and exit codes (also: toph --help).
  check      Sample laws in a .bend or .law file.
  build      Compile a .law file to Bend.
  --version  Print the Toph and required Bend versions.

With no arguments, show this help. check and build require the matching Bend
version on PATH. Help and version do not require Bend.

${checkHelp}

${buildHelp}`;
