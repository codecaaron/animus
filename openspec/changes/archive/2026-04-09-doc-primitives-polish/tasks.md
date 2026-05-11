## 1. ChainStep — States deduplication

- [x] 1.1 Add `.states({ active })` to StepLabel with `{ color: 'primary' }`, delete StepLabelActive
- [x] 1.2 Add `.states({ active })` to LayerLabel with `{ color: '{colors.fire.700}' }`, delete LayerLabelActive
- [x] 1.3 Replace inline wrapper `<div style={{ display: 'flex', ... }}>` with a ds element (StepWrapper)
- [x] 1.4 Update render logic: remove conditional element swap, pass `active={i === activeStep}` to StepLabel and LayerLabel

## 2. Heading — CSS hover + states + button

- [x] 2.1 Add `_hover: { '& [data-anchor]': { opacity: '0.5' } }` to HeadingWrapper styles, remove onMouseEnter/onMouseLeave handlers
- [x] 2.2 Add `.states({ copied: { opacity: '0.6', color: '{colors.forest.500}' } })` to AnchorButton, remove inline style conditional
- [x] 2.3 Change AnchorButton from `.asElement('span')` to `.asElement('button')`, remove `role="button"` and `tabIndex={0}` attrs
- [x] 2.4 Add `_focusVisible` styles to AnchorButton (outline ring, outline-offset)
- [x] 2.5 Update render: pass `copied={copied}` as state prop, remove querySelector and style mutations

## 3. MethodCard — States + accessibility

- [x] 3.1 Add `.states({ expanded: { transform: 'rotate(180deg)' } })` to Chevron, remove inline style
- [x] 3.2 Pass `expanded={expanded}` to Chevron as state prop
- [x] 3.3 Add unique `id` to DetailSection (e.g., `id={method-detail-${name}}`)
- [x] 3.4 Add `aria-controls` to CardHeader button pointing to detail section id
- [x] 3.5 Add `role="region"` and `aria-labelledby` to DetailSection pointing to a header id

## 4. SyntaxBlock — States + token fix

- [x] 4.1 Add `.states({ collapsed: { transform: 'rotate(-90deg)' } })` to CollapseToggle, remove inline style
- [x] 4.2 Pass `collapsed={collapsed}` to CollapseToggle as state prop
- [x] 4.3 Add `.variant({ prop: 'chrome', variants: { true: { borderTop: 'none' }, false: {} } })` to SyntaxPre (or use a compound), remove conditional inline style
- [x] 4.4 Fix `animusTheme.plain.color`: change `tokens.colors.text` to `tokens.varRef('colors.text')`

## 5. Callout — compose() migration

- [x] 5.1 Import `compose` from `@animus-ui/system`
- [x] 5.2 Create `CalloutFamily = compose({ Root: CalloutContainer, Header: CalloutHeader, Icon: CalloutIcon, Title: CalloutTitle, Body: CalloutBody }, { shared: { variant: true } })`
- [x] 5.3 Rewrite convenience wrapper `Callout` to use `CalloutFamily.Root`, `CalloutFamily.Icon`, etc. internally
- [x] 5.4 Verify MDXProvider componentMap still works with the wrapper (no changes needed for MDX authors)
- [x] 5.5 Verify kitchen sink Callout examples render correctly

## 6. TypeSignature — Variant consolidation

- [x] 6.1 Create `TokenSpan` with `.variant({ prop: 'role', variants: { name, generic, punct, param, paramType, return } })` mapping each role to its color
- [x] 6.2 Delete NameSpan, GenericSpan, PunctSpan, ParamNameSpan, ParamTypeSpan, ReturnSpan
- [x] 6.3 Update render to use `<TokenSpan role="name">`, `<TokenSpan role="generic">`, etc.
- [x] 6.4 Verify kitchen sink TypeSignature examples render with correct colors

## 7. Accessibility — Focus rings + keyboard nav

- [x] 7.1 Add `_focusVisible: { outline: '2px solid {colors.scheme.300}', outlineOffset: '2px' }` to CopyButton base styles
- [x] 7.2 Add `_focusVisible` styles to TabGroup TabButton
- [x] 7.3 Implement TabGroup keyboard handler: ArrowLeft/ArrowRight to move between tabs, Home/End for first/last, wrap-around
- [x] 7.4 Implement roving tabindex: active tab `tabIndex={0}`, inactive tabs `tabIndex={-1}`
- [x] 7.5 Add `_focusVisible` styles to Heading AnchorButton (covered in task 2.4, verify)

## 8. Playwright verification baseline

- [x] 8.1 Create Playwright script that navigates to kitchen sink page, sets each of 10 color modes via `data-color-mode` attribute, captures full-page screenshot
- [x] 8.2 Run the script, review screenshots for contrast/token issues across modes
- [x] 8.3 Fix any issues found during visual review (scope TBD based on findings) — No fixes needed: all 10 modes pass visual audit

## 9. Build verification

- [x] 9.1 Run `bun run verify:showcase` — confirm extraction still works, no CSS regressions
- [x] 9.2 Spot-check kitchen sink page in dev server across at least 3 color modes — Verified all 10 via Playwright
