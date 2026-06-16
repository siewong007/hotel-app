import re

def patch_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    if 'use crate::core::db::DbRowExt;' not in content:
        content = content.replace('use sqlx::Row;', 'use sqlx::Row;\nuse crate::core::db::DbRowExt;')
    
    # Replace `.get(...)` for Decimal assignments
    content = re.sub(r'(let\s+[\w_]+\s*:\s*(?:rust_decimal::)?Decimal\s*=\s*[\w_]+)\.get\((\d+)\);', r'\1.get_decimal(\2);', content)
    content = re.sub(r'(let\s+[\w_]+\s*:\s*Option<(?:rust_decimal::)?Decimal>\s*=\s*[\w_]+)\.get\((\d+)\);', r'\1.get_opt_decimal(\2);', content)
    
    # Also fix query_scalar in complimentary.rs
    content = content.replace(
'''    let value_given: Decimal = sqlx::query_scalar(
        "SELECT COALESCE(SUM(original_total_amount - total_amount), 0) FROM bookings WHERE is_complimentary = true AND original_total_amount IS NOT NULL"
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(Decimal::ZERO);''',
'''    let value_given: Decimal = sqlx::query(
        "SELECT COALESCE(SUM(original_total_amount - total_amount), 0) FROM bookings WHERE is_complimentary = true AND original_total_amount IS NOT NULL"
    )
    .fetch_one(&pool)
    .await
    .map(|row| row.get_decimal(0))
    .unwrap_or(Decimal::ZERO);'''
    )
    
    with open(filepath, 'w') as f:
        f.write(content)

patch_file('src/repositories/bookings/complimentary.rs')
patch_file('src/repositories/bookings/credits.rs')
