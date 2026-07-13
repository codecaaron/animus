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

use oxc::ast::ast::{
    Argument, BindingPattern, CallExpression, Declaration, Expression, Program, Statement,
    VariableDeclarator,
};
use oxc::span::Span;
use serde::Serialize;

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

const BAIL_METHODS: &[&str] = &[];
const CHAIN_METHODS: &[&str] = &["styles", "variant", "compound", "states", "system", "props"];

pub fn walk_program(program: &Program<'_>) -> Vec<ChainDescriptor> {
    let mut chains = Vec::new();
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    if let Some(chain) = try_extract_chain(declarator) {
                        chains.push(chain);
                    }
                }
            }
            // export default chains are uncommon in Animus — v1 skips them.
            Statement::ExportDefaultDeclaration(_) => {}
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for declarator in &decl.declarations {
                        if let Some(chain) = try_extract_chain(declarator) {
                            chains.push(chain);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    chains
}

fn try_extract_chain(declarator: &VariableDeclarator<'_>) -> Option<ChainDescriptor> {
    let init = declarator.init.as_ref()?;
    let binding = match &declarator.id {
        BindingPattern::BindingIdentifier(id) => id.name.to_string(),
        _ => return None, // destructuring not supported (v1 parity)
    };
    let call = match init {
        Expression::CallExpression(call) => call.as_ref(),
        _ => return None,
    };
    try_walk_chain(call, binding)
}

fn try_walk_chain(call: &CallExpression<'_>, binding: String) -> Option<ChainDescriptor> {
    let (object, method_name) = match_static_member(&call.callee)?;

    let terminal = match method_name {
        "asElement" => TerminalKind::AsElement,
        "asComponent" => TerminalKind::AsComponent,
        "asClass" => TerminalKind::AsClass,
        _ => return None,
    };

    let tag = extract_terminal_arg(call, &terminal).unwrap_or_default();

    let mut stages = Vec::new();
    let mut extractable = true;
    let mut bail_reason: Option<String> = None;
    let mut has_extend_marker = false;
    let chain_end = call.span;

    let (chain_start, root_identifier) = walk_chain_backwards(
        object,
        &mut stages,
        &mut extractable,
        &mut bail_reason,
        &mut has_extend_marker,
    )?;

    stages.reverse();

    let extends_from = if has_extend_marker {
        Some(root_identifier)
    } else if !stages.is_empty() {
        // PRIMARY CHAIN: method pattern suffices; root NAME is irrelevant
        // (v1 parity — supports `animus.styles(...)` and custom instances).
        None
    } else {
        return None;
    };

    Some(ChainDescriptor {
        binding,
        terminal,
        tag,
        stages,
        extractable,
        bail_reason,
        span: (chain_start, chain_end.end),
        extends_from,
    })
}

fn walk_chain_backwards(
    expr: &Expression<'_>,
    stages: &mut Vec<ChainStage>,
    extractable: &mut bool,
    bail_reason: &mut Option<String>,
    has_extend_marker: &mut bool,
) -> Option<(u32, String)> {
    match expr {
        Expression::Identifier(id) => Some((id.span.start, id.name.to_string())),
        Expression::CallExpression(call) => {
            let (object, method_name) = match_static_member(&call.callee)?;

            if method_name == "extend" {
                if call.arguments.is_empty() {
                    *has_extend_marker = true;
                } else {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some("extend with arguments is not supported".to_string());
                    }
                }
            } else {
                if BAIL_METHODS.contains(&method_name) {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some(format!("{} stage not supported", method_name));
                    }
                }
                if CHAIN_METHODS.contains(&method_name) || BAIL_METHODS.contains(&method_name) {
                    // v1 parity: zero-arg known methods record NOTHING and
                    // do not bail.
                    if let Some(arg_span) = first_arg_span(call) {
                        let second_arg_span = if method_name == "compound" {
                            second_arg_span_fn(call)
                        } else {
                            None
                        };
                        stages.push(ChainStage {
                            method: method_name.to_string(),
                            arg_span: (arg_span.start, arg_span.end),
                            second_arg_span: second_arg_span.map(|s| (s.start, s.end)),
                        });
                    }
                } else {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some(format!("unknown chain method: {}", method_name));
                    }
                }
            }

            walk_chain_backwards(object, stages, extractable, bail_reason, has_extend_marker)
        }
        _ => None,
    }
}

fn match_static_member<'a, 'b>(expr: &'a Expression<'b>) -> Option<(&'a Expression<'b>, &'a str)> {
    match expr {
        Expression::StaticMemberExpression(member) => {
            Some((&member.object, member.property.name.as_str()))
        }
        _ => None,
    }
}

fn extract_terminal_arg(call: &CallExpression<'_>, terminal: &TerminalKind) -> Option<String> {
    match terminal {
        TerminalKind::AsClass => Some(String::new()),
        _ => {
            let first_arg = call.arguments.first()?;
            match terminal {
                TerminalKind::AsElement => match first_arg {
                    Argument::StringLiteral(lit) => Some(lit.value.to_string()),
                    _ => None,
                },
                TerminalKind::AsComponent => match first_arg {
                    Argument::Identifier(id) => Some(id.name.to_string()),
                    _ => Some("unknown".to_string()),
                },
                TerminalKind::AsClass => unreachable!(),
            }
        }
    }
}

/// v1-parity argument span: the EXACT variant list from v1's macro; kinds
/// outside it (e.g. arrow functions) fall back to the whole call span.
macro_rules! get_arg_span {
    ($arg:expr, $fallback:expr) => {
        match $arg {
            Argument::SpreadElement(x) => x.span,
            Argument::BooleanLiteral(x) => x.span,
            Argument::NullLiteral(x) => x.span,
            Argument::NumericLiteral(x) => x.span,
            Argument::BigIntLiteral(x) => x.span,
            Argument::RegExpLiteral(x) => x.span,
            Argument::StringLiteral(x) => x.span,
            Argument::TemplateLiteral(x) => x.span,
            Argument::Identifier(x) => x.span,
            Argument::ObjectExpression(x) => x.span,
            Argument::ArrayExpression(x) => x.span,
            Argument::CallExpression(x) => x.span,
            _ => $fallback,
        }
    };
}

fn second_arg_span_fn(call: &CallExpression<'_>) -> Option<Span> {
    call.arguments
        .get(1)
        .map(|arg| get_arg_span!(arg, call.span))
}

fn first_arg_span(call: &CallExpression<'_>) -> Option<Span> {
    call.arguments
        .first()
        .map(|arg| get_arg_span!(arg, call.span))
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
