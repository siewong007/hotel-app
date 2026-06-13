// Utility to generate a password reset SQL statement.
// Run with: cargo run --bin fix_password -- <username> <new-password>

use bcrypt::{DEFAULT_COST, hash};

fn main() {
    let mut args = std::env::args().skip(1);
    let username = args.next().unwrap_or_else(|| {
        eprintln!("Usage: cargo run --bin fix_password -- <username> <new-password>");
        std::process::exit(1);
    });
    let password = args.next().unwrap_or_else(|| {
        eprintln!("Usage: cargo run --bin fix_password -- <username> <new-password>");
        std::process::exit(1);
    });

    if args.next().is_some() {
        eprintln!("Usage: cargo run --bin fix_password -- <username> <new-password>");
        std::process::exit(1);
    }

    if !username
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
    {
        eprintln!(
            "Username may only contain ASCII letters, numbers, dots, hyphens, and underscores"
        );
        std::process::exit(1);
    }

    match hash(&password, DEFAULT_COST) {
        Ok(hash) => {
            println!("Hash generated for user: {}", username);
            println!(
                "UPDATE users SET password_hash = '{}' WHERE username = '{}';",
                hash, username
            );
        }
        Err(e) => {
            eprintln!("Error generating hash: {}", e);
            std::process::exit(1);
        }
    }
}
