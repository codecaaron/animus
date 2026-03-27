use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Declaration, Expression, Program, Statement,
    VariableDeclarator,
};
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};

/// Which terminal method sealed the chain.
#[derive(Debug, Clone, PartialEq)]
pub enum TerminalKind {
    AsElement,
    AsComponent,
}

/// A stage in the builder chain.
#[derive(Debug, Clone)]
pub struct ChainStage {
    pub method: String,
    pub arg_span: Span,
    /// Second argument span (used by .compound() for the styles object).
    pub second_arg_span: Option<Span>,
}

/// Describes one complete builder chain found in the source.
#[derive(Debug, Clone)]
pub struct ChainDescriptor {
    pub binding: String,
    pub terminal: TerminalKind,
    pub tag: String,
    pub stages: Vec<ChainStage>,
    pub extractable: bool,
    pub bail_reason: Option<String>,
    /// Byte span of the entire chain expression (from root identifier to terminal's closing paren).
    pub span: Span,
    /// For extension chains: the binding name of the parent component (e.g. "Anchor").
    /// None for primary chains rooted at `animus`.
    pub extends_from: Option<String>,
}

// extend is no longer a universal bail — it is handled specially based on argument count.
const BAIL_METHODS: &[&str] = &[];
const CHAIN_METHODS: &[&str] = &["styles", "variant", "compound", "states", "groups", "props"];

/// Parse source and extract all builder chain descriptors.
pub fn walk_chains<'a>(
    source: &'a str,
    filename: &str,
    allocator: &'a Allocator,
) -> Vec<ChainDescriptor> {
    let source_type = if filename.ends_with(".tsx") {
        SourceType::tsx()
    } else if filename.ends_with(".ts") {
        SourceType::ts()
    } else if filename.ends_with(".jsx") {
        SourceType::jsx()
    } else {
        SourceType::mjs()
    };

    let parse_result = Parser::new(allocator, source, source_type).parse();
    let program = &parse_result.program;

    let mut chains = Vec::new();
    collect_chains_from_program(program, source, &mut chains);
    chains
}

/// Walk top-level statements looking for variable declarations with chain initializers.
fn collect_chains_from_program(
    program: &Program<'_>,
    source: &str,
    chains: &mut Vec<ChainDescriptor>,
) {
    for stmt in &program.body {
        match stmt {
            Statement::VariableDeclaration(decl) => {
                for declarator in &decl.declarations {
                    if let Some(chain) = try_extract_chain(declarator, source) {
                        chains.push(chain);
                    }
                }
            }
            Statement::ExportDefaultDeclaration(_) => {
                // export default chains are uncommon in Animus — skip for now
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(decl)) = &export.declaration {
                    for declarator in &decl.declarations {
                        if let Some(chain) = try_extract_chain(declarator, source) {
                            chains.push(chain);
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Try to extract a chain descriptor from a variable declarator.
fn try_extract_chain(declarator: &VariableDeclarator<'_>, source: &str) -> Option<ChainDescriptor> {
    let init = declarator.init.as_ref()?;

    // Get the binding name
    let binding = match &declarator.id {
        BindingPattern::BindingIdentifier(id) => id.name.to_string(),
        _ => return None, // destructuring not supported
    };

    // Check if init is a terminal call
    let call = match init {
        Expression::CallExpression(call) => call.as_ref(),
        _ => return None,
    };

    try_walk_chain(call, binding, source)
}

/// Walk a call expression to see if it's an animus builder chain terminal.
fn try_walk_chain(
    call: &CallExpression<'_>,
    binding: String,
    source: &str,
) -> Option<ChainDescriptor> {
    // The callee must be a static member expression (e.g., `.asElement`)
    let (object, method_name) = match_static_member(&call.callee)?;

    // Check if this is a terminal
    let terminal = match method_name {
        "asElement" => TerminalKind::AsElement,
        "asComponent" => TerminalKind::AsComponent,
        _ => return None, // Not a terminal — not our chain
    };

    // Extract the tag from the first argument
    let tag = extract_terminal_arg(call, &terminal)?;

    // Walk backwards through the chain collecting stages.
    // Extractability decisions are deferred until after the walk so we know the chain type.
    let mut stages = Vec::new();
    let mut extractable = true;
    let mut bail_reason: Option<String> = None;
    let mut has_extend_marker = false;
    let chain_end = call.span;

    let (chain_start, root_identifier) = walk_chain_backwards(
        object,
        source,
        &mut stages,
        &mut extractable,
        &mut bail_reason,
        &mut has_extend_marker,
    )?;

    // Stages are collected in reverse (terminal-to-root), flip them
    stages.reverse();

    // POST-PROCESSING: determine chain type and final extractability
    let extends_from;

    if has_extend_marker {
        // EXTENSION CHAIN: rooted at a component binding with a zero-arg .extend() call
        extends_from = Some(root_identifier);
        // asComponent IS extractable on extension chains — no additional bail needed
    } else if !stages.is_empty() {
        // PRIMARY CHAIN: any root identifier with recognized chain methods.
        // The method pattern (styles/variant/states/groups/props + terminal) is
        // sufficient to identify a builder chain — the root name is irrelevant.
        // This supports both `animus.styles(...)` and custom instances like
        // `const ds = createAnimus().addGroup(...).build(); ds.styles(...)`.
        extends_from = None;
    } else {
        // No chain methods and no extend marker — not a chain we recognise
        return None;
    }

    Some(ChainDescriptor {
        binding,
        terminal,
        tag,
        stages,
        extractable,
        bail_reason,
        span: Span::new(chain_start, chain_end.end),
        extends_from,
    })
}

/// Walk the chain backwards from the terminal, collecting stages.
///
/// Returns `Some((span_start, root_identifier_name))` where `span_start` is the byte offset of
/// the root identifier and `root_identifier_name` is either `"animus"` (primary chain) or the
/// component binding name (extension chain).
///
/// `has_extend_marker` is set to `true` when a zero-argument `.extend()` call is encountered.
/// A `.extend()` call with one or more arguments is treated as an unrecognised method and causes
/// the walk to bail (sets `extractable = false`).
fn walk_chain_backwards(
    expr: &Expression<'_>,
    source: &str,
    stages: &mut Vec<ChainStage>,
    extractable: &mut bool,
    bail_reason: &mut Option<String>,
    has_extend_marker: &mut bool,
) -> Option<(u32, String)> {
    match expr {
        // Base case: we reached a root identifier (animus or a component binding)
        Expression::Identifier(id) => Some((id.span.start, id.name.to_string())),

        // Recursive case: another method call in the chain
        Expression::CallExpression(call) => {
            let (object, method_name) = match_static_member(&call.callee)?;

            if method_name == "extend" {
                if call.arguments.is_empty() {
                    // Zero-arg .extend() — this is the extension marker.
                    // Do NOT record it as a stage; set the flag and continue walking.
                    *has_extend_marker = true;
                } else {
                    // .extend(SomeArg) — still non-standard, bail.
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason =
                            Some("extend with arguments is not supported".to_string());
                    }
                }
            } else {
                // Check for universal bail methods (currently empty, but kept for future use)
                if BAIL_METHODS.contains(&method_name) {
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason = Some(format!("{} stage not supported", method_name));
                    }
                }

                // Record this stage if it's a known chain method
                if CHAIN_METHODS.contains(&method_name) || BAIL_METHODS.contains(&method_name) {
                    if let Some(arg_span) = first_arg_span(call) {
                        let second_arg_span = if method_name == "compound" {
                            second_arg_span_fn(call)
                        } else {
                            None
                        };
                        stages.push(ChainStage {
                            method: method_name.to_string(),
                            arg_span,
                            second_arg_span,
                        });
                    }
                } else {
                    // Unknown method — bail. We cannot safely extract a chain that calls
                    // methods we don't understand, as they may affect runtime behaviour.
                    *extractable = false;
                    if bail_reason.is_none() {
                        *bail_reason =
                            Some(format!("unknown chain method: {}", method_name));
                    }
                }
            }

            // Continue walking backwards
            walk_chain_backwards(object, source, stages, extractable, bail_reason, has_extend_marker)
        }

        _ => None, // Unrecognised expression — not a chain we handle
    }
}

/// Match a static member expression, returning (object, property_name).
fn match_static_member<'a, 'b>(expr: &'a Expression<'b>) -> Option<(&'a Expression<'b>, &'a str)> {
    match expr {
        Expression::StaticMemberExpression(member) => {
            Some((&member.object, member.property.name.as_str()))
        }
        _ => None,
    }
}

/// Extract the tag string from a terminal call's first argument.
fn extract_terminal_arg(call: &CallExpression<'_>, terminal: &TerminalKind) -> Option<String> {
    let first_arg = call.arguments.first()?;
    match terminal {
        TerminalKind::AsElement => {
            // First arg should be a string literal like 'button'
            match first_arg {
                Argument::StringLiteral(lit) => Some(lit.value.to_string()),
                _ => None,
            }
        }
        TerminalKind::AsComponent => {
            // First arg is a component reference — extract name for identification
            match first_arg {
                Argument::Identifier(id) => Some(id.name.to_string()),
                _ => Some("unknown".to_string()),
            }
        }
    }
}

/// Get the span of the second argument in a call expression.
fn second_arg_span_fn(call: &CallExpression<'_>) -> Option<Span> {
    call.arguments.get(1).map(|arg| match arg {
        Argument::SpreadElement(s) => s.span,
        Argument::BooleanLiteral(l) => l.span,
        Argument::NullLiteral(l) => l.span,
        Argument::NumericLiteral(l) => l.span,
        Argument::BigIntLiteral(l) => l.span,
        Argument::RegExpLiteral(l) => l.span,
        Argument::StringLiteral(l) => l.span,
        Argument::TemplateLiteral(l) => l.span,
        Argument::Identifier(l) => l.span,
        Argument::ObjectExpression(l) => l.span,
        Argument::ArrayExpression(l) => l.span,
        Argument::CallExpression(l) => l.span,
        _ => call.span,
    })
}

/// Get the span of the first argument in a call expression.
fn first_arg_span(call: &CallExpression<'_>) -> Option<Span> {
    call.arguments.first().map(|arg| match arg {
        Argument::SpreadElement(s) => s.span,
        Argument::BooleanLiteral(l) => l.span,
        Argument::NullLiteral(l) => l.span,
        Argument::NumericLiteral(l) => l.span,
        Argument::BigIntLiteral(l) => l.span,
        Argument::RegExpLiteral(l) => l.span,
        Argument::StringLiteral(l) => l.span,
        Argument::TemplateLiteral(l) => l.span,
        Argument::Identifier(l) => l.span,
        Argument::ObjectExpression(l) => l.span,
        Argument::ArrayExpression(l) => l.span,
        Argument::CallExpression(l) => l.span,
        _ => call.span, // fallback to call span
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_chains(source: &str) -> Vec<ChainDescriptor> {
        let allocator = Allocator::default();
        walk_chains(source, "test.tsx", &allocator)
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
                .groups({ layout: true })
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert!(chains[0]
            .stages
            .iter()
            .any(|s| s.method == "groups"));
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
                .groups({ layout: true })
                .asElement('div');
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(chains[0].extractable);
        assert_eq!(chains[0].stages.len(), 2);
        assert_eq!(chains[0].stages[0].method, "styles");
        assert_eq!(chains[0].stages[1].method, "groups");
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
