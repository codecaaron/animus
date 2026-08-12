# `@animus-ui/oracle`

A speculative render oracle: a source-level, incremental, counterfactual model
checker and causal debugger for UI rendering. Every other styling substrate is
an open world — the set of rules that can apply to an element is not statically
enumerable — so tools that answer "why does this look like this" have to render
first and reverse-engineer after. Animus's extraction output is a _closed
world_: every rule that can exist, every condition it applies under, and the
source construct that produced it are compiler outputs. The oracle reads those
artifacts and answers questions about rendering with source provenance,
explicit uncertainty and bounded proof, instead of predictive guessing over
pixels or grep. The full rationale, the substrate and the host boundary are in
[`DESIGN.md`](./DESIGN.md).

## Quickstart

```sh
animus build                # writes .animus/{manifest.json,styles.css,commit.json}
bunx animus-oracle inspect --target Alert --at md.dark
```

The CLI reads `./.animus` by default (`--dir <path>` to point elsewhere).
Human output goes to **stderr**; `--json` puts the probe envelope on **stdout**
and nothing on stderr. The exit code is the verdict: `0` settled, `1`
DISPROVED, `2` usage, `3` environment, `4` CONDITIONAL/INCONCLUSIVE.

**Why is this colour wrong?**

```sh
animus-oracle explain --target Alert --property color --symptom unexpected-value \
  --expected '#111827' --at 'mode=dark,variant:Alert:variant=outline,variant:Alert:intent=danger'
```

```text
VERDICT ESTABLISHED
  color = #ef4444 … is set by a5e7b19f52a9de29 (…::Alert · compound), authored in
  …/Alert.tsx:716-758. No other declaration competed for it. The value resolves
  through --color-danger. The expected value was '#111827'; the model says '#ef4444'.
FACTS
  color: #ef4444 ← a5e7b19f52a9de29 (…::Alert · compound) @ …/Alert.tsx:716-758
      token:--color-danger --color-danger = #ef4444 under mode 'dark'
NEXT
  simulate-removal [HIGH] simulate removing a5e7b19f52a9de29#color — the winning declaration
```

**What breaks if I remove it?**

```sh
animus-oracle simulate --target Alert --remove color \
  --at 'mode=dark,variant:Alert:variant=outline,variant:Alert:intent=danger'
```

```text
VERDICT ESTABLISHED
  Simulating remove color from rule a5e7b19f52a9de29 … produced 2 semantic changes
  over 133 scenario cells in 10 components (rule-activated × 2). 1 of 1 context
  classes changed. Properties moved: color.
SEMANTIC DIFF (2 entries; 1 of 1 context classes changed)
  color: rule-activated #ef4444 → #f5f5f5 @ Alert @ variant:Alert:intent = danger, …
CAUSAL FINDINGS
  MODEL_RELATIVE_INTERVENTION_WITNESS remove color from rule a5e7b19f52a9de29
```

**Does the rule hold everywhere?**

```sh
animus-oracle prove --target Alert --assert 'winner-origin-token:color=--color-danger'
```

```text
VERDICT DISPROVED
  Checked 1 assertion over 6 scenario cells. DISPROVED: 5 cells violate …
WITNESSES
  at variant:Alert:intent = info, variant:Alert:variant = filled
      color = '#171717' does not resolve through --color-danger (it resolves
      through --color-background) …
```

`animus-oracle --help` prints the full grammar: `--at`, the five delta flags
(`--remove`, `--replace`, `--remove-rule`, `--replace-token`, `--force`) and
the five `--assert` kinds.

## The six operations

| Operation  | Question                                                           |
| ---------- | ------------------------------------------------------------------ |
| `inspect`  | What can be established about this target in this context?         |
| `explain`  | Why does this symptom occur / why does this fact have this value?  |
| `simulate` | What changes in a hypothetical world?                              |
| `diff`     | What render semantics changed between two worlds?                  |
| `prove`    | Does this invariant hold across a declared domain?                 |
| `refine`   | Resolve this specific unknown as cheaply and narrowly as possible. |

All six are projections of one render-fact graph and return one envelope
(`ProbeResult`: verdict, summary, facts, derivations, semantic diff, witnesses,
causal findings, assumptions, unknowns, coverage, knowledge delta, next
operations, state id). A seventh entry point, `equivalenceClasses`, partitions
a target's scenario domain into the contexts its cascade cannot distinguish.

## Programmatic API

```ts
import {
  createAnimusHost,
  createOracle,
  loadAnimusArtifacts,
} from '@animus-ui/oracle';

const host = createAnimusHost(loadAnimusArtifacts('.animus'));
const oracle = createOracle(host);

const probe = oracle.inspect({
  target: 'Alert',
  at: { mode: 'dark', 'variant:Alert:intent': 'danger' },
});

console.log(probe.verdict, probe.facts, probe.unknowns);
```

`oracle.explain`, `.simulate`, `.diff`, `.prove`, `.refine` and
`.equivalenceClasses` take request objects of the same shape; deltas
(`WorldDelta`) and assertions (`OracleAssertion`) are plain data.

## Trust model

Verdicts are **scoped**, never absolute. `PROVED` means proved under this
program revision, this scenario domain, this environment profile and this model
version — not "true in every browser under arbitrary runtime code". Everything
the model cannot decide becomes an addressable `UnknownObligation` with an
effect class and discharge options (a geometry question yields an obligation,
never a fabricated pixel value), and an answer that an open obligation touches
is `CONDITIONAL`, not `PROVED`. Repeating a question against an unchanged state
returns `FIXPOINT` with the prior result, so repetition can never be mistaken
for progress. `coverage.outsideModel` lists what the closed universe
deliberately does not model.
