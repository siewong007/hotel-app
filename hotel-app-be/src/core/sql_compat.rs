//! SQL Compatibility module for PostgreSQL/SQLite dual support
//!
//! This module provides macros and helpers to write database-agnostic code.

/// Macro to generate database-specific SQL queries
/// Usage: sql_query!(postgres: "SELECT $1", sqlite: "SELECT ?1")
#[macro_export]
macro_rules! sql_query {
    (postgres: $pg:expr, sqlite: $sqlite:expr) => {{
        #[cfg(all(feature = "postgres", not(feature = "sqlite")))]
        {
            $pg
        }
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            $sqlite
        }
        #[cfg(all(feature = "sqlite", feature = "postgres"))]
        {
            $pg
        } // Default to postgres if both enabled
    }};
}

/// Macro to generate positional parameter placeholder
/// In PostgreSQL: $1, $2, etc.
/// In SQLite: ?1, ?2, etc.
#[macro_export]
macro_rules! param {
    ($n:expr) => {{
        #[cfg(all(feature = "postgres", not(feature = "sqlite")))]
        {
            concat!("$", $n)
        }
        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            concat!("?", $n)
        }
        #[cfg(all(feature = "sqlite", feature = "postgres"))]
        {
            concat!("$", $n)
        } // Default to postgres if both enabled
    }};
}

/// Helper to get the current timestamp SQL expression
pub fn current_timestamp() -> &'static str {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        "datetime('now')"
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        "CURRENT_TIMESTAMP"
    }
}

/// Helper to get the current date SQL expression
pub fn current_date() -> &'static str {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        "date('now')"
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        "CURRENT_DATE"
    }
}

/// Helper to cast to text
pub fn cast_to_text(column: &str) -> String {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        format!("CAST({} AS TEXT)", column)
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        format!("{}::text", column)
    }
}

/// Helper for COALESCE with type cast
pub fn coalesce_text(col1: &str, col2: &str) -> String {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        format!("CAST(COALESCE({}, {}) AS TEXT)", col1, col2)
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        format!("COALESCE({}, {})::text", col1, col2)
    }
}

/// Helper for boolean check - SQLite doesn't have native boolean
pub fn bool_true() -> &'static str {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        "1"
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        "true"
    }
}

pub fn bool_false() -> &'static str {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        "0"
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        "false"
    }
}

/// Helper for NULL type casting
pub fn null_type(pg_type: &str) -> String {
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        "NULL".to_string()
    }
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        format!("NULL::{}", pg_type)
    }
}

/// Convert PostgreSQL parameter syntax ($1, $2) to SQLite (?1, ?2)
/// This is useful for dynamically generated queries
#[allow(dead_code)]
pub fn convert_params(query: &str) -> String {
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        query.to_string()
    }
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        let mut result = query.to_string();
        // Replace $N with ?N
        for i in (1..=99).rev() {
            result = result.replace(&format!("${}", i), &format!("?{}", i));
        }
        // Remove PostgreSQL type casts like ::text, ::BIGINT, etc.
        let re = regex::Regex::new(r"::(text|TEXT|bigint|BIGINT|decimal|DECIMAL|VARCHAR|varchar|BOOLEAN|boolean|INTEGER|integer)").unwrap();
        result = re.replace_all(&result, "").to_string();
        result
    }
}

/// Wrapper for queries that need different syntax per database
/// Converts PostgreSQL syntax to SQLite at runtime
pub fn adapt_query(pg_query: &str) -> String {
    #[cfg(any(
        all(feature = "postgres", not(feature = "sqlite")),
        all(feature = "sqlite", feature = "postgres")
    ))]
    {
        pg_query.to_string()
    }
    #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
    {
        convert_params(pg_query)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sql_query_macro_selects_active_database_query() {
        let query = sql_query!(postgres: "SELECT $1", sqlite: "SELECT ?1");

        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        assert_eq!(query, "SELECT $1");

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        assert_eq!(query, "SELECT ?1");
    }

    #[test]
    fn param_macro_uses_active_database_placeholder_style() {
        let placeholder = param!(2);

        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        assert_eq!(placeholder, "$2");

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        assert_eq!(placeholder, "?2");
    }

    #[test]
    fn scalar_helpers_return_active_database_syntax() {
        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        {
            assert_eq!(current_timestamp(), "CURRENT_TIMESTAMP");
            assert_eq!(current_date(), "CURRENT_DATE");
            assert_eq!(cast_to_text("room_id"), "room_id::text");
            assert_eq!(coalesce_text("a", "b"), "COALESCE(a, b)::text");
            assert_eq!(bool_true(), "true");
            assert_eq!(bool_false(), "false");
            assert_eq!(null_type("TEXT"), "NULL::TEXT");
        }

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        {
            assert_eq!(current_timestamp(), "datetime('now')");
            assert_eq!(current_date(), "date('now')");
            assert_eq!(cast_to_text("room_id"), "CAST(room_id AS TEXT)");
            assert_eq!(coalesce_text("a", "b"), "CAST(COALESCE(a, b) AS TEXT)");
            assert_eq!(bool_true(), "1");
            assert_eq!(bool_false(), "0");
            assert_eq!(null_type("TEXT"), "NULL");
        }
    }

    #[test]
    fn adapt_query_keeps_or_converts_postgres_parameters() {
        let query = "SELECT $1::text, $2::BIGINT";
        let adapted = adapt_query(query);

        #[cfg(any(
            all(feature = "postgres", not(feature = "sqlite")),
            all(feature = "sqlite", feature = "postgres")
        ))]
        assert_eq!(adapted, query);

        #[cfg(all(feature = "sqlite", not(feature = "postgres")))]
        assert_eq!(adapted, "SELECT ?1, ?2");
    }
}
