//! Subject (`&`) handling for selector keys and alias values: the stored
//! form keeps every `&`, and emission substitutes an anchor at each one.

/// True when the branch carries a `&` outside quoted strings.
pub(crate) fn has_subject(branch: &str) -> bool {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for c in branch.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
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

/// Text after the last unquoted `&`, or the whole branch when none exists.
/// Cascade classification keys on this, not on the full branch.
pub(crate) fn subject_suffix(branch: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut last: Option<usize> = None;
    for (i, c) in branch.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if c == '\\' {
            escaped = true;
            continue;
        }
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
    let mut escaped = false;
    for c in branch.chars() {
        if escaped {
            escaped = false;
            out.push(c);
            continue;
        }
        if c == '\\' {
            escaped = true;
            out.push(c);
            continue;
        }
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
    fn quote_tracking_is_escape_aware() {
        // An escaped quote does not close the attribute string: the `&`
        // after it is literal text, not a subject.
        assert!(has_subject("[data-x=\"a\\\"&b\"] &"));
        assert!(!has_subject("[data-x=\"a\\\"&b\"]"));
        assert_eq!(subject_suffix("[data-x=\"a\\\"&b\"] &"), "");
        assert_eq!(
            substitute_subjects("[data-x=\"a\\\"&b\"] &", ".C"),
            "[data-x=\"a\\\"&b\"] .C"
        );
        // A doubled backslash ends its own escape; the next quote closes.
        assert!(!has_subject("[data-x=\"a\\\\\"]"));
        // An escaped `&` outside quotes is an identifier character,
        // never a subject.
        assert!(!has_subject(".a\\& span"));
        assert_eq!(substitute_subjects(".a\\&:hover &", ".C"), ".a\\&:hover .C");
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
