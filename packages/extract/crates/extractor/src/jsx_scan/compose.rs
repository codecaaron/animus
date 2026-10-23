//! `compose()` call detection: the family shape (binding, slots, shared
//! keys, context flag) read from top-level statements.

use oxc::ast::ast::{
    Argument, BindingPattern, Declaration, Expression, ObjectPropertyKind, Program, PropertyKind,
    Statement,
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
    /// `composeWithContext`'s `requireRoot` option, where it may be on: a
    /// member outside its Root throws in development.
    #[serde(skip)]
    pub require_root: Option<RequireRoot>,
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
    /// The name the runtime gives the family, `options.name ?? 'Composed'`:
    /// the extracted call passes it, so a member's error and `displayName`
    /// match authored code.
    #[serde(skip)]
    pub runtime_name: String,
    /// The options set `name` or `requireRoot` in a way this scan cannot
    /// read (a binding, a spread, a `__proto__` key, a getter): the
    /// extracted code keeps the authored call, so the runtime reads them.
    #[serde(skip)]
    pub authored: bool,
}

/// How a family's options write `requireRoot`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequireRoot {
    /// `requireRoot: true`.
    On,
    /// Any value but a boolean literal, by its byte range: the extracted
    /// call reads it where it is written.
    Written(u32, u32),
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
                !crate::identity::reassigned(self.scoping, symbol) && self.declared_inert(id.name.as_str())
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
                        && function.body.is_some()
                        && !reads_own_this(function)
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

/// Whether a function reads `this` of its own: in its parameters or body,
/// anywhere but inside a nested function, which has its own. A nested
/// class counts as reading it, since its `extends` clause and computed keys
/// run with it.
fn reads_own_this(function: &oxc::ast::ast::Function<'_>) -> bool {
    use oxc::ast_visit::Visit;
    struct Reads(bool);
    impl<'a> Visit<'a> for Reads {
        fn visit_this_expression(&mut self, _: &oxc::ast::ast::ThisExpression) {
            self.0 = true;
        }
        fn visit_function(&mut self, _: &oxc::ast::ast::Function<'a>, _: oxc::syntax::scope::ScopeFlags) {}
        fn visit_class(&mut self, _: &oxc::ast::ast::Class<'a>) {
            self.0 = true;
        }
    }
    let mut reads = Reads(false);
    reads.visit_formal_parameters(&function.params);
    if let Some(body) = &function.body {
        reads.visit_function_body(body);
    }
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
    // A key the sources repeat holds what the last one assigns: one each.
    let mut keys = std::collections::BTreeSet::new();
    let keeps_slots = !family.open
        && call.arguments.iter().skip(1).all(|source| match source.as_expression().map(crate::chain_walk::unwrap_type_assertions) {
            Some(Expression::ObjectExpression(object)) => object.properties.iter().all(|property| match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    !property.computed
                        && eval_property_key(&property.key).is_some_and(|key| {
                            key != "__proto__" && family.slots.iter().all(|(slot, _)| *slot != key) && keys.insert(key)
                        })
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
    let mut open = false;

    // Each property defines its key as `Object.entries` reads it: the last
    // definition wins. One whose value is no plain identifier (a member, a
    // cast, a call, an accessor, a method) holds what the scan cannot name,
    // so it drops the slot it defines, and an earlier value escapes. A spread
    // or a key the scan cannot read may define any key before it, so it drops
    // every slot so far.
    for prop in &obj.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = prop else {
            open = true;
            slots.clear();
            slot_values.clear();
            continue;
        };
        let Some(slot_name) = eval_property_key(&prop.key) else {
            open = true;
            slots.clear();
            slot_values.clear();
            continue;
        };
        // `__proto__: X` sets the slots object's prototype, which compose's
        // `Object.entries` never reads: no slot, and its value renders
        // through no member tag. A shorthand is a plain member.
        if slot_name == "__proto__" && !prop.shorthand && !prop.computed {
            continue;
        }
        let at = slots.iter().position(|(slot, _)| *slot == slot_name);
        let Expression::Identifier(id) = &prop.value else {
            open = true;
            if let Some(at) = at {
                slots.remove(at);
                slot_values.remove(at);
            }
            continue;
        };
        // A repeated key holds its last value; the value it replaces renders
        // through no member tag.
        match at {
            Some(at) => {
                slots[at].1 = id.name.to_string();
                slot_values[at] = (id.span.start, id.span.end);
            }
            None => {
                slots.push((slot_name, id.name.to_string()));
                slot_values.push((id.span.start, id.span.end));
            }
        }
    }
    let root_binding = slots.iter().find(|(slot, _)| slot == "Root").map(|(_, binding)| binding.clone()).unwrap_or_default();

    if root_binding.is_empty() || slots.is_empty() {
        return;
    }

    let options = call.arguments.get(1).map(|arg| match arg.as_expression().map(crate::chain_walk::unwrap_type_assertions) {
        Some(Expression::ObjectExpression(opts)) => Some(&**opts),
        _ => None,
    });
    let (shared_keys, context_from_opts) = options
        .flatten()
        .map(|opts| (extract_shared_keys(opts).unwrap_or_default(), extract_context_flag(opts)))
        .unwrap_or_default();
    let (name_opt, require_root, authored) = match options {
        None => (None, None, false),
        Some(None) => (None, None, true),
        Some(Some(opts)) => match (plain_options(opts), extract_name_option(opts), extract_require_root(opts)) {
            (true, Some(name), Some(require_root)) => (name, require_root, false),
            _ => (None, None, true),
        },
    };

    let context = force_context || context_from_opts;

    let runtime_name = name_opt.clone().unwrap_or_else(|| "Composed".to_string());
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
        require_root,
        span: (call.span.start, call.span.end),
        assigned: false,
        extras: Vec::new(),
        name,
        runtime_name,
        authored,
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

/// Whether the runtime reads only the options' own properties as written:
/// a spread can run code or supply a key, and a `__proto__` key can let one
/// be inherited.
fn plain_options(opts: &oxc::ast::ast::ObjectExpression) -> bool {
    opts.properties.iter().all(|prop| match prop {
        ObjectPropertyKind::SpreadProperty(_) => false,
        ObjectPropertyKind::ObjectProperty(prop) => eval_property_key(&prop.key).as_deref() != Some("__proto__"),
    })
}

/// The value the options' `key` reads: `Ok(None)` where nothing writes it,
/// `Err(())` where the last write is a spread, a key this scan cannot read,
/// or an accessor or method, which only the runtime can read.
fn data_property<'a>(opts: &'a oxc::ast::ast::ObjectExpression<'a>, key: &str) -> Result<Option<&'a Expression<'a>>, ()> {
    let mut value = Ok(None);
    for prop in &opts.properties {
        value = match prop {
            ObjectPropertyKind::SpreadProperty(_) => Err(()),
            ObjectPropertyKind::ObjectProperty(prop) => match eval_property_key(&prop.key) {
                Some(name) if name != key => continue,
                Some(_) if prop.kind == PropertyKind::Init && !prop.method => Ok(Some(&prop.value)),
                _ => Err(()),
            },
        };
    }
    value
}

/// `requireRoot` as the options write it, `None` where it cannot be read.
fn extract_require_root(opts: &oxc::ast::ast::ObjectExpression) -> Option<Option<RequireRoot>> {
    use oxc::span::GetSpan;
    Some(data_property(opts, "requireRoot").ok()?.and_then(|value| match value {
        Expression::BooleanLiteral(b) => b.value.then_some(RequireRoot::On),
        value => Some(RequireRoot::Written(value.span().start, value.span().end)),
    }))
}

/// `name` as the options write it, `None` where it is not a string literal.
fn extract_name_option(opts: &oxc::ast::ast::ObjectExpression) -> Option<Option<String>> {
    match data_property(opts, "name").ok()? {
        None => Some(None),
        Some(Expression::StringLiteral(s)) => crate::eval::literal_string(s).map(|name| Some(name.to_string())),
        Some(_) => None,
    }
}
