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

pub fn bool_true() -> &'static str {
    "true"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers_return_postgres_syntax() {
        assert_eq!(param!(2), "$2");
        assert_eq!(current_timestamp(), "CURRENT_TIMESTAMP");
        assert_eq!(current_date(), "CURRENT_DATE");
        assert_eq!(bool_true(), "true");
    }
}
