# Ops Runbook: <change-name>

<!--
Structured record of external steps that close OUTSIDE the repo — created the
moment a `gate:ops` registry row exists, preserved at archive (apply step 5)
so the change directory's retirement never orphans rollout steps.

- One OPS-<n> row per external action. Each gate:ops registry row in
  tasks.md cites the runbook rows it opens (`ops:OPS-<n>`); a gate:ops row
  may tick once its in-repo work is done and its OPS rows exist here.
- "Recorded in the runbook" must stay auditable, not become a prose bucket:
  every row carries an owner/system, an ordering constraint, a verification
  command, a rollback note, and a CLOSE CONDITION someone can actually test.
- Verification commands live in fenced blocks below the table (same rule as
  the Guardrail Register: table-cell pipe-escaping corrupts copy-paste-run).
- Status: open / done(<date + evidence>) / abandoned(<reason>). An external
  gate may also be tracked change-side as `external:<kebab-slug>` — use the
  SAME slug here so the token greps across artifacts.
-->

| ID    | External action                             | Owner / system   | Ordering constraint                        | Rollback / repair       | Close condition                                                                 | Status |
| ----- | ------------------------------------------- | ---------------- | ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------- | ------ |
| OPS-1 | <e.g. deploy tolerant parsers to editorial> | <team / service> | <before OPS-2 / after change lands / none> | <how to undo or repair> | <testable condition, e.g. external:editorial-tolerant-parser-deployed observed> | open   |
| OPS-2 | <e.g. confirm R2 ListBucket scope>          | <infra>          | <after OPS-1>                              | <n/a — read-only check> | <external:r2-listbucket-confirmed>                                              | open   |

Verification — one fenced block per row, runnable verbatim:

**OPS-1** — expected: `<what confirms it landed>`

```bash
<verification command>
```

**OPS-2** — expected: `<what confirms it>`

```bash
<verification command>
```
