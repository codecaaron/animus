//! The backward chain walk itself.
//!
//! Split out of `chain_walk.rs` unchanged. Discovers `.asElement()` /
//! `.asComponent()` / `.asClass()` terminals and walks the member chain
//! backwards to its root, recording one `ChainStage` per known method.
//!
//! BUG-COMPATIBILITY: the bail rules, the zero-arg `.extend()` marker, and
//! the silent non-recording of zero-arg known methods are v1 outcomes carried
//! verbatim. A behavioural difference here is register material, not a fix.

use oxc::ast::ast::{
    BindingPattern, CallExpression, Declaration, Expression, Program, Statement,
    VariableDeclarator,
};

use super::expr::match_static_member;
use super::terminal::{extract_terminal_arg, first_arg_span, second_arg_span_fn, TerminalArg};
use super::{ChainDescriptor, ChainStage, TerminalKind};

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

    let mut stages = Vec::new();
    let mut extractable = true;
    let mut bail_reason: Option<String> = None;

    let tag = match extract_terminal_arg(call, &terminal) {
        TerminalArg::Resolved(tag) => tag,
        TerminalArg::Unresolvable(reason) => {
            extractable = false;
            bail_reason = Some(format!("{}: {}", method_name, reason));
            String::new()
        }
    };
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
