//! Pagination helpers shared by list handlers.

/// Normalized pagination values ready for SQL queries and response metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pagination {
    pub page: i64,
    pub page_size: i64,
    pub offset: i64,
}

/// Normalize page-based pagination.
///
/// Defaults and limits are supplied by each endpoint to preserve its public
/// behavior while keeping validation and offset calculation consistent.
pub fn normalize_pagination(
    page: Option<i64>,
    page_size: Option<i64>,
    default_page_size: i64,
    max_page_size: i64,
) -> Pagination {
    let default_page_size = default_page_size.max(1);
    let max_page_size = max_page_size.max(1);
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size
        .unwrap_or(default_page_size)
        .clamp(1, max_page_size);
    let offset = (page - 1).saturating_mul(page_size);

    Pagination {
        page,
        page_size,
        offset,
    }
}

/// Normalize page-based pagination with an optional explicit offset override.
pub fn normalize_pagination_with_offset(
    page: Option<i64>,
    page_size: Option<i64>,
    explicit_offset: Option<i64>,
    default_page_size: i64,
    max_page_size: i64,
) -> Pagination {
    let mut pagination = normalize_pagination(page, page_size, default_page_size, max_page_size);

    if let Some(offset) = explicit_offset {
        pagination.offset = offset.max(0);
    }

    pagination
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_pagination_uses_endpoint_defaults() {
        let pagination = normalize_pagination(None, None, 50, 500);

        assert_eq!(
            pagination,
            Pagination {
                page: 1,
                page_size: 50,
                offset: 0,
            }
        );
    }

    #[test]
    fn normalize_pagination_clamps_invalid_and_large_inputs() {
        let pagination = normalize_pagination(Some(0), Some(900), 50, 500);

        assert_eq!(
            pagination,
            Pagination {
                page: 1,
                page_size: 500,
                offset: 0,
            }
        );

        let pagination = normalize_pagination(Some(-10), Some(-25), 50, 500);

        assert_eq!(
            pagination,
            Pagination {
                page: 1,
                page_size: 1,
                offset: 0,
            }
        );
    }

    #[test]
    fn normalize_pagination_calculates_offset() {
        let pagination = normalize_pagination(Some(3), Some(25), 50, 500);

        assert_eq!(pagination.offset, 50);
    }

    #[test]
    fn normalize_pagination_with_offset_uses_non_negative_override() {
        let pagination = normalize_pagination_with_offset(Some(3), Some(25), Some(7), 50, 500);

        assert_eq!(
            pagination,
            Pagination {
                page: 3,
                page_size: 25,
                offset: 7,
            }
        );

        let pagination = normalize_pagination_with_offset(Some(3), Some(25), Some(-10), 50, 500);

        assert_eq!(pagination.offset, 0);
    }
}
