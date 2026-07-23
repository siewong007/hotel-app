//! PostgreSQL SQL helpers retained to keep query construction concise.

#[macro_export]
macro_rules! param {
    ($n:expr) => {
        concat!("$", $n)
    };
}

pub fn current_timestamp() -> &'static str {
    "CURRENT_TIMESTAMP"
}

pub fn current_date() -> &'static str {
    "CURRENT_DATE"
}

pub fn cast_to_text(column: &str) -> String {
    format!("{column}::text")
}

pub fn coalesce_text(col1: &str, col2: &str) -> String {
    format!("COALESCE({col1}, {col2})::text")
}

pub fn bool_true() -> &'static str {
    "true"
}

pub fn bool_false() -> &'static str {
    "false"
}

pub fn null_type(pg_type: &str) -> String {
    format!("NULL::{pg_type}")
}

#[allow(dead_code)]
pub fn convert_params(query: &str) -> String {
    query.to_string()
}

pub fn adapt_query(pg_query: &str) -> String {
    pg_query.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_return_postgres_syntax() {
        assert_eq!(param!(2), "$2");
        assert_eq!(current_timestamp(), "CURRENT_TIMESTAMP");
        assert_eq!(current_date(), "CURRENT_DATE");
        assert_eq!(cast_to_text("room_id"), "room_id::text");
        assert_eq!(coalesce_text("a", "b"), "COALESCE(a, b)::text");
        assert_eq!(bool_true(), "true");
        assert_eq!(bool_false(), "false");
        assert_eq!(null_type("TEXT"), "NULL::TEXT");
        assert_eq!(adapt_query("SELECT $1::text"), "SELECT $1::text");
    }
}
