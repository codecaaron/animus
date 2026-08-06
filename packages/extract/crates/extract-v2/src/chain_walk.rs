//! Chain discovery over stored ASTs — a read-only pass producing owned
//! chain-descriptor FACTS (spans/ids, no source slices, no code strings).
//!
//! BUG-COMPATIBILITY CONTRACT (design.md D3): this walk replicates v1
//! `chain_walker.rs` OUTCOMES exactly — name-based root capture, zero-arg
//! `.extend()` as extension marker, zero-arg known methods silently
//! unrecorded, unknown methods bail, and v1's argument-span fallback (call
//! span for argument kinds outside v1's macro list). v1's test module is
//! ported verbatim below as the executable contract. Deviations are
//! register material, not improvements.
//!
//! Module layout — the public surface is unchanged; `chain_walk::walk_program`
//! and the descriptor types resolve exactly as before:
//!
//!   `walk`     — the backward chain walk (entry point)
//!   `terminal` — terminal-argument resolution + v1-parity argument spans
//!   `expr`     — expression-shape helpers (leaf; no chain knowledge)

use serde::Serialize;

mod expr;
mod terminal;
mod walk;

pub use walk::walk_program;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalKind {
    AsElement,
    AsComponent,
    AsClass,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainStage {
    pub method: String,
    pub arg_span: (u32, u32),
    pub second_arg_span: Option<(u32, u32)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainDescriptor {
    pub binding: String,
    pub terminal: TerminalKind,
    pub tag: String,
    pub stages: Vec<ChainStage>,
    pub extractable: bool,
    pub bail_reason: Option<String>,
    pub span: (u32, u32),
    pub extends_from: Option<String>,
}

// ─── v1 chain_walker test module, ported VERBATIM as the bug-compatibility
// contract (design.md D3). Do not "fix" expectations here — a behavioral
// difference is a register entry, not a test edit. Source of truth:
// packages/extract/src/chain_walker.rs tests at the port date (2026-07-12).
#[cfg(test)]
mod tests {
    use super::*;
    use crate::owned_ast::OwnedAst;

    fn parse_chains(source: &str) -> Vec<ChainDescriptor> {
        let counter = crate::owned_ast::ParseCounter::new(0);
        let ast = OwnedAst::parse("test.tsx".into(), source.into(), &counter);
        walk_program(ast.program())
    }

    // ── Existing primary-chain tests ──────────────────────────────────────────

    #[test]
    fn finds_simple_styles_chain() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Box = animus.styles({ display: 'flex' }).asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert_eq!(chain.binding, "Box");
        assert_eq!(chain.terminal, TerminalKind::AsElement);
        assert_eq!(chain.tag, "div");
        assert_eq!(chain.stages.len(), 1);
        assert_eq!(chain.stages[0].method, "styles");
        assert!(chain.extractable);
        assert_eq!(chain.extends_from, None);
    }

    #[test]
    fn finds_styles_variant_chain() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Btn = animus
                .styles({ p: 0 })
                .variant({ variants: { fill: { bg: 'blue' } } })
                .asElement('button');
            "#,
        );
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert_eq!(chain.binding, "Btn");
        assert_eq!(chain.tag, "button");
        assert_eq!(chain.stages.len(), 2);
        assert_eq!(chain.stages[0].method, "styles");
        assert_eq!(chain.stages[1].method, "variant");
        assert!(chain.extractable);
        assert_eq!(chain.extends_from, None);
    }

    #[test]
    fn groups_is_extractable() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Box = animus
                .styles({ display: 'flex' })
                .system({ layout: true })
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert!(chains[0]
            .stages
            .iter()
            .any(|s| s.method == "system"));
        assert_eq!(chains[0].extends_from, None);
    }

    #[test]
    fn extracts_as_component_on_primary_chain() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const FlowLink = animus
                .styles({ fontWeight: 400 })
                .asComponent(Link);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].terminal, TerminalKind::AsComponent);
        assert_eq!(chains[0].tag, "Link");
        assert_eq!(chains[0].extends_from, None);
    }

    // ── ANI-015: inline-asserted terminal targets ─────────────────────────────

    #[test]
    fn extracts_as_component_with_inline_as_assertion() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const FlowLink = animus
                .styles({ fontWeight: 400 })
                .asComponent(Link as React.ComponentType);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].tag, "Link");
    }

    #[test]
    fn extracts_as_component_with_satisfies_assertion() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const FlowLink = animus
                .styles({ fontWeight: 400 })
                .asComponent(Link satisfies LinkLike);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].tag, "Link");
    }

    #[test]
    fn extracts_as_element_with_const_assertion() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Box = animus.styles({ display: 'flex' }).asElement('div' as const);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].tag, "div");
    }

    #[test]
    fn extracts_as_component_with_static_member_target() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Wrapped = animus.styles({ p: 8 }).asComponent(Compound.Item);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].tag, "Compound.Item");
    }

    #[test]
    fn extracts_as_component_with_asserted_static_member_target() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Wrapped = animus
                .styles({ p: 8 })
                .asComponent(Compound.Item as unknown as typeof Compound.Item);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].tag, "Compound.Item");
    }

    #[test]
    fn extracts_deep_static_member_paths_with_inner_assertions() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Wrapped = animus
                .styles({ p: 8 })
                .asComponent((Ns as any).Compound.Item);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].tag, "Ns.Compound.Item");
    }

    #[test]
    fn bails_on_computed_member_as_component_target() {
        // Computed access stays a bail even with a literal key — evaluation
        // territory, and the bail is loud (named reason), never silent.
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Wrapped = animus.styles({ p: 8 }).asComponent(Compound['Item']);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(!chains[0].extractable);
        assert!(chains[0]
            .bail_reason
            .as_deref()
            .unwrap_or_default()
            .contains("static identifier or member path"));
        assert_ne!(chains[0].tag, "unknown");
    }

    #[test]
    fn bails_on_unresolvable_as_component_target() {
        // A computed target has no static name to emit; the chain must bail
        // to the runtime path, never emit a placeholder identifier
        // (`createComponent(unknown, …)` is a ReferenceError in the browser).
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const FlowLink = animus
                .styles({ fontWeight: 400 })
                .asComponent(withRouter(Link));
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(!chains[0].extractable);
        assert!(chains[0]
            .bail_reason
            .as_deref()
            .unwrap_or_default()
            .contains("asComponent"));
        assert_ne!(chains[0].tag, "unknown");
    }

    #[test]
    fn finds_multiple_chains() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const A = animus.styles({ p: 0 }).asElement('div');
            const B = animus.styles({ m: 0 }).asElement('span');
            "#,
        );
        assert_eq!(chains.len(), 2);
        assert_eq!(chains[0].binding, "A");
        assert_eq!(chains[1].binding, "B");
        assert_eq!(chains[0].extends_from, None);
        assert_eq!(chains[1].extends_from, None);
    }

    #[test]
    fn finds_exported_chains() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            export const Box = animus.styles({ display: 'flex' }).asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].binding, "Box");
        assert_eq!(chains[0].extends_from, None);
    }

    #[test]
    fn extracts_binding_name() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const ButtonContainer = animus.styles({ p: 0 }).asElement('button');
            "#,
        );
        assert_eq!(chains[0].binding, "ButtonContainer");
        assert_eq!(chains[0].extends_from, None);
    }

    #[test]
    fn props_is_extractable() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Cell = animus
                .styles({ py: 12 })
                .props({ size: { property: 'flexBasis' } })
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert!(chains[0]
            .stages
            .iter()
            .any(|s| s.method == "props"));
        assert_eq!(chains[0].extends_from, None);
    }

    #[test]
    fn handles_states() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Layout = animus
                .styles({ position: 'relative' })
                .states({ loading: { opacity: 0 } })
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].stages.len(), 2);
        assert_eq!(chains[0].stages[1].method, "states");
        assert_eq!(chains[0].extends_from, None);
    }

    #[test]
    fn ignores_non_animus_code() {
        let chains = parse_chains(
            r#"
            const x = 1;
            const y = someOtherLib.method().build();
            function foo() { return 42; }
            "#,
        );
        assert_eq!(chains.len(), 0);
    }

    #[test]
    fn still_bails_on_extend() {
        // .extend(BaseStyles) has an argument → still bails
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Extended = animus
                .styles({ display: 'flex' })
                .extend(BaseStyles)
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(!chains[0].extractable);
        assert!(chains[0]
            .bail_reason
            .as_ref()
            .unwrap()
            .contains("extend"));
    }

    #[test]
    fn groups_and_styles_extractable() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Box = animus
                .styles({ display: 'flex' })
                .system({ layout: true })
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].stages.len(), 2);
        assert_eq!(chains[0].stages[0].method, "styles");
        assert_eq!(chains[0].stages[1].method, "system");
        assert_eq!(chains[0].extends_from, None);
    }

    // ── New extension-chain tests ─────────────────────────────────────────────

    #[test]
    fn extension_chain_recognized() {
        // Button.extend().styles({...}).asElement('button')
        // extends_from: Some("Button"), extractable, stages: ["styles"]
        let chains = parse_chains(
            r#"
            const Extended = Button.extend().styles({ borderRadius: 8 }).asElement('button');
            "#,
        );
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert_eq!(chain.binding, "Extended");
        assert_eq!(chain.terminal, TerminalKind::AsElement);
        assert_eq!(chain.tag, "button");
        assert!(chain.extractable);
        assert_eq!(chain.extends_from, Some("Button".to_string()));
        assert_eq!(chain.stages.len(), 1);
        assert_eq!(chain.stages[0].method, "styles");
    }

    #[test]
    fn extension_chain_with_as_component() {
        // Link.extend().states({...}).asComponent(NextLink)
        // extends_from: Some("Link"), extractable, terminal: AsComponent, tag: "NextLink"
        let chains = parse_chains(
            r#"
            const NavLink = Link.extend().states({ active: { fontWeight: 700 } }).asComponent(NextLink);
            "#,
        );
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert_eq!(chain.binding, "NavLink");
        assert_eq!(chain.terminal, TerminalKind::AsComponent);
        assert_eq!(chain.tag, "NextLink");
        assert!(chain.extractable);
        assert_eq!(chain.extends_from, Some("Link".to_string()));
        assert_eq!(chain.stages.len(), 1);
        assert_eq!(chain.stages[0].method, "states");
    }

    #[test]
    fn extension_chain_extends_from_set() {
        // Verify extends_from captures the exact root identifier name
        let chains = parse_chains(
            r#"
            const Child = Anchor.extend().styles({ color: 'blue' }).asElement('a');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert_eq!(chains[0].extends_from, Some("Anchor".to_string()));
    }

    #[test]
    fn primary_chain_as_component_is_extractable() {
        // animus.styles({}).asComponent(Link) — primary chain, asComponent is extractable
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const StyledLink = animus.styles({ color: 'blue' }).asComponent(Link);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].terminal, TerminalKind::AsComponent);
        assert_eq!(chains[0].tag, "Link");
        assert_eq!(chains[0].extends_from, None);
    }

    #[test]
    fn extend_with_args_still_bails() {
        // animus.styles({}).extend(Base).asElement('div') — extend has argument → bails
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Extended = animus.styles({ p: 0 }).extend(Base).asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(!chains[0].extractable);
        assert!(chains[0]
            .bail_reason
            .as_ref()
            .unwrap()
            .contains("extend"));
    }

    #[test]
    fn extension_and_primary_in_same_file() {
        // File has both a primary chain and an extension chain
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const A = animus.styles({ display: 'flex' }).asElement('div');
            const B = A.extend().styles({ color: 'red' }).asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 2);

        // A is a primary chain
        let a = &chains[0];
        assert_eq!(a.binding, "A");
        assert!(a.extractable);
        assert_eq!(a.extends_from, None);

        // B is an extension chain with extends_from pointing at A
        let b = &chains[1];
        assert_eq!(b.binding, "B");
        assert!(b.extractable);
        assert_eq!(b.extends_from, Some("A".to_string()));
        assert_eq!(b.stages.len(), 1);
        assert_eq!(b.stages[0].method, "styles");
    }

    // ── Unknown method bail tests ─────────────────────────────────────────────

    #[test]
    fn bails_on_unknown_method() {
        // animus.styles({}).unknownMethod({}).asElement('div') — unknown method should bail
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const Box = animus.styles({ display: 'flex' }).unknownMethod({}).asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert!(!chain.extractable);
        assert!(chain
            .bail_reason
            .as_ref()
            .unwrap()
            .contains("unknown chain method"));
    }

    #[test]
    fn bails_on_unknown_method_in_extension() {
        // Button.extend().styles({}).futureAPI({}).asElement('button') — unknown method should bail
        let chains = parse_chains(
            r#"
            const Button2 = Button.extend().styles({ color: 'blue' }).futureAPI({}).asElement('button');
            "#,
        );
        assert_eq!(chains.len(), 1);
        let chain = &chains[0];
        assert!(!chain.extractable);
        assert!(chain.bail_reason.is_some());
    }
}
