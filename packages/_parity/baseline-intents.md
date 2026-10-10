# Parity baseline refresh journal

Every oracle refresh requires a checked intent here before the privileged
`scripts/verify/refresh-parity-baseline.sh <intent>` command can write the
committed production/development pair. Ordinary parity runs never write it.

- [x] `extract-quirk-shed-inc-07-seed` — seed the v2 oracle after the final
      live-v1 differential passed with 23 production and 27 development
      divergences, all registered; increments 01–06 and 08 are ticked.
- [x] `total-floor-prop-flow-20260713` — refresh the production/development v2
      oracle once after the reviewed total system-prop floor, reachable-component
      bound, and static JSX value enrichment intentionally changed CSS, runtime
      metadata, and generated resolver payloads.
- [x] `review-reachability-hardening-20260713` — refresh after external review
      corrected alias/member/local/dynamic component identity so the system floor
      and reconciliation share one conservative canonical reachability set.
- [x] `embedded-transform-fixture-20260719` — refresh after the reviewed real
      integration fixture replaced the stale string-transform path with a
      self-contained callback whose production-path oracle requires
      callback-specific `width: 8px`; later parity isolated the exact CSS,
      code, and observables drift to `integration/transforms.tsx` in both modes.
      The atomic pair also resnapshots two reviewed, AST-equivalent selector
      fixture comment corrections without changing their non-code surfaces.
- [x] `modern-css-surface-inc03-conditions-20260722` — refresh after the
      reviewed condition-emission increment (K=3 adversarial pass + fix round)
      added four condition-surface corpus units: raw container/media/supports
      block keys plus a registered-alias case supplied via the harness
      condition-alias map. The same run holds every pre-existing unit
      byte-identical (the change's G1 guardrail); these are the oracle's first
      non-breakpoint condition groups.
- [x] `modern-css-surface-inc06-builtins-20260722` — refresh after the
      reviewed built-in condition increment added four builtin-alias corpus
      units (`condition-builtin-{motion,osdark,print,order}`): the nine D8
      built-ins ship at reserved orders 300–380, and the harness alias map
      gained `_osDark`/`_print` at real built-in orders. Every pre-existing
      unit stays byte-identical in the same run (G1), including the blessed
      inc-03 `condition-aliased` unit whose harness `_motionReduce` entry is
      unchanged.
- [x] `modern-css-surface-inc08-container-20260722` — refresh after the
      reviewed ergonomics-survey increment landed the compose-slot container
      card (Root establishes `container-name: card`, slots respond) and the
      registered-`@property` contextual-var consumer — the oracle's first
      compose×container and registered-var units. Every pre-existing unit
      stays byte-identical in the same run (G1).
- [x] `modern-css-surface-corpus-headers-20260722` — comment-only refresh: the
      ten condition/container corpus fixtures' "NOT yet blessed" staging
      headers were stale after their blessings (inc 03/06/08), one fixture
      cited a consumer-lane assertion that did not exist at authoring time
      (now real: the showcase @property pin), and the builtin-motion header
      overclaimed band provenance. No emission-affecting bytes change; every
      unit's css/observables stay byte-identical — only the embedded `code`
      artifacts move.
- [x] `ani-fix-witness-fixtures-20260803` — four candidate-only corpus units
      pinning the ANI batch-1 extraction fixes, no pre-existing unit moves:
      `duplicate-compose-modules` (cross-module compose identity — two modules
      with same-named local slot recipes each namespace under their own
      module's Root class), `extension-compounds` (extension-added compounds
      renumbered against the extending component over the flattened
      parent-first order, pinned at two depths), `compose-default.tsx` (the
      `--pace-default`-keyed inheritance rule propagates an omitted Root
      prop's default; no child-side default override), and
      `compose-slot-bail` (an unresolvable compose slot fails closed with the
      bail diagnostic instead of binding a same-named component from another
      module). The usage-side bare-name keying correction is deliberately NOT
      in this refresh — it lands as its own change with an identity
      concordance + semantic differential, registering the expected
      `duplicate-binding` drift when it does. Every pre-existing unit stays
      byte-identical in the same run.
- [x] `ani-closeout-fixture-batch-20260803` — refresh once after adding the
      two audit-gap corpus fixtures for the ledger closeout change
      (openspec: ani-ledger-closeout, increment 03):
      `inline-asserted-targets.tsx` (ANI-015 — an `as const` tag and an
      `as`-typed component target extract exactly like their bare forms
      after the chain_walk assertion-unwrap fix) and
      `color-family-pass-through.tsx` (ANI-009 — `backgroundColor`/`color`
      longhands resolve semantic tokens at top level and in responsive
      slots; a `borderTopColor` literal passes through). New units only —
      every pre-existing unit stays byte-identical in the same run.
- [x] `member-target-extraction-20260804` — refresh once after
      `inline-asserted-targets.tsx` gained the static-member arm:
      `asComponent(Compound.Item as unknown as typeof Compound.Item)` now
      EXTRACTS (chain_walk resolves dotted static-member paths, peeling
      assertions at every hop) instead of bailing — the 0.1.3 reproduction
      probe 4 gap. Only this unit drifts; every other unit stays
      byte-identical in the same run. CAVEAT (recorded by the follow-up
      refresh below): this refresh also baselined a dev/prod asymmetry it
      did not flag — production reconciliation pruned the wrapped `Item`
      while development kept it.
- [x] `as-component-target-keep-20260804` — refresh once after review fixed
      the dev/prod asymmetry the previous intent baselined: reconciliation
      now keeps `asComponent()` wrap targets (the emitted wrapper calls
      `createComponent(<target>, …)`, merging the target's class onto the
      element, so the target's CSS is runtime-required whenever the wrapper
      renders even though the target never appears as a JSX tag). In
      `inline-asserted-targets.tsx` the production oracle gains the
      `animus-Item-*` padding rule (matching what development always kept)
      and the reconciliation report stops counting `Item` as eliminated.
      Only this unit drifts; every other unit stays byte-identical in the
      same run.
- [x] `extension-bail-witness-20260806` — refresh once after extension-parent
      resolution gained fail-loud bails: in the per-file unit
      `extract/extension-child.tsx`, the parent's relative import resolves
      outside the single-file universe, and the child chain — already absent
      from code and CSS at baseline (a silent drop) — now leaves the
      `could not resolve parent component` bail diagnostic behind. Only this
      unit's diagnostics surface drifts (identical hashes in both modes; the
      combined `extract-all` unit, where the parent is present and the child
      inherits, stays byte-identical). Every other unit stays byte-identical
      in the same run.
- [x] `transform-result-hardening-20260808` — one refresh for the
      transform-result gate (openspec change transform-result-hardening).
      Seam battery: thirteen new `reject-*` cases record the kind:"error"
      rejection (or, for the inline-transform case, dynamic-path
      indifference) for every invalid result shape — object, array, null,
      boolean, undefined, function, symbol, bigint, NaN, ±Infinity — plus
      toString-wrapper and boxed-String representatives that the old
      String() coercion silently accepted; every pre-existing case stays
      byte-identical (the battery's throwing transform is inline and rides
      the dynamic path untouched, and the carriage-return case carries no
      transform, so neither gains the D4 warn here — that visibility drift
      lands in the corpus refresh below). Corpus: `diagnostics` surfaces gain the same warn
      entries wherever fixtures evaluate transforms that throw (parity
      fixtures run without createTransform registration, so named
      transforms throw reference errors); every CSS surface stays
      byte-identical in both modes, and the `extension-compounds` family
      divergence is this same diagnostics-only drift. No other unit moves.
- [x] `transform-result-hardening-file-attribution-20260809` — follow-up
      refresh after the inc-02 review: transform-failure diagnostics that
      drain outside a component resolve now carry the transform's
      registration file (or the `system` sentinel) instead of an empty
      file, and the warn message always names the file. Only
      `parity/multi-custom.tsx` drifts (diagnostics multiset, same count,
      content-only — its warns ride the utility drain); identical hashes in
      both modes; every CSS surface and every other unit byte-identical.
- [x] `register-package-transform-sources-20260809` — corrective refresh.
      **The two `transform-result-hardening-*` intents above recorded a bug as
      expected output.** Their text reads "parity fixtures run without
      createTransform registration, so named transforms throw reference
      errors" — but that is not a harness artifact. The extractor's only
      transform seed was `createTransform()` calls parsed out of project
      files, so transforms shipped _inside_ `@animus-ui/system` (`size`,
      `gridItem`, `gridItemRatio`, `borderShorthand`) were unregisterable for
      every real consumer too, not just for fixtures. The prior refresh
      recorded 32 `... eval failed: <name> is not defined` warns per mode as
      the oracle's expectation, which is what made the gate green over a
      genuine defect.
      Systems now emit `transformSources` (`{ name: sourceText }`, from the
      `transformSource` each `createTransform()` already captures); the loader
      surfaces it, and the engine seeds the evaluator from it before
      project-file sources (which still win on collision).
      Observed drift, harvested from the failing gate, both modes:
      `diagnostics` surfaces drop to empty on `extract/as-class.tsx`,
      `extract/button.tsx`, `extract/layout.tsx`,
      `extract/negative-margin.tsx`, `extract/pkg-consumer.tsx`,
      `integration/button.tsx`, `integration/compounds.tsx`,
      `integration/layout.tsx`, `parity/compose-container-card.tsx`,
      `parity/extension-compounds`, `parity/multi-custom.tsx`; `extract-all`
      goes 15 → 4 (the four survivors are unrelated to transforms).
      CSS surfaces MOVE this time — the reverse of the prior intents' claim —
      because the transforms now actually evaluate instead of falling back to
      the raw value: `extract-all` (+13 bytes), `extract/layout.tsx` (+3),
      `extract/negative-margin.tsx` (+2), `extract/button.tsx` (+8, prod).
      Every delta is a `size()` result replacing a bare numeric. The receipt,
      from `extract/negative-margin.tsx`: the previous oracle recorded
      `top: -16` — an invalid declaration, a bare number on a length property
      — and now records `top: -16px`. The prior baseline was not merely noisy;
      it pinned broken CSS as expected engine output. No previously-CORRECT
      declaration changes meaning.
      Family note: `parity/extension-compounds` carries an
      `expectedVerdict: identical` ANI-008 pin, which by design outranks the
      register (pinned by `refreshFamilyErrors`' "exact but family still
      expects identity" test), so this refresh could not move it directly.
      Its diagnostics were `[]` before the transform-result-hardening refresh
      introduced the spurious warn, and this refresh returns them to `[]` —
      the pin's end state is RESTORED, not broken. The verdict was flipped to
      `registered-divergence` for the duration of the refresh and restored to
      `identical` immediately after; `families.json` is byte-identical to its
      committed state. Open question, deliberately not chased here: the
      transform-result-hardening refresh moved this same pinned unit
      (`[]` → one warn) and should have hit the same gate.
- [x] `svelte-parity-corpus-enumeration-20260810` — corrective refresh after
      the post-review repair. **The `svelte-usage-extraction-poc-corpus-20260809`
      intent above recorded two hollow units as coverage.** The integration
      enumerator filtered `.tsx`/`.mdx` only, so `svelte-usage`'s real
      `definition.ts` chain never enumerated and `svelte-lifecycle`
      (subdirectory-only layout) could never enumerate anything — both units
      advertised 66/66 green while asserting nothing. The enumerator now
      includes `.ts` (parity-branch parity) and refuses to mint a unit from a
      directory that enumerates zero files. Observed drift, both modes:
      `integration/svelte-usage` gains its real surfaces (css 175 → 585
      bytes with the extracted badge chain, `definition.ts` present with
      `hasComponents`, parseCount/fragment keys/sheets move accordingly;
      diagnostics stay empty); `integration/svelte-lifecycle` leaves the
      corpus (unit missing from candidate — its `.svelte` app/external tree
      remains proven by the dedicated real-engine integration tests). Every
      other unit stays byte-identical.
- [x] `svelte-usage-extraction-poc-corpus-20260809` — refresh once after the
      reviewed Svelte pipeline PoC added the `svelte-lifecycle` and
      `svelte-usage` integration fixture directories to the automatically
      discovered parity inventory. These are new units only in both modes;
      their native-engine surfaces are intentionally empty because `.svelte`
      adaptation belongs to the TypeScript ingestion pipeline and is proven by
      the dedicated real-engine integration tests. Every pre-existing parity
      unit stays byte-identical in the same run.
- [x] `test-value-audit-extension-fixture-20260818` — refresh after the
      test-value audit added `fixtures/components/extended.tsx` (a cross-file
      `Button.extend()` chain) so `manifest-shape.test.ts`'s provenance-
      reciprocity tests iterate a non-empty `reverse_provenance` (they were
      vacuous: no prior integration fixture used `.extend()`). The fixture
      enters the automatically discovered parity inventory as a NEW unit only
      (`integration/extended.tsx` · css/code/observables/diagnostics, both
      modes); every pre-existing unit stays byte-identical in the same run
      (65/66 with only the new unit's four unregistered surfaces, corpus
      digest moves accordingly).
- [x] `comment-purge-corpus-digest-20260912` — refresh after the rederivable-
      comment purge (commits d67e642e through cca33fd3) rewrote comment text
      in fixture sources under `packages/_parity/corpus/` and the integration
      fixtures. Only the corpus digest moves: every unit stays byte-identical
      in both modes (66/66, zero divergences, empty register), so the refresh
      re-seals the same output surfaces under the new source digest.
- [x] `negative-token-runtime-admission-20260930` — refresh the two modes
      after carrying configured `negative: true` into runtime metadata for
      `m`, `mb`, `ml`, `mr`, `mt`, `mx`, and `my`. The only changed surface is
      `observables.dynamicPropsJson` in `extract-all`,
      `extract/custom-props.tsx`, `extract/negative-margin.tsx`,
      `extract/system-props.tsx`, and `integration/system-props.tsx`.
      Removing those seven added booleans reproduces every previous unit
      byte-for-byte in both modes; CSS, generated code, diagnostics and all
      other metadata remain identical. Native/runtime negative tokens were
      separately exercised with emitted and inline scales, and browser
      root-size changes preserve their token relationships. This records
      metadata delivery, not approval of the pending independent review.
- [x] `strict-token-miss-omission-20260930` — refresh the two modes and the
      seam battery after strict, populated scales began omitting values that
      name no token. Runtime metadata gains `strict: true` for strict scaled
      props (105 additions per mode in `observables`). Two units author raw
      colors on the strict `borderTopColor` (`rgb(1 2 3)` in
      `parity/color-family-pass-through.tsx`, `var(--current-bg)` in
      `parity/contextual-var-consumer.tsx`); each loses only that declaration
      and gains one attributable `animus.props.strict-token-miss` warning. The
      pinned `compose-default`, `duplicate-compose-modules` and
      `extension-compounds` families authored off-scale `m`/`p` numbers; their
      sources now spell the literal `margin`/`padding` property, so their
      recorded output stays byte-identical and only the corpus digest moves.
      The seam cases `string-passthrough` (`fontSize: '2em'`) and
      `scale-key-float-string` (`p: '8.0'`, formerly the invalid
      `padding: 8.0`) record the same omission. A component's custom prop no
      longer also enters the system utility stream, where it produced invalid
      rules (`density: compact`, `indent: 2`, `pull: -8`, `width: full`,
      `height: full`) and system-map entries that could stand in for the
      custom prop at runtime. `extract-all`, `extract/custom-props.tsx` and
      `parity/multi-custom.tsx` lose exactly those system rules and their
      `systemPropMapJson` keys; the seam case
      `named-transform-cross-file-collision` loses only its stray `q: 3` system
      rule, and its custom-layer collision result is unchanged. Removing the
      added `strict` booleans, the omitted declarations, the stray system rules
      and the new warnings reproduces every previous unit in both modes.
- [x] `strict-token-miss-repair1-20260930` — refresh the two modes after
      the strict-scale repair. Strict props now admit only the CSS-wide and
      per-property keywords their public type admits, so dynamic metadata
      gains a `keywords` list for strict props (26 in `extract-all`) and
      identifiers that name no token are omitted with one
      `animus.props.strict-token-miss` warning each: `color: blue`
      (`extract/bail.tsx`), `color: dynamic` (`extract/per-property-bail.tsx`),
      `color: red` (`parity/string-transforms-literal.tsx`) and the
      undeclared `current-bg` on `borderTopColor` and `bg`
      (`extract/contextual-vars.tsx`, whose theme declares
      `background-current`). The previous oracle recorded each as raw,
      meaningless CSS. A component's custom props now resolve through its own
      configuration: `parity/multi-custom.tsx` emits per-component
      `customPropMap` entries instead of a shared union, and every declared
      custom prop is listed (`"sizing":{}`, `"gap":{}`) so the runtime never
      resolves it through the system map. `parity/color-family-pass-through.tsx`
      and `parity/contextual-var-consumer.tsx` restore their literal-color and
      contextual-variable reads through the unregistered `outlineColor` and
      `borderBlockStartColor` longhands; their omission warnings disappear.
      The pinned `string-transforms-literal` family was flipped to
      `registered-divergence` for this refresh only, following the
      `register-package-transform-sources-20260809` precedent, and `families.json`
      is byte-identical to its committed state afterwards.
- [x] `configured-transform-binding-identity-20261001` — refresh the two
      modes after configured transforms became bound by definition identity
      rather than by readable name. Dynamic metadata gains a `transformId`
      beside `transformName` on the 13 dynamic `size` props of `extract-all`,
      `extract/system-props.tsx` and `integration/system-props.tsx`, and the
      generated registry loop reads `v.transformId` instead of
      `v.transformName` in every unit that binds the registry (`extract-all`,
      `extract/custom-props.tsx`, `extract/negative-margin.tsx`,
      `extract/system-props.tsx`, `integration/system-props.tsx`). In
      `integration/transforms.tsx` the project declaration
      `createTransform('size', …)` no longer replaces the configured `size`
      binding: `Card`'s `width: 4` resolves through the configured callback
      to `4px` instead of the hijacked `8px` in its CSS, sheets and
      component fragments. That unit still requires a real callback
      evaluation (the raw value is `width: 4`); the callback-specific `8px`
      proof now binds the doubling callback through a configured system in
      the integration suite. The seam battery's 13 `reject-*` cases supply
      their callback through the configured channel instead of a project
      declaration and record byte-identical output.
      `named-transform-cross-file-collision` named its transform through the
      unrecognized `transformName` field and recorded an untransformed
      `left: 3`; it now binds `battle` as a configured definition beside two
      same-named project declarations and records the configured result for
      the system prop (`top: 3em`) and the component prop that names it
      (`left: 3em`). The new `-reversed` case records the same output with
      the files in reverse order. Removing the `transformId` fields and
      restoring the loop field reproduces every other unit; no diagnostic
      changes.
- [x] `static-custom-callback-evaluation-20261001` — record the seam battery
      after admitted component callbacks began evaluating known values during
      extraction. In the seam battery only the three inline-callback cases
      move, and every other case stays byte-identical. `inline-transform-multiply`
      gains a custom-layer utility rule `width: 16` for its literal `4`
      beside its unchanged runtime slot. `throwing-transform` takes the
      existing build-time throw policy: one warning naming the inline
      transform and prop, and the raw value `width: 4` as fallback.
      `reject-inline-object-dynamic-path` is renamed `reject-inline-object`:
      its literal now reaches the build-time result gate, so it records the
      existing `error` diagnostic for an `object` result and no declaration
      for that value, while the slot rules stay. The two oracle modes move in
      `extract/custom-props.tsx` and `extract-all` only: `Card`'s literal
      `sizing={100}` now evaluates through its TypeScript-annotated inline
      callback, adding one custom-layer rule `flex-basis: 100px` and the
      matching `"100"` entry in `Card`'s `customPropMap`; the runtime
      callback and slot for `sizing={dynamicSize}` are unchanged. Removing
      that rule and map entry reproduces both previous units.
- [x] `typed-callback-lookup-repair-20261001` — refresh the two modes after
      component-callback static lookups became keyed by the authored value's
      type. Only the transformed code of `extract/custom-props.tsx` and
      `extract-all` moves, in both modes: `Card`'s replacement gains
      `"typedCustomProps":["sizing"]`, because `sizing` is the one callback
      prop with an extracted class; its `"100"` key is unchanged, since a
      number's typed key is its decimal text. CSS, sheets, observables and
      every seam case stay byte-identical. Removing the field reproduces both
      previous units.
- [x] `configured-transform-typed-system-lookup-20261002` — refresh the two
      modes after system props bound to a configured transform began keying
      their static lookups by the authored value's type. Only the code
      surfaces of `extract-all`, `extract/system-props.tsx` and
      `integration/system-props.tsx` move, with the same exact hashes in both
      modes. In each unit, Box's active layout group binds the configured
      size transform, so its replacement imports `typedSystemProps` from the
      virtual system-props module and gains
      `,"typedSystemProps":typedSystemProps` in its createComponent config.
      Text's config stays unchanged. Removing the one import member and one
      config field reproduces all prior code bytes. All 66 units keep their
      CSS, maps, dynamic metadata, diagnostics, hasComponents and parse counts
      unchanged; the seam battery remains 29/29 byte-identical. The corpus
      contains no configured system string literal or rewritten configured
      JSX result, so this refresh records metadata delivery only.
- [x] `configured-custom-prop-runtime-slots-20261002` — record the configured-name custom-prop fallback in the seam battery. An exported component is not proven confined by its observed literal uses, so its configured custom prop keeps a runtime slot beside its unchanged static class. Only `named-transform-cross-file-collision` and `named-transform-cross-file-collision-reversed` change: each gains the base `q` variable-slot rule and its five xs/sm/md/lg/xl breakpoint rules in the custom layer. Their existing literal class, all other CSS and diagnostics stay unchanged; removing those six rules reproduces both prior cases exactly. The other 27 seam cases and both 66-unit corpus oracles are unchanged. Confined components whose values are all covered still prune their slots.
- [x] `custom-utility-layer-namespace-20261003` — give custom atomic utilities a namespace
      distinct from system atomic utilities so identical CSS cannot carry
      custom-layer precedence onto a system-only consumer. System utility
      names keep `animus-u-<hash>`; custom utility names become
      `animus-uc-<hash>`, preserving content-based reuse within each layer
      and the existing rule-order tie-break. In both oracle modes, only
      `extract-all`, `extract/custom-props.tsx` and
      `parity/multi-custom.tsx` change: CSS selectors, matching customPropMap
      references in transformed code, and matching sheetsJson selectors.
      These are nine artifacts per mode, with eleven distinct registered
      hash transitions across the two modes. Only four seam cases change:
      `inline-transform-multiply`, `named-transform-cross-file-collision`,
      its `-reversed` case, and `throwing-transform`. Inverse renaming
      reproduces every prior unit and case exactly. Rule order, declaration
      values, diagnostics, system utility names, declaration binding and
      consuming names, member variables, runtime slots and all other
      observable fields stay unchanged. The remaining 63 oracle units in
      each mode and 25 seam cases are identical.
- [x] `runtime-css-wide-keyword-classes-20261008` — refresh after every value prop that a JSX attribute passes a runtime value gained one class per CSS-wide keyword (`initial`, `inherit`, `unset`, `revert`, `revert-layer`) at the base and at each breakpoint: `animus-u-` rules in the system layer for system props and `animus-uc-` rules in the custom layer for custom props, entered in `systemPropMap` and `customPropMap` (typed keys for transform and callback props, which `typedCustomProps` then lists). Only `extract-all` and `extract/custom-props.tsx` change, in code, CSS and sheetsJson, in both modes. Only additions: every pre-existing rule, class name and map entry stays byte-identical.
- [x] `runtime-slot-current-var-20261008` — refresh after a prop's runtime slot writes its `currentVar` as the static path does: every value prop with `currentVar` and a variable slot gains the `currentVar` write in its slot rule, plus plain `--keep` slot classes at the base and at each breakpoint that leave the `currentVar` alone, and `currentVar` in its `dynamicProps` entry. Only units with such props change, in CSS, sheetsJson and dynamicPropsJson. Every other rule, class name and map entry stays byte-identical.
- [x] `diagnostic-codes-and-locations-20261009` — record the seam battery after every engine diagnostic gained a stable code, and the engine began locating each diagnostic (1-based `line` and `column`) and naming what was dropped (`dropped`). Seventeen of the 29 seam cases change, and only by added fields on existing diagnostics: `code` on 15, `line`, `column` and `dropped` on all 17, and `severity: "warn"` on `throwing-transform`'s warning, which had no code and no severity before. Hosts treat an absent severity exactly like `warn`. CSS, messages, kinds, components, files and every existing severity are identical in all 17 cases, and the other 12 cases are unchanged. The production and development corpus oracles do not change: they compare file, kind, component and message only.
- [x] `output-format-slot-names-and-shorthand-order-20261009` — refresh the production and development oracles and the seam battery for the output-format change, from source base `root/diagnostic-codes` at 6d867368 (CR 17, itself on main 4451f696). Predecessor baselines (sha256): production.json e3c608dfbf42, development.json 26d18df83698, seam-baseline.json 1e9e753f2910. Three approved changes and nothing else. (1) Every runtime slot name changes: a prop name becomes one injective segment ending in an underscore (its kebab spelling for a name of ASCII letters and digits, a double hyphen and the hex of its bytes otherwise), a component prop appends its component hash after the segment, and a declaration member variable names its member the same way; a declaration binding class extends its consuming class, so it changes with it. Utility, keyword, component and variant class names do not change. (2) Utility rules in the system and custom layers order by the first shorthand they reset, in an order that puts a shorthand after every shorthand containing it and keeps a parent's listed order among siblings (the border sides before its aspects), then by breadth, the properties they reset in all, then as before; a rule therefore precedes each rule whose properties it contains, and rules that only overlap keep their order: 288 rule pairs change order in each mode, every one a multi-target rule moving ahead of a single-target rule it contains (mx, my, px, py, size, border-x-color, border-y-color, and a slot that writes its currentVar ahead of its keep class). No pair moves the other way and no partially overlapping pair changes order. Inside style rules, a registered prop whose property the graph names as a shorthand now ranks with the other shorthands: six rules (the card, Button, ButtonContainer and its stroke variant, and Badge bases, and ButtonContainer's fill variant) move border-radius or background-position ahead of declarations it does not overlap. No two overlapping declarations change order, so no declaration that wins changes. (3) The cascade-combos fixture gains PlRawPadding (raw padding beside pl), whose rule emits padding before padding-left. Production changes 9 units and development 10; the rest are byte-identical. Five seam cases change, by slot names only.
- [x] `identifier-scale-miss-warning-20261009` — refresh the production and development oracles after a lone identifier on a scaled property gets the existing `animus.style.unresolved-token-value` warning when its scale does not hold it and it is neither a CSS-wide or property keyword nor a named colour on a colour property. Predecessor baselines (sha256): production.json c6e9db1b693c, development.json 92606f977a29. Only `extract/button.tsx` and `extract-all` change, in both modes, and only by one added warn diagnostic each, on ButtonContainer: its `backgroundImage: 'flowX'` names no key the corpus theme holds, so the emitted `background-image: flowX` is invalid CSS and the warning is a true positive. Every existing diagnostic keeps its order. CSS, code, maps and every other observable are unchanged in all 66 units, and the seam battery stays 29/29 byte-identical.
- [x] `component-fragments-keyed-by-component-id-20261009` — refresh the production and development oracles after component fragments and emission rank are keyed by the component's own `file::binding` id instead of a class-name prefix, and composed rules are carried on the child slot's fragment. Predecessor baselines (sha256): production.json c5119c01557b, development.json b78d37993d79. Five of 66 units change, the same in both modes. Fragment-only: `integration/composition.tsx` (`composition.tsx::Child` gains `composed_variants`), `parity/compose-default.tsx` (`compose-default.tsx::FamStep` gains `composed_variants`) and `parity/duplicate-binding` (gains the `two.tsx::Button` fragment, and `one.tsx::Button` stops holding two.tsx's CSS). Fragments plus order-only CSS: `extract-all` (fragment keys go from 30 to 34, adding `contextual-vars.tsx::Card`, `custom-props.tsx::Card`, `system-props.tsx::Box` and `token-alias.tsx::Card`; `as-class.tsx::Box` and `pkg-consumer.tsx::Card` stop holding another file's CSS; the base and states sheets reorder) and `parity/duplicate-compose-modules` (all four fragments are keyed; `one.tsx::Root` stops holding two.tsx's CSS; both Headers gain `composed_variants`; the base and variants sheets reorder so each file's Header precedes its Root). Every CSS and sheet change is order-only: each sheet holds the same lines. Every composed rule appears in its child's `composed_variants`, and no corpus unit emits composed compounds. Code, diagnostics and every other observable are unchanged, and the seam battery stays 29/29 byte-identical. Family note: three of the moved units carry an `expectedVerdict: identical` pin in `packages/_parity/corpus/families.json`, which by design outranks the register, so this refresh could not move them directly: `parity/duplicate-binding` (family `duplicate-binding`), `parity/duplicate-compose-modules` (family `duplicate-compose-modules`) and `parity/compose-default.tsx` (family `compose-default`). Their verdicts were flipped to `registered-divergence` for the duration of the refresh only and restored to `identical` immediately after; `families.json` is byte-identical to its committed state, and the three pins hold against the refreshed baselines. Every drift was registered at its exact hashes. The `duplicate-binding` family's note says a divergence there must enter the register as `ordering`. This refresh's drift in that unit is not a cascade-order change: its CSS and rule order are unchanged, and only fragment attribution moves, so it was registered as `intentional-correctness`. The order-only CSS drifts, in `extract-all` (both modes) and `parity/duplicate-compose-modules`, were registered as `ordering`.
- [x] `identity-uncertainty-summary-20261009` — refresh the production and development oracles after a production analysis reports the tags that leave usage identity-uncertain: one `animus.usage.identity-uncertain` warning (warn), file `usage`, component `whole-component removal`, which counts the tags and their files, counts them by kind, names up to three examples and says that no extracted component is removed as unused; and one `animus.usage.identity-uncertain-tag` record (info, which a host prints only in its verbose log) per file and tag, naming what the tag is. Predecessor baselines (sha256): production.json dd33c322c0cb, development.json b5810c845391. Only the production oracle's `diagnostics` change, in three units, by added diagnostics of these two codes only: `extract/pkg-consumer.tsx` gains the warning and two records (`<Box>` and `<FlexBox>`, imported from `@my-ui/components`, which extraction does not analyse); `extract-all` gains the warning and one record (`<FlexBox>`; there its `<Box>` resolves by name to the Animus `Box` components that `as-class.tsx` and `system-props.tsx` declare, so it leaves usage certain); and `integration/mdx-rendering` gains the warning and four records (`<MDXLayout>`, `<_components.h1>`, `<_components.p>` and `<_components.code>`, bindings inside the compiled MDX function). Every existing diagnostic keeps its order. The development oracle does not change: development keeps every component, so both codes are production-only. CSS, code, maps and every other observable are unchanged in all 66 units of both modes, and the seam battery stays 29/29 byte-identical. Family note: `integration/mdx-rendering` carries an `expectedVerdict: identical` pin in `packages/_parity/corpus/families.json` (family `mdx-provider-scope`, which pins that an unimported MDX provider-scope tag counts as rendered usage), and the pin by design outranks the register, so this refresh could not move it directly. Its verdict was flipped to `registered-divergence` for the duration of the refresh only and restored to `identical` immediately after; `families.json` is byte-identical to its committed state, and the pin holds against the refreshed baselines. Its drift is added diagnostics only, so the usage it pins is unchanged; it was registered as `intentional-correctness`, like the other two units' drifts.
- [x] `svg-paint-keywords-20261009` — refresh the production and development oracles after `fill` and `stroke` admit the SVG `<paint>` keywords `context-fill`, `context-stroke` and `none`, regenerated into `css_keywords.json` from their type. Predecessor baselines (sha256): production.json 20b42783d9a5, development.json bca99acb0c9d. Three of 66 units change, the same in both modes: `extract-all`, `extract/system-props.tsx` and `integration/system-props.tsx`. Each changes only in `dynamicPropsJson`, where the `keywords` lists of the `fill` and `stroke` entries gain those three keywords. CSS, code, diagnostics, maps and every other observable are unchanged in all 66 units, and the seam battery stays 29/29 byte-identical. Every drift was registered at its exact hashes as `intentional-correctness`.
- [x] `literal-css-wide-keywords-only-20261009` — refresh the production and development oracles after runtime CSS-wide keyword values lose their eager classes: only a literal keyword produces keyword CSS, and a runtime value, keyword or not, goes through the prop's transform into its custom property. This reverses `runtime-css-wide-keyword-classes-20261008`. Predecessor baselines (sha256): production.json d31693bb1793, development.json c727037ba3d2. Two of 66 units change, the same in both modes: `extract-all` and `extract/custom-props.tsx`. The removed rules are the 30 `animus-uc-` keyword rules of the custom prop `sizing` (`flex-basis: initial`, `inherit`, `unset`, `revert` and `revert-layer`, at the base and at each of the five breakpoints), in the CSS and in sheetsJson, plus their 30 keyword-keyed entries in the `sizing` customPropMap of the transformed `custom-props.tsx`. Its `"100"` entry and class are unchanged. Nothing is added. Every other rule, class name, map entry, diagnostic and observable is identical in all 66 units, and the seam battery stays 29/29. Every drift was registered at its exact hashes as `intentional-correctness`.
- [x] `slot-variable-registrations-20261009` — refresh the production and development oracles after every variable a value slot reads, its base and each breakpoint's, is registered as non-inheriting with `@property NAME { syntax: "*"; inherits: false; }`, the rules leading the global sheet. Predecessor baselines (sha256): production.json 81eefa7fe882, development.json 9cc7f2e6f9c5. Only units with value slots change, and only in sheetsJson: the global sheet gains those `@property` rules at its head, one per variable the slot rules read, sorted by name. A currentVar, declaration member variables and runtime asset variables gain no rule. Five units change in each mode, `extract-all`, `extract/custom-props.tsx`, `extract/negative-margin.tsx`, `extract/system-props.tsx` and `integration/system-props.tsx`, which gain 1,344 rules between them per mode; each one's other sheets, and the rest of its global sheet, are byte-identical. The component CSS, code, maps, diagnostics and every other observable are unchanged in all 66 units of both modes, and the seam battery stays 29/29 byte-identical. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `shared-dynamic-slots-20261009` — refresh the production and development oracles after props alike in the properties they write, their `currentVar` and their transform share one dynamic slot: each takes the slot of the first by name, so `h` and `height` both use `animus-dyn-h_` and `--animus-h_`. Predecessor baselines (sha256): production.json ac6ff740df4b, development.json f9f6147cd373. Three of 66 units change, the same in both modes: `extract-all`, `extract/system-props.tsx` and `integration/system-props.tsx`. Each loses the slots of seven merged groups (`height`, `width`, `minHeight`, `maxHeight`, `minWidth`, `maxWidth` and `gridArea`, which now share the slots of `h`, `w`, `minH`, `maxH`, `minW`, `maxW` and `area`): 42 slot rules from the CSS and the system sheet (base and five breakpoints each) and their 42 `@property` registrations from the global sheet. Nothing is added, and every kept rule and registration keeps its order. In `dynamicPropsJson`, those seven props' `varName` and `slotClass` point at the shared slot; every entry stays, and no other field changes. Code, diagnostics, maps and every other observable are unchanged in all 66 units, and the seam battery stays 29/29 byte-identical. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `system-props-definition-order-20261009` — refresh the production and development oracles after a component's runtime config gains `supersededBy`: each system prop mapped to the props the system defines after it that write every property it writes, so that when one element sets both, the later-defined prop takes effect. Predecessor baselines (sha256): production.json ed603c2ea5e4, development.json 0be2bdf6a047. Three of 66 units change, the same in both modes, each only in the transformed code of `system-props.tsx`: `extract-all`, `extract/system-props.tsx` and `integration/system-props.tsx`. Each `Box` config gains `"supersededBy":{"gridArea":["area"],"height":["h"],"maxHeight":["maxH"],"maxWidth":["maxW"],"minHeight":["minH"],"minWidth":["minW"],"width":["w"]}` after its `systemPropNames`, and removing that field gives the baseline code byte for byte. Every other file's code, the CSS, sheets, maps, diagnostics and every other observable are unchanged in all 66 units, and the seam battery stays 29/29 byte-identical. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `style-keys-dead-or-reordered-20261010` — refresh the production and development oracles after two keys of one style block that set one CSS property at one condition add an `animus.style.keys-share-property` warning when the result is surprising: the two keys set exactly the same properties, so one has no effect, or a longhand is written before the shorthand that covers it, which plain CSS would let reset it. A shorthand followed by its longhand, the override idiom, is not reported. Predecessor baselines (sha256): production.json 88d80fd2a5aa, development.json 25f4949c27da. One of 66 units changes, the same in both modes, and only in `diagnostics`: `integration/cascade-combos.tsx` gains one warning, on `PlRawPadding`, whose `pl` is written before the raw `padding` that covers it. Nothing is removed, and every existing diagnostic keeps its order. CSS, code, maps and every other observable are unchanged in all 66 units, and the seam battery stays 29/29 byte-identical. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `semantic-class-identity-20261010` — refresh the production oracle and the seam battery after a production class name hashes the system fingerprint and the definition fingerprint instead of the defining file and binding: `{prefix}-{binding}-{hash}`, the binding segment and every `--prop-option` suffix unchanged. Predecessor baselines (sha256): production.json 0bd011062595, development.json a24cf3a70602, seam-baseline.json bfbafdc8a643. Production changes 62 of 66 units, in code, CSS, componentFragmentsJson and sheetsJson, and only by the 8-hex hash of a component class name (including the escaped multibyte binding segment) and of a component prop's slot names (`animus-dyn-sizing_` and `--animus-sizing_`), which carry the component hash. Within each unit the old and new hashes pair one to one at the same positions, and replacing them reproduces the prior unit byte for byte. Utility class names (`animus-u-` and `animus-uc-`), rule order, declarations, diagnostics, maps and every other observable are unchanged. The four unchanged units, `extract/extension-child.tsx`, `integration/extended.tsx`, `parity/cyclic-extension` and `parity/props-serde-reject.tsx`, emit no component class. In `integration/selector-rules`, PatternC and PatternE have identical definitions, so they now share a hash; their class names still differ by binding. The development oracle does not change: the corpus has no installed files, and in development a project file keeps its location-based name. Only the envelope's `refreshIntent` moves. Fourteen of 29 seam cases change, by the same hash rename only: eleven component classes and three component prop slot names. Their diagnostics are identical, and the other 15 cases are byte-identical. Family note: 13 of the 14 families carry an `expectedVerdict: identical` pin on a unit that changed (every family but `cyclic-extension`), and by design a pin outranks the register. Those verdicts were flipped to `registered-divergence` for the duration of the refresh only and restored immediately after. `families.json` is byte-identical to its committed state, and the pins hold against the refreshed baselines. All 162 drifts were registered at their exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `aliases-keep-authored-order-20261010` — refresh the production and development oracles after selector and condition aliases emit in the order they are written in a style object, like raw selectors and at-rules: no alias is ranked by its selector or by its registered order any more. Predecessor baselines (sha256): production.json fb04f448eab4, development.json b66782eb4e16. One of 66 units changes, the same in both modes: `parity/condition-builtin-order.tsx`, whose `OrderProbe` writes `_motionReduce` before `_osDark` (its comment now says they emit in authored order, where it said registry order; the transformed code does not carry the comment). Its `prefers-reduced-motion: reduce` rule now precedes its `prefers-color-scheme: dark` rule, in the CSS and in the observables; the two rules set different properties (`transition` and `color-scheme`), so no declaration that wins changes. Every rule keeps its content, and code, diagnostics, maps and every other observable are unchanged in all 66 units of both modes. The seam battery stays 29/29 byte-identical. Every drift was registered at its exact hashes as `ordering`, and the register is empty again.
- [x] `slots-follow-proven-usage-20261010` — refresh the production oracle and the seam battery after a complete production analysis gives a component slots only for the props its proven uses write at run time, only at the conditions those writes' known shapes use, and a value proven to be one of a few literals takes static classes instead of a slot. The source base is main 9f3690ab, after `semantic-class-identity-20261010` and `aliases-keep-authored-order-20261010`, so every class and slot name below carries those refreshes' hashes. Predecessor baselines (sha256): production.json d82b624ae754, development.json 51782f8cd809, seam-baseline.json ee1ff61a1343. Four of 66 production units change, and only by removals: `extract/custom-props.tsx`, `extract/negative-margin.tsx`, `extract/system-props.tsx` and `integration/system-props.tsx`. Their uses are literal except `custom-props.tsx`'s `sizing={dynamicSize}`, so each loses every `.animus-dyn-` slot rule (84, 84, 372 and 312) and its `@property` registration in the global sheet, in the CSS and in sheetsJson, and the dropped props' entries in `dynamicPropsJson`; `custom-props.tsx` keeps the six `sizing` slots and their six registrations. In the three units with no slot left, the transformed code drops the `dynamicPropConfig` and `transforms` imports, the transform wiring loop, and the `dynamicPropConfig` argument to `createComponent`. Nothing is added, and every kept rule and registration keeps its order. Development keeps every slot, so its CSS, code and sheets do not change; in the same four units its `dynamicPropsJson` gains `productionConditions: []` on each entry for a prop production removes (14, 14, 68 and 58 entries), which the development runtime reads to warn when a runtime value reaches a slot a production build removes, and nothing else in development changes, and `extract-all` does not change, because its identity-uncertain tags keep the floor. Diagnostics and every other observable are unchanged in all 66 units of both modes. Five of 29 seam cases change, and only by removed slot rules: `inline-transform-multiply`, `named-transform-cross-file-collision` and its `-reversed` case, and `throwing-transform` lose every slot, whose only use is a literal; `reject-inline-object`, whose literal's result is rejected, keeps its base slot and loses its five breakpoint slots, which a scalar never writes. Diagnostics are unchanged in all 29. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `numeric-length-fixture-directives-20261010` — refresh the production and development oracles after the corpus fixture `custom-props.tsx` drops its two `@ts-expect-error` directives and the comment explaining them: a prop whose scale does not close its raw values now type-checks any number on a length property, so `indent={2}` and `pull={-8}` compile and the directives went unused. Predecessor baselines (sha256): production.json af3d0a6d7f35, development.json 1435780f6a6a. Two of 66 units change, the same in both modes, `extract/custom-props.tsx` and `extract-all`, and only in transformed code, which loses exactly those three source lines; the corpus digest moves with the fixture. CSS, sheets, maps, diagnostics and every other observable are unchanged in all 66 units, and the seam battery stays 29/29 byte-identical.
- [x] `prop-names-carry-binding-20261010` — refresh the production and development oracles and the seam battery after a component prop's runtime slot names and declaration names carry the component's binding before its class suffix (`animus-dyn-sizing_Card_09d4b537` and `--animus-sizing_Card_09d4b537`; a binding of anything but ASCII letters and digits is written as a double hyphen and the hex of its bytes), and a class suffix widens to 16 hex only when two definitions under one binding share the 8-hex name, no longer when any two definitions share a suffix. Predecessor baselines (sha256): production.json 872d96f454d6, development.json 0a35ab6dc082, seam-baseline.json 38076ba2b067 (main after `numeric-length-fixture-directives-20261010`). Two of 66 units change, the same in both modes: `extract/custom-props.tsx` and `extract-all`, in code, CSS and sheetsJson, and only by the `Card_` inserted in the names of the `sizing` slot; removing it reproduces each prior artifact byte for byte. Class names, rule order, declarations, diagnostics, maps and every other observable are unchanged in all 66 units: the corpus has no component declaration prop and no suffix collision. One of 29 seam cases changes, `reject-inline-object`, whose `zap` slot becomes `animus-dyn-zap_C_dfd00606` and `--animus-zap_C_dfd00606`; the other 28 are byte-identical.
- [x] `package-receivers-leave-usage-proven-20261010` — refresh the production and development oracles after an identity-uncertain tag blocks only what it can reach. A tag imported from a package extraction does not analyse (or a member of one), and an ordinary component that passes its children on to one, can only receive our elements, and the components whose elements it receives already open; so it no longer turns off the project-wide usage proof. A parameter, an unresolved relative or aliased import, or any other tag that may be one of our components still does. Predecessor baselines (sha256): production.json 78c77c4abdf6, development.json 341ce6c171e3. One of 66 units changes in each mode: `extract-all`, whose only uncertain tag was `<FlexBox>` from `@my-ui/components` in `pkg-consumer.tsx`. In production it loses 60 slot rules, in the CSS and the system sheet, and their 60 `@property` registrations from the global sheet, and 10 of its 68 `dynamicPropsJson` entries, for props no runtime use writes; nothing is added and every kept rule keeps its order. In development, which keeps every slot, the same 10 entries gain `productionConditions: []`. Code, diagnostics and every other observable are unchanged in all 66 units of both modes, and the seam battery stays 29/29. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
- [x] `stable-const-style-spreads-20261010` — refresh the production and development oracles after a stable module-scope `const` object spread into a style object extracts as if its properties were written inline, in authored order. Predecessor baselines (sha256): production.json 6ba7d2d5b732, development.json 893e9d45850b. Two of 66 units change in each mode, `extract/per-property-bail.tsx` and `extract-all`, both through `per-property-bail.tsx`'s `SpreadComponent` (`ds.styles({ ...baseStyles, color: 'primary' })` with `const baseStyles = { display: 'flex' }`), which no longer drops its chain. Both modes lose that chain's one `bail` diagnostic ("spread element in style object"), and its transformed code becomes `createComponent('div', 'animus-SpreadComponent-5f5e0976', {})`. The fixture's comment above it, which said the component must not be extracted, now says it extracts as if written inline, and the transformed code carries that comment. Development, which keeps every component, also gains its one rule, `.animus-SpreadComponent-5f5e0976 { display: flex; color: var(--color-primary); }`, in the CSS, the base sheet and the component fragments. Production prunes the unrendered component, so its CSS, sheets and fragments do not change. Nothing else changes: every other rule, class name, diagnostic, map and observable is identical in all 66 units of both modes, and the seam battery stays byte-identical. Every drift was registered at its exact hashes as `intentional-correctness`, and the register is empty again.
