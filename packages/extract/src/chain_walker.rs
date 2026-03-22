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
    /// Byte span of the entire chain expression (from `animus` to terminal's closing paren).
    pub span: Span,
}

const BAIL_METHODS: &[&str] = &["extend"];
const TERMINAL_METHODS: &[&str] = &["asElement", "asComponent"];
const CHAIN_METHODS: &[&str] = &["styles", "variant", "states", "groups", "props"];

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

    // Now walk backwards through the chain collecting stages
    let mut stages = Vec::new();
    let mut extractable = true;
    let mut bail_reason = None;
    let chain_end = call.span;

    // Check bail for asComponent
    if terminal == TerminalKind::AsComponent {
        extractable = false;
        bail_reason = Some("asComponent terminal not supported".to_string());
    }

    let chain_start = walk_chain_backwards(
        object,
        source,
        &mut stages,
        &mut extractable,
        &mut bail_reason,
    )?;

    // Stages are collected in reverse (terminal-to-root), flip them
    stages.reverse();

    Some(ChainDescriptor {
        binding,
        terminal,
        tag,
        stages,
        extractable,
        bail_reason,
        span: Span::new(chain_start, chain_end.end),
    })
}

/// Walk the chain backwards from the terminal, collecting stages.
/// Returns the start position of the chain (the `animus` identifier).
fn walk_chain_backwards(
    expr: &Expression<'_>,
    source: &str,
    stages: &mut Vec<ChainStage>,
    extractable: &mut bool,
    bail_reason: &mut Option<String>,
) -> Option<u32> {
    match expr {
        // Base case: we reached the `animus` identifier
        Expression::Identifier(id) if id.name == "animus" => Some(id.span.start),

        // Recursive case: another method call in the chain
        Expression::CallExpression(call) => {
            let (object, method_name) = match_static_member(&call.callee)?;

            // Check for bail methods
            if BAIL_METHODS.contains(&method_name) {
                *extractable = false;
                if bail_reason.is_none() {
                    *bail_reason = Some("extend stage not supported".to_string());
                }
            }

            // Record this stage if it's a known chain method
            if CHAIN_METHODS.contains(&method_name) || BAIL_METHODS.contains(&method_name) {
                if let Some(arg_span) = first_arg_span(call) {
                    stages.push(ChainStage {
                        method: method_name.to_string(),
                        arg_span,
                    });
                }
            }

            // Continue walking backwards
            walk_chain_backwards(object, source, stages, extractable, bail_reason)
        }

        _ => None, // Not an animus chain
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
    }

    #[test]
    fn bails_on_as_component() {
        let chains = parse_chains(
            r#"
            import { animus } from '@animus-ui/core';
            const FlowLink = animus
                .styles({ fontWeight: 400 })
                .asComponent(Link);
            "#,
        );
        assert_eq!(chains.len(), 1);
        assert!(!chains[0].extractable);
        assert!(chains[0]
            .bail_reason
            .as_ref()
            .unwrap()
            .contains("asComponent"));
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
    }
}
