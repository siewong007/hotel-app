//! Embedded Axum HTTP server
//!
//! Runs the hotel backend API as an embedded server within the Tauri application.

use anyhow::{Context, Result};
use hotel_app_be::{create_pool, routes::create_router};
use std::net::SocketAddr;
use tokio::sync::oneshot;
use tracing::info;

/// Manages the embedded Axum HTTP server
pub struct EmbeddedServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
    port: u16,
}

impl EmbeddedServer {
    /// Start the embedded Axum server
    ///
    /// # Arguments
    /// * `database_url` - PostgreSQL connection URL
    /// * `port` - Port to bind the server to (use 0 for automatic assignment)
    pub async fn start(database_url: &str, port: u16) -> Result<Self> {
        // Set environment variables for the backend
        std::env::set_var("DATABASE_URL", database_url);
        std::env::set_var("JWT_SECRET", generate_jwt_secret());
        std::env::set_var("ALLOWED_ORIGINS", "tauri://localhost,http://localhost:3000,http://localhost:1420");
        std::env::set_var("SKIP_EMAIL_VERIFICATION", "true");

        // Create database connection pool
        info!("Creating database connection pool...");
        let pool = create_pool().await
            .context("Failed to create database pool")?;

        // Create the Axum router with all routes
        let app = create_router(pool);

        // Bind to the specified port
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .context("Failed to bind to address")?;

        let actual_port = listener.local_addr()?.port();
        info!("Axum server listening on http://127.0.0.1:{}", actual_port);

        // Create shutdown channel
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // Spawn the server in a background task
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    shutdown_rx.await.ok();
                    info!("Axum server received shutdown signal");
                })
                .await
                .ok();
            info!("Axum server stopped");
        });

        Ok(Self {
            shutdown_tx: Some(shutdown_tx),
            port: actual_port,
        })
    }

    /// Get the port the server is running on
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Get the base URL for the server
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Stop the server gracefully
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            info!("Sending shutdown signal to Axum server...");
            let _ = tx.send(());
        }
    }
}

impl Drop for EmbeddedServer {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Generate a random JWT secret for this session
fn generate_jwt_secret() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let state = RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write_u64(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64);

    format!("hotel_desktop_jwt_secret_{:016x}", hasher.finish())
}
