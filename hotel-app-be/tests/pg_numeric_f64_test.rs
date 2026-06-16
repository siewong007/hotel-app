use sqlx::{postgres::PgPoolOptions, Row};
#[tokio::test]
async fn test_pg_numeric() -> Result<(), sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect("postgres://postgres:postgres@localhost:5432/postgres")
        .await?;
    let row = sqlx::query("SELECT 12.34::numeric AS val")
        .fetch_one(&pool)
        .await?;
    let val_f64: f64 = row.try_get("val")?;
    println!("f64: {}", val_f64);
    Ok(())
}
