//! Embedded PostgreSQL database management
//!
//! Handles PostgreSQL lifecycle: download, initialization, startup, and shutdown.

use anyhow::{Context, Result};
use postgresql_embedded::{PostgreSQL, Settings, VersionReq};
use std::path::PathBuf;
use std::str::FromStr;
use tracing::info;

/// Manages the embedded PostgreSQL instance
pub struct EmbeddedDatabase {
    postgresql: PostgreSQL,
    database_name: String,
    port: u16,
}

impl EmbeddedDatabase {
    /// Initialize and start the embedded PostgreSQL instance
    pub async fn new() -> Result<Self> {
        let data_dir = get_data_directory()?;

        info!("Database data directory: {:?}", data_dir);
        std::fs::create_dir_all(&data_dir)
            .context("Failed to create data directory")?;

        // Configure PostgreSQL settings
        let settings = Settings {
            version: VersionReq::from_str("=16.4.0").unwrap(),
            installation_dir: data_dir.join("postgresql"),
            data_dir: data_dir.join("data"),
            port: 5433, // Use different port to avoid conflicts
            username: "postgres".to_string(),
            password: "postgres".to_string(),
            ..Default::default()
        };

        let port = settings.port;
        let mut postgresql = PostgreSQL::new(settings);

        // Setup PostgreSQL (downloads if needed)
        info!("Setting up PostgreSQL (this may download binaries on first run)...");
        postgresql.setup().await
            .context("Failed to setup PostgreSQL")?;

        // Start PostgreSQL
        info!("Starting PostgreSQL on port {}...", port);
        postgresql.start().await
            .context("Failed to start PostgreSQL")?;

        let database_name = "hotel_management".to_string();

        // Create database if it doesn't exist
        if !postgresql.database_exists(&database_name).await
            .context("Failed to check if database exists")?
        {
            info!("Creating database '{}'...", database_name);
            postgresql.create_database(&database_name).await
                .context("Failed to create database")?;
        }

        Ok(Self {
            postgresql,
            database_name,
            port,
        })
    }

    /// Get the database connection URL
    pub fn connection_url(&self) -> String {
        let settings = self.postgresql.settings();
        format!(
            "postgres://{}:{}@127.0.0.1:{}/{}",
            settings.username,
            settings.password,
            self.port,
            self.database_name
        )
    }

    /// Run database migrations
    pub async fn run_migrations(&self) -> Result<()> {
        info!("Running database migrations...");

        // Retry connection with delay (PostgreSQL may need time to fully start)
        let mut pool = None;
        for attempt in 1..=5 {
            info!("Attempting database connection (attempt {}/5)...", attempt);
            match sqlx::PgPool::connect(&self.connection_url()).await {
                Ok(p) => {
                    pool = Some(p);
                    break;
                }
                Err(e) => {
                    if attempt < 5 {
                        info!("Connection attempt {} failed: {}, retrying in 2 seconds...", attempt, e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    } else {
                        return Err(e).context("Failed to connect to database for migrations after 5 attempts");
                    }
                }
            }
        }
        let pool = pool.expect("Pool should be set after successful connection");

        // Get migrations directory path
        let migrations_path = get_migrations_path()?;

        info!("Migrations path: {:?}", migrations_path);

        // Run migrations using sqlx
        let migrator = sqlx::migrate::Migrator::new(migrations_path)
            .await
            .context("Failed to load migrations")?;

        info!("Found {} migrations to run", migrator.iter().count());

        match migrator.run(&pool).await {
            Ok(_) => {
                info!("Migrations completed successfully");
                Ok(())
            }
            Err(e) => {
                tracing::error!("Migration error details: {:?}", e);
                Err(anyhow::anyhow!("Failed to run migrations: {}", e))
            }
        }
    }

    /// Check if this is a fresh database (no tables exist)
    pub async fn is_fresh_install(&self) -> Result<bool> {
        let pool = sqlx::PgPool::connect(&self.connection_url())
            .await
            .context("Failed to connect to database")?;

        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users')"
        )
        .fetch_one(&pool)
        .await
        .unwrap_or(false);

        Ok(!exists)
    }

    /// Check if seed data needs to be run (no admin user exists)
    pub async fn needs_seed_data(&self) -> Result<bool> {
        let pool = sqlx::PgPool::connect(&self.connection_url())
            .await
            .context("Failed to connect to database")?;

        // Check if admin user exists
        let admin_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM users WHERE username = 'admin')"
        )
        .fetch_one(&pool)
        .await
        .unwrap_or(false);

        Ok(!admin_exists)
    }

    /// Run seed data for initial setup
    pub async fn run_seed_data(&self) -> Result<()> {
        info!("Running seed data...");

        let pool = sqlx::PgPool::connect(&self.connection_url())
            .await
            .context("Failed to connect to database for seeding")?;

        // Seed files in order - embedded at compile time
        let seed_files = [
            ("01_system_roles_admin.sql", include_str!("../../../hotel-app-be/database/seed-data/01_system_roles_admin.sql")),
            ("02_users_staff.sql", include_str!("../../../hotel-app-be/database/seed-data/02_users_staff.sql")),
            ("03_rooms_rates.sql", include_str!("../../../hotel-app-be/database/seed-data/03_rooms_rates.sql")),
            ("04_guests_bookings.sql", include_str!("../../../hotel-app-be/database/seed-data/04_guests_bookings.sql")),
            ("05_loyalty_data.sql", include_str!("../../../hotel-app-be/database/seed-data/05_loyalty_data.sql")),
        ];

        for (name, sql) in seed_files {
            info!("Running seed file: {}", name);
            sqlx::raw_sql(sql)
                .execute(&pool)
                .await
                .with_context(|| format!("Failed to run seed file: {}", name))?;
        }

        info!("Seed data completed successfully");
        Ok(())
    }

    /// Stop the PostgreSQL instance gracefully
    pub async fn stop(&mut self) -> Result<()> {
        info!("Stopping PostgreSQL...");
        self.postgresql.stop().await
            .context("Failed to stop PostgreSQL")?;
        info!("PostgreSQL stopped");
        Ok(())
    }

    /// Get the PostgreSQL port
    pub fn port(&self) -> u16 {
        self.port
    }
}

/// Get the platform-specific data directory for the application
fn get_data_directory() -> Result<PathBuf> {
    let base_dir = dirs::data_local_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("share")))
        .context("Failed to determine data directory")?;

    #[cfg(target_os = "macos")]
    let app_dir = base_dir.join("com.hotelmanagement.app");

    #[cfg(target_os = "windows")]
    let app_dir = base_dir.join("HotelManagement");

    #[cfg(target_os = "linux")]
    let app_dir = base_dir.join("hotel-management");

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let app_dir = base_dir.join("hotel-management");

    Ok(app_dir)
}

/// Get the path to migrations directory
fn get_migrations_path() -> Result<PathBuf> {
    // Try to find migrations relative to the executable
    let exe_path = std::env::current_exe()
        .context("Failed to get executable path")?;

    // In development, migrations are in the source tree
    // In production, they should be bundled as resources
    let possible_paths = [
        // Development path (relative to src-tauri)
        exe_path.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("hotel-app-be").join("database").join("migrations")),
        // Alternative development path
        std::env::current_dir().ok()
            .map(|p| p.join("..").join("hotel-app-be").join("database").join("migrations")),
        // Bundled resources path (production)
        exe_path.parent()
            .map(|p| p.join("resources").join("migrations")),
    ];

    for path_opt in possible_paths.iter() {
        if let Some(path) = path_opt {
            if path.exists() {
                return Ok(path.clone());
            }
        }
    }

    // Fallback to compile-time path
    let compile_time_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("hotel-app-be")
        .join("database")
        .join("migrations");

    if compile_time_path.exists() {
        return Ok(compile_time_path);
    }

    anyhow::bail!("Could not find migrations directory")
}
