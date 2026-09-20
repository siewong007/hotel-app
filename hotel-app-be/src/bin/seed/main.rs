//! Development seed binary: deterministic, scenario-based test data.
//!
//! Replaces database/postgres/staging.sql. Development/test databases only —
//! refuses to run when the environment resolves to production.
//!
//!   cargo run --bin seed                          # full dataset
//!   cargo run --bin seed -- --list                # scenario registry
//!   cargo run --bin seed -- --scenario frontdesk  # one scenario
//!   cargo run --bin seed -- --reset               # wipe seed rows only
//!   cargo run --bin seed -- --scenario basic --reset

mod args;
mod engine;
mod guard;
mod registry;
mod sections;
mod wipe;

use clap::Parser;

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("seed: error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), anyhow::Error> {
    let cli = args::Cli::parse();

    if cli.list {
        print!("{}", registry::list_text());
        return Ok(());
    }

    dotenvy::dotenv().ok();

    let env = guard::resolve_env(|key| std::env::var(key).ok());
    guard::require_not_production(env).map_err(anyhow::Error::msg)?;

    let url = cli
        .database_url
        .clone()
        .or_else(|| std::env::var("DATABASE_URL").ok())
        .ok_or_else(|| {
            anyhow::anyhow!("DATABASE_URL is not set (export it or pass --database-url)")
        })?;

    if cli.reset {
        guard::require_reset_permitted(env, &url).map_err(anyhow::Error::msg)?;
    }

    let modules: Vec<&'static str> = if cli.reset && cli.scenario.is_empty() && !cli.all {
        Vec::new()
    } else if cli.scenario.is_empty() {
        registry::resolve_all()
    } else {
        registry::resolve(&cli.scenario).map_err(anyhow::Error::msg)?
    };

    let summary = engine::run(&url, &modules, cli.ref_date).await?;

    if cli.reset && modules.is_empty() {
        println!(
            "Seed reset complete — all seed-owned rows removed (ref date {}).",
            summary.ref_date
        );
    } else {
        println!(
            "Seed completed successfully (ref date {}).",
            summary.ref_date
        );
    }
    for (label, count) in &summary.counts {
        if *count > 0 {
            println!("  {label}: {count}");
        }
    }
    println!("\nScenarios applied:");
    if cli.reset && modules.is_empty() {
        println!("  (none — reset only)");
    } else if cli.scenario.is_empty() {
        println!("  full");
    } else {
        for name in &cli.scenario {
            println!("  {name}");
        }
    }
    println!("Staff credentials: see docs/development.md (development-only password).");
    Ok(())
}
