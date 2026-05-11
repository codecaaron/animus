# Proposal: Docs Site

## Status: Draft

## Summary

Transform the showcase package into a documentation site that serves two purposes: (1) teach a developer how to use Animus in under 15 minutes, and (2) stress-test the extraction pipeline against a real multi-route application with code splitting, lazy loading, shared component chunks, and color mode toggling.

## Motivation

### Documentation Gap

Animus has shipped compound variants, prefix support, theme manifests, lightning CSS integration, and custom prop runtime — but the only consumer-facing documentation is a single-page demo. A developer encountering the library on npm has no getting-started guide, no explanation of why this library exists, and no API reference.

### Engineering Validation Gap

The extraction pipeline has been verified against a monolithic single-page build. Real consumer applications use React Router, lazy routes, and code splitting. We proved in session 18 that code splitting works mechanically (Vite correctly splits lazy routes and extracts shared component chunks), but we have no sustained multi-route application exercising:

- Shared component chunks across routes
- Dynamic props on lazy-loaded pages
- Color mode toggling across the full app
- Compound variants in a docs context
- Custom transforms (fluid, ratio) in real content

### Dogfooding

Every element of the docs site — navigation, sidebar, layout, code blocks, headings, tables — will be built with Animus components using the builder chain. The docs don't just describe the system; they ARE the system.

## Scope

### In Scope

- 5 pages: Home, Why Animus, Getting Started, Core Concepts, API Reference
- React Router with lazy-loaded doc routes
- Shared layout shell with navigation
- New Animus components needed for docs content (sidebar, inline code, headings, tables, lists, color mode toggle, code examples)
- Functional content for all 5 pages
- Color mode toggle (dark/light)

### Out of Scope

- Visual/graphic design (deferred to frontend-design skill)
- Interactive playground / live code editor
- Search functionality
- Versioned documentation
- Blog / changelog
- Component gallery / storybook-style browser
- Mobile-specific responsive optimizations (responsive props will be used but mobile layout is not a primary concern for MVP)

## Route Structure

```
/                → Home (pitch + hero)
/docs            → Why Animus (motivation, overview)
/docs/start      → Getting Started (install → first component)
/docs/concepts   → Core Concepts (builder chain, cascade, tokens)
/docs/api        → API Reference (functions + methods)
```

## New Components Required

All built with Animus builder chain (dogfooding):

| Component | Purpose |
|-----------|---------|
| Sidebar | Docs navigation with active state highlighting |
| InlineCode | Inline code token display |
| Heading | Section headings (h2/h3) with optional anchor links |
| List | Ordered and unordered lists |
| Table | Data tables for API reference |
| ColorModeToggle | Dark/light mode switch |
| CodeExample | Composite: syntax-highlighted code with optional "output" panel showing generated CSS |

## Extraction Stress Test Coverage

| Feature | Exercised By |
|---------|-------------|
| Code splitting | Lazy routes (Home, Why, Start, Concepts, API) |
| Shared chunks | Components used across multiple routes |
| Dynamic props | Per-breakpoint responsive layouts |
| Compound variants | Navigation active states, code example variants |
| Color modes | ColorModeToggle affecting entire app |
| Custom transforms | Fluid typography in headings |
| Global styles | Reset, scrollbar, selection (already present) |
| Token aliasing | Color references throughout |
| Reconciliation | Unused components eliminated from CSS |
| Prefix support | Configurable via vite.config.ts |
