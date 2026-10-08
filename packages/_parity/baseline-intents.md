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
