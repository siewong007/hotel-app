def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    import re
    content = re.sub(
        r'let room_info:\s*Option<\(i64,\s*Decimal,\s*String\)>\s*=\s*sqlx::query_as\((.*?)\)\s*\.bind\(input\.room_id\)\s*\.fetch_optional\(&pool\)\s*\.await\s*\.map_err\(\|e\|\s*ApiError::Database\(e\.to_string\(\)\)\)\?;',
        r'''let room_info: Option<(i64, Decimal, String)> = sqlx::query(\1)
    .bind(input.room_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Database(e.to_string()))?
    .map(|r| {
        use sqlx::Row;
        use crate::core::db::DbRowExt;
        (r.get(0), r.get_decimal(1), r.get(2))
    });''',
        content,
        flags=re.DOTALL
    )
    with open(filepath, 'w') as f:
        f.write(content)

patch_file('src/repositories/bookings/credits.rs')
