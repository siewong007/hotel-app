//! CLI surface for the development seed bin.
//!
//! Examples:
//!   cargo run --bin seed                         # full dataset
//!   cargo run --bin seed -- --list               # show scenarios
//!   cargo run --bin seed -- --scenario frontdesk
//!   cargo run --bin seed -- --scenario payments --scenario audit
//!   cargo run --bin seed -- --reset              # wipe seed rows only
//!   cargo run --bin seed -- --all --reset        # wipe, then apply everything

use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "seed",
    about = "Deterministic development seed data for the hotel app",
    long_about = "Wipes the seed-owned id band (800000-899999) then applies the selected \
                  scenarios inside one transaction. Development/test databases only."
)]
pub struct Cli {
    /// Scenario(s) to apply; repeat the flag or comma-separate names.
    /// Run --list to see the registry.
    #[arg(long, value_name = "NAME", value_delimiter = ',')]
    pub scenario: Vec<String>,

    /// Apply every scenario (equivalent to `seed` with no selection).
    #[arg(long, conflicts_with = "scenario")]
    pub all: bool,

    /// Remove every seed-owned row. With --scenario/--all, wipe first then apply.
    /// Refuses unless the environment is explicitly development or the
    /// database URL is loopback. Never runs against production.
    #[arg(long)]
    pub reset: bool,

    /// Print the scenario registry and exit.
    #[arg(long)]
    pub list: bool,

    /// Pin the reference date every stay/schedule date derives from
    /// (default: the hotel business date). Format YYYY-MM-DD.
    #[arg(long, value_name = "YYYY-MM-DD")]
    pub ref_date: Option<chrono::NaiveDate>,

    /// Database URL; defaults to $DATABASE_URL (after loading .env).
    #[arg(long, value_name = "URL")]
    pub database_url: Option<String>,
}
