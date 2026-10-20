//! `compose()` call detection: the family shape (binding, slots, shared
//! keys, context flag) read from top-level statements.

use oxc::ast::ast::{
    Argument, BindingPattern, Declaration, Expression, ObjectPropertyKind, Program, Statement,
};

use super::value_eval::eval_property_key;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ComposeFamilyInfo {
    /// Variable the `compose()` result is assigned to; `None` for default
    /// exports and expressions not bound to a variable.
    pub family_binding: Option<String>,
    /// The module's default export, as `export default compose(...)` or
    /// `export default Family`.
    #[serde(skip)]
    pub default_export: bool,
    pub root_binding: String,
    /// (slot name, binding name) pairs for every slot, Root included.
    pub slots: Vec<(String, String)>,
    /// Byte range of each slot's value in `slots`: a reference there
    /// renders through the family's member tags.
    #[serde(skip)]
    pub slot_values: Vec<(u32, u32)>,
    /// A slot property is a spread, or has a key or value this scan cannot
    /// read: the family may hold members `slots` does not list.
    #[serde(skip)]
    pub open: bool,
    pub shared_keys: Vec<String>,
    /// Shared variants propagate through React context across portals.
    pub context: bool,
    /// Byte range of the `compose()` call expression.
    pub span: (u32, u32),
    /// Built through `Object.assign`, which a module may rewrite.
    #[serde(skip)]
    pub assigned: bool,
    /// The members such an `Object.assign` adds whose values are bindings
    /// (`{ MetaLine: PageBarMetaLine }`): (key, binding). A member tag reads
    /// one as the binding itself, not a slot `compose` wraps.
    #[serde(skip)]
    pub extras: Vec<(String, String)>,
    pub name: String,
}

impl ComposeFamilyInfo {
    /// Whether usage can name the family, so its member tags render its
    /// slots: a binding holds it, or it is the module's default export.
    /// Usage follows no other family (`const { Root } = compose(…)`).
    pub fn addressable(&self) -> bool {
        self.family_binding.is_some() || self.default_export
    }
}

/// Scan top-level statements for `compose(...)` calls. compose wraps slot
/// components via `createElement` at runtime, which the JSX scanner misses.
pub fn scan_compose_calls(program: &Program, scoping: &oxc::semantic::Scoping) -> Vec<ComposeFamilyInfo> {
    let mut families: Vec<ComposeFamilyInfo> = Vec::new();
    let sources = AssignSources { program, scoping, assign: scoping.get_root_binding("Object".into()).is_none() };
    for stmt in &program.body {
        collect_compose_from_statement(stmt, &sources, &mut families);
    }
    let default_binding = program.body.iter().find_map(|stmt| match stmt {
        Statement::ExportDefaultDeclaration(export) => match export.declaration.as_expression() {
            Some(Expression::Identifier(id)) => Some(id.name.as_str()),
            _ => None,
        },
        _ => None,
    });
    if let Some(name) = default_binding {
        for family in &mut families {
            if family.family_binding.as_deref() == Some(name) {
                family.default_export = true;
            }
        }
    }
    families
}

/// What judges `Object.assign`'s sources: the module, and whether it binds
/// no `Object` of its own, so `Object.assign` there is the built-in.
struct AssignSources<'s, 'a> {
    program: &'s Program<'a>,
    scoping: &'s oxc::semantic::Scoping,
    assign: bool,
}

impl AssignSources<'_, '_> {
    /// Whether `value`, a source's member, cannot run with the family as
    /// `this` when called as its method: a literal that is no function, an
    /// arrow, or a module-scope binding of either, of an Animus component
    /// (an object, not callable), or of a function that reads no `this` of
    /// its own and nothing reassigns.
    fn inert(&self, value: &Expression<'_>) -> bool {
        match crate::chain_walk::unwrap_type_assertions(value) {
            Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::ArrowFunctionExpression(_) => true,
            Expression::Identifier(id) => {
                let Some(symbol) = self.scoping.get_root_binding(id.name) else { return false };
                !self.scoping.symbol_is_mutated(symbol) && self.declared_inert(id.name.as_str())
            }
            _ => false,
        }
    }

    /// See `inert`: the module's top-level declaration of `name`.
    fn declared_inert(&self, name: &str) -> bool {
        self.program.body.iter().any(|statement| {
            let declaration = match statement {
                Statement::ExportDeclaration(export) => &export.declaration,
                statement => match statement.as_declaration() {
                    Some(declaration) => declaration,
                    None => return false,
                },
            };
            match declaration {
                Declaration::FunctionDeclaration(function) => {
                    function.id.as_ref().is_some_and(|id| id.name == name)
                        && !function.generator
                        && function.body.as_ref().is_some_and(|body| !reads_own_this(body))
                }
                Declaration::VariableDeclaration(declaration) if declaration.kind == oxc::ast::ast::VariableDeclarationKind::Const => {
                    declaration.declarations.iter().any(|declarator| {
                        matches!(&declarator.id, BindingPattern::BindingIdentifier(id) if id.name == name)
                            && declarator.init.as_ref().is_some_and(|init| {
                                let init = crate::chain_walk::unwrap_type_assertions(init);
                                animus_component(init) || (!matches!(init, Expression::Identifier(_)) && self.inert(init))
                            })
                    })
                }
                _ => false,
            }
        })
    }
}

/// Whether `init` is an Animus chain's terminal (`….asElement('div')`).
fn animus_component(init: &Expression<'_>) -> bool {
    matches!(init, Expression::CallExpression(call) if matches!(&call.callee, Expression::StaticMemberExpression(member)
        if matches!(member.property.name.as_str(), "asElement" | "asComponent")))
}

/// Whether a function's body reads `this` of its own: anywhere but inside a
/// nested function or class, which has its own.
fn reads_own_this(body: &oxc::ast::ast::FunctionBody<'_>) -> bool {
    use oxc::ast_visit::Visit;
    struct Reads(bool);
    impl<'a> Visit<'a> for Reads {
        fn visit_this_expression(&mut self, _: &oxc::ast::ast::ThisExpression) {
            self.0 = true;
        }
        fn visit_function(&mut self, _: &oxc::ast::ast::Function<'a>, _: oxc::syntax::scope::ScopeFlags) {}
        fn visit_class(&mut self, _: &oxc::ast::ast::Class<'a>) {}
    }
    let mut reads = Reads(false);
    reads.visit_function_body(body);
    reads.0
}

fn collect_compose_from_statement(stmt: &Statement, sources: &AssignSources<'_, '_>, families: &mut Vec<ComposeFamilyInfo>) {
    match stmt {
        Statement::VariableDeclaration(decl) => {
            for declarator in &decl.declarations {
                if let Some(init) = &declarator.init {
                    let binding_name = extract_binding_name(&declarator.id);
                    collect_compose_from_expression(init, binding_name, sources, families);
                }
            }
        }
        Statement::ExportDeclaration(export) => {
            if let Declaration::VariableDeclaration(var_decl) = &export.declaration {
                for declarator in &var_decl.declarations {
                    if let Some(init) = &declarator.init {
                        let binding_name = extract_binding_name(&declarator.id);
                        collect_compose_from_expression(init, binding_name, sources, families);
                    }
                }
            }
        }
        Statement::ExportDefaultDeclaration(export) => {
            if let Some(expr) = export.declaration.as_expression() {
                let found = families.len();
                collect_compose_from_expression(expr, None, sources, families);
                if let Some(family) = families.get_mut(found) {
                    family.default_export = true;
                }
            }
        }
        _ => {}
    }
}

fn extract_binding_name(pattern: &BindingPattern) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(id) => Some(id.name.to_string()),
        _ => None,
    }
}

/// A `compose()` call, or one `Object.assign` adds members to
/// (`Object.assign(compose({ Root, … }), { useFrame })`) where the module
/// binds no `Object` of its own: the call returns the family it gets, and
/// literals of static keys no slot has, none `__proto__` (which may install
/// a setter that runs on the family), whose values cannot run with the
/// family as `this` (`AssignSources::inert`), leave every slot as `compose`
/// made it. Any other source keeps the family unfollowed, and a module that
/// may rewrite `Object.assign` unfollows it later (`FileFacts::rewrites_object`).
fn collect_compose_from_expression(
    expr: &Expression,
    family_binding: Option<String>,
    sources: &AssignSources<'_, '_>,
    families: &mut Vec<ComposeFamilyInfo>,
) {
    let Expression::CallExpression(call) = crate::chain_walk::unwrap_type_assertions(expr) else { return };
    let assigns = sources.assign && crate::facts::is_object_assign(&call.callee);
    if !assigns {
        return extract_compose_family(call, family_binding, families);
    }
    let Some(Expression::CallExpression(compose)) = call.arguments.first().and_then(Argument::as_expression).map(crate::chain_walk::unwrap_type_assertions)
    else {
        return;
    };
    let found = families.len();
    extract_compose_family(compose, family_binding, families);
    let Some(family) = families.get(found) else { return };
    let keeps_slots = !family.open
        && call.arguments.iter().skip(1).all(|source| match source.as_expression().map(crate::chain_walk::unwrap_type_assertions) {
            Some(Expression::ObjectExpression(object)) => object.properties.iter().all(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    !property.computed
                        && eval_property_key(&property.key).is_some_and(|key| key != "__proto__" && family.slots.iter().all(|(slot, _)| *slot != key))
                        && sources.inert(&property.value)
                }
                ObjectPropertyKind::SpreadProperty(_) => false,
            }),
            _ => false,
        });
    let Some(family) = families.get_mut(found).filter(|_| keeps_slots) else {
        families.truncate(found);
        return;
    };
    family.assigned = true;
    // Each added member a binding holds renders through the member tag, as a
    // slot does.
    for property in call.arguments.iter().skip(1).filter_map(Argument::as_expression) {
        let Expression::ObjectExpression(object) = crate::chain_walk::unwrap_type_assertions(property) else { continue };
        for property in &object.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else { continue };
            if let (Some(key), Expression::Identifier(value)) = (eval_property_key(&property.key), crate::chain_walk::unwrap_type_assertions(&property.value)) {
                family.extras.push((key, value.name.to_string()));
                family.slot_values.push((value.span.start, value.span.end));
            }
        }
    }
}

fn extract_compose_family(
    call: &oxc::ast::ast::CallExpression,
    family_binding: Option<String>,
    families: &mut Vec<ComposeFamilyInfo>,
) {
    let callee_name = match &call.callee {
        Expression::Identifier(id) => match id.name.as_str() {
            "compose" | "composeWithContext" => Some(id.name.as_str()),
            _ => None,
        },
        _ => None,
    };

    let Some(callee_name) = callee_name else {
        return;
    };

    let force_context = callee_name == "composeWithContext";

    let Some(first_arg) = call.arguments.first() else {
        return;
    };

    let Argument::ObjectExpression(obj) = first_arg else {
        return;
    };

    let mut slots: Vec<(String, String)> = Vec::new();
    let mut slot_values: Vec<(u32, u32)> = Vec::new();
    let mut root_binding = String::new();
    let mut open = false;

    for prop in &obj.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            let slot_name = match eval_property_key(&prop.key) {
                Some(name) => name,
                None => {
                    open = true;
                    continue;
                }
            };
            let binding_name = match &prop.value {
                Expression::Identifier(id) => {
                    slot_values.push((id.span.start, id.span.end));
                    id.name.to_string()
                }
                _ => {
                    open = true;
                    continue;
                }
            };
            if slot_name == "Root" {
                root_binding = binding_name.clone();
            }
            slots.push((slot_name, binding_name));
        } else {
            open = true;
        }
    }

    if root_binding.is_empty() || slots.is_empty() {
        return;
    }

    let (shared_keys, context_from_opts, name_opt) = call
        .arguments
        .get(1)
        .and_then(|arg| match arg {
            Argument::ObjectExpression(opts) => Some((
                extract_shared_keys(opts).unwrap_or_default(),
                extract_context_flag(opts),
                extract_name_option(opts),
            )),
            _ => None,
        })
        .unwrap_or_default();

    let context = force_context || context_from_opts;

    let name = name_opt
        .or_else(|| family_binding.clone())
        .unwrap_or_else(|| "Composed".to_string());

    families.push(ComposeFamilyInfo {
        family_binding,
        default_export: false,
        root_binding,
        slots,
        slot_values,
        open,
        shared_keys,
        context,
        span: (call.span.start, call.span.end),
        assigned: false,
        extras: Vec::new(),
        name,
    });
}

fn extract_shared_keys(opts: &oxc::ast::ast::ObjectExpression) -> Option<Vec<String>> {
    for prop in &opts.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            let key = eval_property_key(&prop.key)?;
            if key == "shared" {
                if let Expression::ObjectExpression(shared_obj) = &prop.value {
                    let mut keys = Vec::new();
                    for shared_prop in &shared_obj.properties {
                        if let ObjectPropertyKind::ObjectProperty(sp) = shared_prop {
                            if let Some(k) = eval_property_key(&sp.key) {
                                keys.push(k);
                            }
                        }
                    }
                    return Some(keys);
                }
            }
        }
    }
    None
}

fn extract_context_flag(opts: &oxc::ast::ast::ObjectExpression) -> bool {
    for prop in &opts.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            if let Some(key) = eval_property_key(&prop.key) {
                if key == "context" {
                    if let Expression::BooleanLiteral(b) = &prop.value {
                        return b.value;
                    }
                    return false;
                }
            }
        }
    }
    false
}

fn extract_name_option(opts: &oxc::ast::ast::ObjectExpression) -> Option<String> {
    for prop in &opts.properties {
        if let ObjectPropertyKind::ObjectProperty(prop) = prop {
            if let Some(key) = eval_property_key(&prop.key) {
                if key == "name" {
                    if let Expression::StringLiteral(s) = &prop.value {
                        return Some(s.value.to_string());
                    }
                    return None;
                }
            }
        }
    }
    None
}
