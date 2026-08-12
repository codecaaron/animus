/**
 * The one help text. It is the CLI's contract surface, so it states the
 * grammar of every spec-shaped flag (`--at`, `--assert`, the deltas) rather
 * than pointing at prose elsewhere — an agent that can read `--help` should
 * never have to guess a syntax.
 */
export const USAGE = `animus-oracle — the Animus render oracle (packages/oracle/DESIGN.md)

Usage:
  animus-oracle <command> [options]

Commands:
  inspect   What can be established about this target in this context?
  explain   Why does this property have this value, or why is it missing?
  simulate  What changes in a hypothetical world?
  diff      What render semantics changed between two worlds?
  prove     Does this invariant hold across the declared domain?
  refine    Discharge one unknown obligation as cheaply as possible
  classes   Render-equivalence classes of this target's scenario domain

Per-command options:
  inspect   --target <sel> [--at <spec>]
  explain   --target <sel> --symptom <unexpected-value|missing-declaration>
            --property <p> [--expected <v>] [--at <spec>]
  simulate  --target <sel> [--at <spec>] <delta> [<delta>...]
  diff      --target <sel> [--at <spec>] <delta> [<delta>...]
  prove     --target <sel> --assert <spec> [--assert <spec>...]
            [--max-cells <n>]
  refine    --obligation <id>
  classes   --target <sel>

Shared options:
  --dir <path>  Artifact directory written by \`animus build\`
                (default: ./.animus, resolved from the current directory)
  --json        Write the ProbeResult envelope as JSON to stdout and nothing
                to stderr; without it stdout stays empty
  --help        This text

Targets: a component id (\`src/Alert.tsx::Alert\`) or a bare binding name
(\`Alert\`) when exactly one component binds it. An ambiguous binding is
refused, never guessed.

--at <spec>: a named scenario (\`md.dark\`) or comma-separated bindings
(\`viewport.inline=390,mode=dark,variant:Alert:intent=danger\`). \`true\`,
\`false\` and numeric literals are coerced; every other value stays a string.

Deltas (repeatable; simulate and diff):
  --remove <property>           Remove the declaration that currently WINS
                                <property> on --target at the resolved point
  --replace <property>=<value>  Replace that same winner's value
  --remove-rule <ruleId>:<p>    Remove <p> from an exact rule — the agent
                                form; rule ids come from --json output
  --replace-token=<--var>=<v>   Replace one design token everywhere. The '='
                                form is required when the value starts with a
                                dash; \`--replace-token color-danger=#000\`
                                also works
  --force <dimension>=<value>   Force a scenario binding on both worlds

  --remove and --replace address the CURRENT WINNER, which is why they need
  --target and a point: the winner is resolved by a baseline inspect first.
  --remove-rule names a rule outright and needs neither.

--assert <spec> (prove):
  effective-value:<property>=<value>
  effective-value-in:<property>=<v1>|<v2>[|...]
  winner-origin-token:<property>=<--token>
  mode-invariant:<property>
  no-important

Exit codes:
  0  PROVED / ESTABLISHED / FIXPOINT
  1  DISPROVED
  2  usage error (unknown command or flag, malformed value, bad request)
  3  environment error (the artifact directory is missing or unreadable)
  4  CONDITIONAL / INCONCLUSIVE / OUTSIDE_MODEL — completed, but not clean

Stream discipline: stdout carries machine output only (--json envelopes);
every human-readable line goes to stderr.
`;
