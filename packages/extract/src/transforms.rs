/// Port of `percentageOrAbsolute` from packages/core/src/transforms/size.ts
fn percentage_or_absolute(value: f64) -> String {
    if value == 0.0 {
        "0".to_string()
    } else if value >= -1.0 && value <= 1.0 {
        format!("{}%", value * 100.0)
    } else {
        format!("{}px", value)
    }
}

/// Port of `size` from packages/core/src/transforms/size.ts
pub fn size_transform(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Number(n) => {
            let v = n.as_f64()?;
            Some(percentage_or_absolute(v))
        }
        serde_json::Value::String(s) => {
            if s.contains("calc") {
                return Some(s.clone());
            }

            // Try to parse as number with optional unit
            let re_match = parse_value_with_unit(s);
            match re_match {
                Some((num, unit)) => {
                    if unit.is_empty() {
                        Some(percentage_or_absolute(num))
                    } else {
                        Some(format!("{}{}", num, unit))
                    }
                }
                None => Some(s.clone()),
            }
        }
        _ => None,
    }
}

/// Port of `borderShorthand` from packages/core/src/transforms/border.ts
pub fn border_shorthand_transform(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Number(n) => {
            let v = n.as_f64()?;
            Some(format!("{}px solid currentColor", v))
        }
        serde_json::Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

/// Port of `gridItem` from packages/core/src/transforms/grid.ts
fn grid_item(item: &str) -> String {
    let template = if item.chars().all(|c| c.is_ascii_digit()) {
        format!("{}fr", item)
    } else {
        match item {
            "max" => "max-content".to_string(),
            "min" => "min-content".to_string(),
            _ => item.to_string(),
        }
    };
    format!("minmax(0, {})", template)
}

fn repeat_grid_item(item: &str, count: usize) -> String {
    let template = grid_item(item);
    if count > 1 {
        format!("repeat({}, {})", count, template)
    } else {
        template
    }
}

/// Port of `gridItemRatio` / `parseGridRatio` from packages/core/src/transforms/grid.ts
pub fn grid_item_ratio_transform(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Number(n) => {
            let v = n.as_f64()? as usize;
            Some(repeat_grid_item("1", v))
        }
        serde_json::Value::String(s) => Some(parse_grid_ratio(s)),
        _ => None,
    }
}

fn parse_grid_ratio(val: &str) -> String {
    let items: Vec<&str> = val.split(':').collect();
    let mut result = String::new();
    let mut repeated: (&str, usize) = ("", 0);

    for i in 0..=items.len() {
        let curr = items.get(i).copied().unwrap_or("");

        if repeated.0 != curr {
            if !repeated.0.is_empty() {
                if !result.is_empty() {
                    result.push(' ');
                }
                result.push_str(&repeat_grid_item(repeated.0, repeated.1));
            }
            if !curr.is_empty() {
                repeated = (curr, 1);
            }
        } else {
            repeated.1 += 1;
        }
    }

    result
}

/// Parse a value like "15rem", "100px", "0.5" into (number, unit).
fn parse_value_with_unit(s: &str) -> Option<(f64, &str)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Find where the number ends and unit begins
    let mut num_end = 0;
    let chars: Vec<char> = s.chars().collect();

    // Handle leading minus
    if chars.first() == Some(&'-') {
        num_end = 1;
    }

    // Consume digits and decimal point
    while num_end < chars.len() && (chars[num_end].is_ascii_digit() || chars[num_end] == '.') {
        num_end += 1;
    }

    if num_end == 0 || (num_end == 1 && chars[0] == '-') {
        return None;
    }

    let num: f64 = s[..num_end].parse().ok()?;
    let unit = &s[num_end..];
    Some((num, unit))
}

/// Dispatch a transform by string identifier.
pub fn apply_transform(transform: &str, value: &serde_json::Value) -> Option<String> {
    match transform {
        "size" => size_transform(value),
        "borderShorthand" => border_shorthand_transform(value),
        "gridItemRatio" => grid_item_ratio_transform(value),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // size transform tests
    #[test]
    fn size_zero() {
        assert_eq!(size_transform(&json!(0)), Some("0".into()));
    }

    #[test]
    fn size_fraction_to_percent() {
        assert_eq!(size_transform(&json!(1)), Some("100%".into()));
        assert_eq!(size_transform(&json!(0.5)), Some("50%".into()));
        assert_eq!(size_transform(&json!(-1)), Some("-100%".into()));
    }

    #[test]
    fn size_large_to_px() {
        assert_eq!(size_transform(&json!(4)), Some("4px".into()));
        assert_eq!(size_transform(&json!(100)), Some("100px".into()));
    }

    #[test]
    fn size_string_with_unit() {
        assert_eq!(
            size_transform(&json!("100vh")),
            Some("100vh".into())
        );
        assert_eq!(
            size_transform(&json!("3.5rem")),
            Some("3.5rem".into())
        );
    }

    #[test]
    fn size_string_calc_passthrough() {
        assert_eq!(
            size_transform(&json!("calc(100vh - 3.5rem)")),
            Some("calc(100vh - 3.5rem)".into())
        );
    }

    #[test]
    fn size_unitless_string() {
        assert_eq!(size_transform(&json!("0")), Some("0".into()));
        assert_eq!(size_transform(&json!("0.5")), Some("50%".into()));
    }

    // border transform tests
    #[test]
    fn border_number() {
        assert_eq!(
            border_shorthand_transform(&json!(1)),
            Some("1px solid currentColor".into())
        );
    }

    #[test]
    fn border_string_passthrough() {
        assert_eq!(
            border_shorthand_transform(&json!("none")),
            Some("none".into())
        );
    }

    // grid transform tests
    #[test]
    fn grid_ratio_simple() {
        assert_eq!(
            grid_item_ratio_transform(&json!("15rem:1")),
            Some("minmax(0, 15rem) minmax(0, 1fr)".into())
        );
    }

    #[test]
    fn grid_ratio_number() {
        assert_eq!(
            grid_item_ratio_transform(&json!(3)),
            Some("repeat(3, minmax(0, 1fr))".into())
        );
    }

    #[test]
    fn grid_ratio_max() {
        assert_eq!(
            grid_item_ratio_transform(&json!("max:1")),
            Some("minmax(0, max-content) minmax(0, 1fr)".into())
        );
    }

    #[test]
    fn grid_ratio_repeated() {
        assert_eq!(
            grid_item_ratio_transform(&json!("1:1:1")),
            Some("repeat(3, minmax(0, 1fr))".into())
        );
    }

    // dispatch test
    #[test]
    fn dispatch_by_name() {
        assert_eq!(apply_transform("size", &json!(1)), Some("100%".into()));
        assert_eq!(
            apply_transform("borderShorthand", &json!(2)),
            Some("2px solid currentColor".into())
        );
        assert_eq!(apply_transform("unknown", &json!(1)), None);
    }
}
