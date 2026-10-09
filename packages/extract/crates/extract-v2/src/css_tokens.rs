//! CSS tokens as CSS Syntax Level 3 reads them, with their byte offsets: the
//! reader behind the prefix pass and the `currentVar` predicate, kept in step
//! with the TypeScript one in `@animus-ui/properties`. Comments are trivia and
//! make no token. Identifiers and function names are decoded, escapes
//! included. A quoted string and an unquoted `url()` are each one opaque
//! token, so nothing inside them reads as a name or a function.

use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Whitespace,
    Ident,
    Function,
    AtKeyword,
    Hash,
    String,
    Url,
    Numeric,
    /// Any other single code point or punctuation, `(` and `)` included.
    Delim(u8),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token<'a> {
    pub kind: Kind,
    pub start: usize,
    pub end: usize,
    /// The decoded name of an ident, function, at-keyword or hash; otherwise
    /// empty.
    pub value: Cow<'a, str>,
}

fn byte(css: &str, at: usize) -> Option<u8> {
    css.as_bytes().get(at).copied()
}

fn is_newline(b: Option<u8>) -> bool {
    matches!(b, Some(b'\n' | b'\r' | b'\x0c'))
}

fn is_whitespace(b: Option<u8>) -> bool {
    matches!(b, Some(b' ' | b'\t')) || is_newline(b)
}

fn is_digit(b: Option<u8>) -> bool {
    b.is_some_and(|b| b.is_ascii_digit())
}

/// Every byte of a non-ASCII code point is 0x80 or above, so a run of them
/// ends on a character boundary.
fn is_ident_start(b: Option<u8>) -> bool {
    b.is_some_and(|b| b.is_ascii_alphabetic() || b == b'_' || b >= 0x80)
}

fn is_ident_char(b: Option<u8>) -> bool {
    is_ident_start(b) || is_digit(b) || b == Some(b'-')
}

fn is_escape(css: &str, at: usize) -> bool {
    byte(css, at) == Some(b'\\') && !is_newline(byte(css, at + 1))
}

fn starts_identifier(css: &str, at: usize) -> bool {
    match byte(css, at) {
        Some(b'-') => {
            let next = byte(css, at + 1);
            is_ident_start(next) || next == Some(b'-') || is_escape(css, at + 1)
        }
        b => is_ident_start(b) || is_escape(css, at),
    }
}

fn starts_number(css: &str, at: usize) -> bool {
    let signed = usize::from(matches!(byte(css, at), Some(b'+' | b'-')));
    is_digit(byte(css, at + signed)) || (byte(css, at + signed) == Some(b'.') && is_digit(byte(css, at + signed + 1)))
}

/// The code point the escape at `at` (a `\`) stands for, and the index after
/// it: up to six hex digits and one following whitespace, or any other code
/// point.
fn read_escape(css: &str, at: usize) -> (char, usize) {
    let rest = &css[at + 1..];
    let Some(first) = rest.chars().next() else {
        return ('\u{FFFD}', at + 1);
    };
    let digits = rest.bytes().take(6).take_while(u8::is_ascii_hexdigit).count();
    if digits == 0 {
        return (first, at + 1 + first.len_utf8());
    }
    let mut end = at + 1 + digits;
    if css[end..].starts_with("\r\n") {
        end += 2;
    } else if is_whitespace(byte(css, end)) {
        end += 1;
    }
    let value = u32::from_str_radix(&rest[..digits], 16).unwrap_or(0);
    let code_point = if value == 0 { '\u{FFFD}' } else { char::from_u32(value).unwrap_or('\u{FFFD}') };
    (code_point, end)
}

/// The identifier sequence at `at`, decoded, and the index after it.
fn read_name(css: &str, at: usize) -> (Cow<'_, str>, usize) {
    let mut decoded: Option<String> = None;
    let mut from = at;
    let mut end = at;
    loop {
        if is_ident_char(byte(css, end)) {
            end += 1;
        } else if is_escape(css, end) {
            let (code_point, next) = read_escape(css, end);
            let name = decoded.get_or_insert_with(String::new);
            name.push_str(&css[from..end]);
            name.push(code_point);
            end = next;
            from = end;
        } else {
            break;
        }
    }
    let name = match decoded {
        Some(mut name) => {
            name.push_str(&css[from..end]);
            Cow::Owned(name)
        }
        None => Cow::Borrowed(&css[at..end]),
    };
    (name, end)
}

/// The identifier starting at `at`, decoded, and the index after it; `None`
/// when none starts there.
pub fn identifier_at(css: &str, at: usize) -> Option<(Cow<'_, str>, usize)> {
    starts_identifier(css, at).then(|| read_name(css, at))
}

/// `name` decoded when it is one whole identifier, else as written.
pub fn decoded_identifier(name: &str) -> Cow<'_, str> {
    match identifier_at(name, 0) {
        Some((decoded, end)) if end == name.len() => decoded,
        _ => Cow::Borrowed(name),
    }
}

fn string_end(css: &str, at: usize) -> usize {
    let quote = byte(css, at);
    let mut i = at + 1;
    loop {
        match byte(css, i) {
            None => return i,
            b if b == quote => return i + 1,
            b if is_newline(b) => return i,
            Some(b'\\') => {
                let next = byte(css, i + 1);
                i = if next.is_none() {
                    i + 1
                } else if is_newline(next) {
                    i + if css[i + 1..].starts_with("\r\n") { 3 } else { 2 }
                } else {
                    read_escape(css, i).1
                };
            }
            Some(_) => i += 1,
        }
    }
}

fn bad_url_end(css: &str, at: usize) -> usize {
    let mut i = at;
    loop {
        match byte(css, i) {
            None => return i,
            Some(b')') => return i + 1,
            _ if is_escape(css, i) => i = read_escape(css, i).1,
            Some(_) => i += 1,
        }
    }
}

/// The end of an unquoted `url(` body starting at `at`.
fn url_end(css: &str, at: usize) -> usize {
    let mut i = at;
    while is_whitespace(byte(css, i)) {
        i += 1;
    }
    loop {
        match byte(css, i) {
            None => return i,
            Some(b')') => return i + 1,
            b if is_whitespace(b) => {
                while is_whitespace(byte(css, i)) {
                    i += 1;
                }
                return match byte(css, i) {
                    None => i,
                    Some(b')') => i + 1,
                    Some(_) => bad_url_end(css, i),
                };
            }
            Some(b'"' | b'\'' | b'(' | 0..=0x08 | 0x0b | 0x0e..=0x1f | 0x7f) => return bad_url_end(css, i),
            Some(b'\\') if !is_escape(css, i) => return bad_url_end(css, i),
            Some(b'\\') => i = read_escape(css, i).1,
            Some(_) => i += 1,
        }
    }
}

fn number_end(css: &str, at: usize) -> usize {
    let mut i = at + usize::from(matches!(byte(css, at), Some(b'+' | b'-')));
    while is_digit(byte(css, i)) {
        i += 1;
    }
    if byte(css, i) == Some(b'.') && is_digit(byte(css, i + 1)) {
        i += 2;
        while is_digit(byte(css, i)) {
            i += 1;
        }
    }
    if matches!(byte(css, i), Some(b'e' | b'E')) {
        let signed = usize::from(matches!(byte(css, i + 1), Some(b'+' | b'-')));
        if is_digit(byte(css, i + 1 + signed)) {
            i += 2 + signed;
            while is_digit(byte(css, i)) {
                i += 1;
            }
        }
    }
    i
}

/// Every token of `css`, in order.
pub fn tokenize(css: &str) -> Vec<Token<'_>> {
    let mut tokens = Vec::new();
    let mut at = 0;
    while at < css.len() {
        let c = css.as_bytes()[at];
        let (kind, end, value) = if css[at..].starts_with("/*") {
            at = css[at + 2..].find("*/").map_or(css.len(), |close| at + 2 + close + 2);
            continue;
        } else if is_whitespace(Some(c)) {
            let mut end = at + 1;
            while is_whitespace(byte(css, end)) {
                end += 1;
            }
            (Kind::Whitespace, end, Cow::Borrowed(""))
        } else if c == b'"' || c == b'\'' {
            (Kind::String, string_end(css, at), Cow::Borrowed(""))
        } else if starts_number(css, at) {
            let mut end = number_end(css, at);
            if starts_identifier(css, end) {
                end = read_name(css, end).1;
            } else if byte(css, end) == Some(b'%') {
                end += 1;
            }
            (Kind::Numeric, end, Cow::Borrowed(""))
        } else if css[at..].starts_with("-->") {
            (Kind::Delim(b'-'), at + 3, Cow::Borrowed(""))
        } else if starts_identifier(css, at) {
            let (name, end) = read_name(css, at);
            if byte(css, end) != Some(b'(') {
                (Kind::Ident, end, name)
            } else if !name.eq_ignore_ascii_case("url") {
                (Kind::Function, end + 1, name)
            } else {
                let mut body = end + 1;
                while is_whitespace(byte(css, body)) && is_whitespace(byte(css, body + 1)) {
                    body += 1;
                }
                let first = byte(css, body);
                let quote = if is_whitespace(first) { byte(css, body + 1) } else { first };
                if matches!(quote, Some(b'"' | b'\'')) {
                    (Kind::Function, body, name)
                } else {
                    (Kind::Url, url_end(css, end + 1), Cow::Borrowed(""))
                }
            }
        } else if c == b'#' && (is_ident_char(byte(css, at + 1)) || is_escape(css, at + 1)) {
            let (name, end) = read_name(css, at + 1);
            (Kind::Hash, end, name)
        } else if c == b'@' && starts_identifier(css, at + 1) {
            let (name, end) = read_name(css, at + 1);
            (Kind::AtKeyword, end, name)
        } else if css[at..].starts_with("<!--") {
            (Kind::Delim(b'<'), at + 4, Cow::Borrowed(""))
        } else {
            (Kind::Delim(c), at + 1, Cow::Borrowed(""))
        };
        tokens.push(Token { kind, start: at, end, value });
        at = end;
    }
    tokens
}

/// The decoded names `var()` reads in `css` at any depth, fallbacks
/// included: a function token whose decoded name is `var` in any case,
/// whose first argument is a custom-property name.
pub fn variable_reads<'t>(tokens: &'t [Token<'_>]) -> impl Iterator<Item = &'t str> + 't {
    tokens.iter().enumerate().filter_map(|(at, token)| {
        if token.kind != Kind::Function || !token.value.eq_ignore_ascii_case("var") {
            return None;
        }
        let name = tokens[at + 1..].iter().find(|token| token.kind != Kind::Whitespace)?;
        (name.kind == Kind::Ident && name.value.starts_with("--")).then_some(name.value.as_ref())
    })
}
