//! Subject (`&`) handling for selector keys and alias values (ani-015 D2).
//!
//! The stored selector form is the full `&`-carrying branch; emission and
//! composition substitute an anchor at every subject position. CSS nesting
//! semantics: `& + &` names the composed class twice (`.C + .C`), an
//! ancestor prefix keeps the class at the marked position (`[x] &` →
//! `[x] .C`), and `&` inside functional pseudo-class arguments substitutes
//! like any other occurrence (`:is(&, .peer)` → `:is(.C, .peer)`). The walk
//! is quote-aware so attribute values containing a literal `&`
//! (`[data-x="a&b"]`) are never rewritten.

/// True when the branch carries at least one substitutable subject — a `&`
/// outside quoted strings.
pub(crate) fn has_subject(branch: &str) -> bool {
    let mut quote: Option<char> = None;
    for c in branch.chars() {
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => quote = Some(c),
                '&' => return true,
                _ => {}
            },
        }
    }
    false
}

/// The subject suffix: the text following the LAST unquoted `&`, or the
/// whole branch when no subject exists. Cascade classification keys on this
/// — for a leading-subject branch it is exactly the pre-D2 stored form, so
/// every existing bucket assignment is preserved byte-for-byte; ancestor
/// branches classify by whatever is attached to their subject.
pub(crate) fn subject_suffix(branch: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut last: Option<usize> = None;
    for (i, c) in branch.char_indices() {
        match quote {
            Some(q) => {
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => quote = Some(c),
                '&' => last = Some(i),
                _ => {}
            },
        }
    }
    match last {
        Some(i) => &branch[i + 1..],
        None => branch,
    }
}

/// Replace every unquoted `&` in `branch` with `anchor`.
pub(crate) fn substitute_subjects(branch: &str, anchor: &str) -> String {
    let mut out = String::with_capacity(branch.len() + anchor.len());
    let mut quote: Option<char> = None;
    for c in branch.chars() {
        match quote {
            Some(q) => {
                out.push(c);
                if c == q {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => {
                    quote = Some(c);
                    out.push(c);
                }
                '&' => out.push_str(anchor),
                _ => out.push(c),
            },
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subject_detection_is_quote_aware() {
        assert!(has_subject("&:hover"));
        assert!(has_subject("[aria-sort=\"ascending\"] &"));
        assert!(has_subject("& + &"));
        assert!(has_subject(":is(&, .peer) .target"));
        assert!(!has_subject(":hover"));
        assert!(!has_subject("[data-x=\"a&b\"]"));
        assert!(!has_subject("[data-x='&']"));
    }

    #[test]
    fn substitution_replaces_every_unquoted_subject() {
        assert_eq!(substitute_subjects("&:hover", ".C"), ".C:hover");
        assert_eq!(
            substitute_subjects("[aria-sort=\"ascending\"] &", ".C"),
            "[aria-sort=\"ascending\"] .C"
        );
        assert_eq!(substitute_subjects("& + &", ".C"), ".C + .C");
        assert_eq!(
            substitute_subjects(":is(&, .peer) .target", ".C"),
            ":is(.C, .peer) .target"
        );
        assert_eq!(
            substitute_subjects("[data-x=\"a&b\"] &", ".C"),
            "[data-x=\"a&b\"] .C"
        );
    }
}
