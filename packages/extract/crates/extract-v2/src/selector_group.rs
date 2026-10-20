//! A state's alternatives as one `:is()` group: `.c:disabled, .c[disabled]`
//! becomes `.c:is(:disabled, [disabled])`, which matches the same elements.
//! `:is()` takes its most specific argument's specificity, so only
//! alternatives of equal specificity group; a pseudo-element cannot sit
//! inside `:is()`, so a shared one stays after the group. Only plain
//! pseudo-classes and attribute selectors group, each weighing one class, so
//! alternatives of equal count weigh the same; it is also the shape the
//! render oracle reads back as the list it stands for (packages/oracle,
//! `css-parse.ts`). And only those every browser with `@layer` parses:
//! `:is()` forgives an alternative a browser cannot parse and applies the
//! rest, where a list drops the whole rule, and a sheet can ship unprocessed
//! when Lightning CSS fails.

use crate::css_tokens::{tokenize, Kind, Token};
use crate::selector_subject::has_subject;

/// One `:is()` group for `branches` on `anchor`, when every branch attaches
/// pseudo-classes and attribute selectors to the subject itself (`&:hover`,
/// `:hover`, `[data-x]`), all attach as many and share one trailing
/// pseudo-element, and the anchor ends in no pseudo-element. None leaves the
/// branches as a selector list.
pub(crate) fn grouped_alternatives(anchor: &str, branches: &[&str]) -> Option<String> {
    if branches.len() < 2 || pseudo_element_at(&tokenize(anchor)).is_some() {
        return None;
    }
    let mut cores = Vec::with_capacity(branches.len());
    let mut shared: Option<(usize, &str)> = None;
    for branch in branches {
        let suffix = attached_suffix(branch)?;
        let (count, element_at) = attached_simple_selectors(suffix)?;
        let key = (count, &suffix[element_at..]);
        if shared.is_some_and(|seen| seen != key) {
            return None;
        }
        shared = Some(key);
        cores.push(&suffix[..element_at]);
    }
    Some(format!("{anchor}:is({}){}", cores.join(", "), shared?.1))
}

/// What follows the subject in a branch that attaches to it: `&:hover` and
/// `:hover` both give `:hover`. None for a branch with a subject elsewhere
/// or a second subject.
fn attached_suffix(branch: &str) -> Option<&str> {
    if !has_subject(branch) {
        return Some(branch);
    }
    let rest = branch.trim().strip_prefix('&')?;
    (!has_subject(rest)).then_some(rest)
}

/// How many plain pseudo-classes and attribute selectors `suffix` attaches
/// before its pseudo-element, and the byte offset where that pseudo-element
/// starts (the end when there is none). None for anything else: a
/// functional or unlisted pseudo-class, an attribute some `@layer` browser
/// cannot parse, a class, an id, a type, whitespace or a combinator.
fn attached_simple_selectors(suffix: &str) -> Option<(usize, usize)> {
    let tokens = tokenize(suffix);
    let element_at = pseudo_element_at(&tokens);
    let mut count = 0;
    let mut i = 0;
    while i < tokens.len() && Some(tokens[i].start) != element_at {
        match (tokens[i].kind, tokens.get(i + 1)) {
            (Kind::Delim(b':'), Some(name)) if name.kind == Kind::Ident && parses_with_layer(&name.value) => i += 2,
            (Kind::Delim(b'['), _) => {
                let close = i + tokens[i..].iter().position(|token| token.kind == Kind::Delim(b']'))?;
                if !plain_attribute(&tokens[i + 1..close]) {
                    return None;
                }
                i = close + 1;
            }
            _ => return None,
        }
        count += 1;
    }
    (count > 0).then_some((count, element_at.unwrap_or(suffix.len())))
}

/// Where the first `::` starts.
fn pseudo_element_at(tokens: &[Token]) -> Option<usize> {
    tokens
        .windows(2)
        .find(|pair| pair[0].kind == Kind::Delim(b':') && pair[1].kind == Kind::Delim(b':'))
        .map(|pair| pair[0].start)
}

/// Pseudo-classes every browser with `@layer` parses (Chrome 99, Firefox 97,
/// Safari 15.4). Any other, a vendor one included, keeps its list.
const LAYER_PSEUDO_CLASSES: &[&str] = &[
    "active", "any-link", "checked", "default", "defined", "disabled", "empty", "enabled", "first-child",
    "first-of-type", "focus", "focus-visible", "focus-within", "hover", "in-range", "indeterminate", "invalid",
    "last-child", "last-of-type", "link", "only-child", "only-of-type", "optional", "out-of-range",
    "placeholder-shown", "read-only", "read-write", "required", "root", "scope", "target", "valid", "visited",
];

fn parses_with_layer(name: &str) -> bool {
    LAYER_PSEUDO_CLASSES.iter().any(|known| name.eq_ignore_ascii_case(known))
}

/// An attribute selector's inside every `@layer` browser parses: a name with
/// no namespace, then optionally a matcher, a value and the `i` flag.
fn plain_attribute(inside: &[Token]) -> bool {
    let mut tokens = inside.iter().filter(|token| token.kind != Kind::Whitespace);
    if tokens.next().is_none_or(|name| name.kind != Kind::Ident) {
        return false;
    }
    let Some(first) = tokens.next() else { return true };
    // `|=` is a matcher; a `|` that is not is a namespace separator.
    let matcher = match first.kind {
        Kind::Delim(b'=') => true,
        Kind::Delim(b'~' | b'|' | b'^' | b'$' | b'*') => tokens.next().is_some_and(|equals| equals.kind == Kind::Delim(b'=') && equals.start == first.end),
        _ => false,
    };
    if !matcher || tokens.next().is_none_or(|value| !matches!(value.kind, Kind::String | Kind::Ident)) {
        return false;
    }
    match tokens.next() {
        None => true,
        Some(flag) => flag.kind == Kind::Ident && flag.value.eq_ignore_ascii_case("i") && tokens.next().is_none(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::split_top_level_commas;

    /// Contract: a grouped state matches the same elements at the same
    /// specificity. The group's `:is()` holds exactly the alternatives the
    /// selector list held, in order, each attaching the same number of
    /// pseudo-classes and attribute selectors (one class of weight each);
    /// alternatives of unequal weight, or that reach past the subject, stay
    /// a selector list.
    #[test]
    fn a_grouped_state_matches_the_same_elements_at_the_same_specificity() {
        for (pseudo, expected) in [
            (
                "&:disabled,&[disabled],&[aria-disabled=\"true\"],&[data-disabled]",
                ".c:is(:disabled, [disabled], [aria-disabled=\"true\"], [data-disabled])",
            ),
            ("&[aria-selected=\"true\"],&[data-selected]", ".c:is([aria-selected=\"true\"], [data-selected])"),
            (":hover,[data-x]", ".c:is(:hover, [data-x])"),
            ("&:checked::after,&[data-checked]::after", ".c:is(:checked, [data-checked])::after"),
            ("&:checked:disabled,&[data-checked][data-label=\"a]b\"]", ".c:is(:checked:disabled, [data-checked][data-label=\"a]b\"])"),
            ("&[data-x=\"a\" i],&[data-y]", ".c:is([data-x=\"a\" i], [data-y])"),
            ("&[lang|=\"en\"],&[data-lang]", ".c:is([lang|=\"en\"], [data-lang])"),
            ("&:focus-visible,&[data-focus-visible]", ".c:is(:focus-visible, [data-focus-visible])"),
        ] {
            let branches = split_top_level_commas(pseudo);
            let grouped = grouped_alternatives(".c", &branches).unwrap_or_else(|| panic!("{pseudo} stayed a list"));
            assert_eq!(grouped, expected);
            let alternatives: Vec<(usize, &str, &str)> = branches
                .iter()
                .map(|branch| {
                    let suffix = attached_suffix(branch).unwrap();
                    let (count, at) = attached_simple_selectors(suffix).unwrap();
                    (count, &suffix[..at], &suffix[at..])
                })
                .collect();
            let listed: Vec<&str> = alternatives.iter().map(|(_, core, _)| *core).collect();
            assert_eq!(grouped, format!(".c:is({}){}", listed.join(", "), alternatives[0].2), "{pseudo}: the group lists the same alternatives");
            assert!(
                alternatives.iter().all(|(count, _, element)| *count == alternatives[0].0 && *element == alternatives[0].2),
                "{pseudo}: one weight, one pseudo-element"
            );
        }
        for pseudo in [
            "&:hover,&[a][b]",
            "&:hover,&.a",
            "&.a,&[data-a]",
            "&:hover.a,&[data-a]",
            "&#a,&:hover",
            "&:hover,& + &",
            "[dir=rtl] &,&:hover",
            " p,:hover",
            "&::before,&::after",
            "&:not(.a),&:hover",
            "&:where(.a),&:hover",
            "&:hover:before,&:focus:before",
            // An alternative some @layer browser cannot parse: inside :is() it
            // would be forgiven and its siblings apply, where the list drops.
            "&[data-x=\"a\" s],&[data-y]",
            "&[xlink|href],&[data-y]",
            "&[*|href],&[data-y]",
            "&[|href],&[data-y]",
            "&:-moz-focusring,&[data-ring]",
            "&:fullscreen,&[data-fs]",
            "&:popover-open,&[data-open]",
        ] {
            assert_eq!(grouped_alternatives(".c", &split_top_level_commas(pseudo)), None, "{pseudo}");
        }
        assert_eq!(grouped_alternatives(".c::before", &[":hover", "[data-x]"]), None);
    }
}
