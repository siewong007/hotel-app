use sqlx::{PgPool, Postgres, Pool};
use std::env;

pub async fn create_pool() -> Result<PgPool, sqlx::Error> {
    let database_url = env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://hotel_admin:hotel_password_change_in_production@localhost:5432/hotel_management".to_string());
    
    Pool::<Postgres>::connect(&database_url).await
}

