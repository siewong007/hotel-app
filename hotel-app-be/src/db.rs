use sqlx::{PgPool, Postgres, Pool};
use std::env;

pub async fn create_pool() -> Result<PgPool, sqlx::Error> {
    let database_url = env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set in environment variables");

    Pool::<Postgres>::connect(&database_url).await
}

