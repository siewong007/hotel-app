// Utility to generate password hash
// Run with: cargo run --bin fix_password

use bcrypt::{hash, DEFAULT_COST};

fn main() {
    let password = "admin123";
    match hash(password, DEFAULT_COST) {
        Ok(hash) => {
            println!("Password: {}", password);
            println!("Hash: {}", hash);
            println!("\nSQL to update:");
            println!("UPDATE users SET password_hash = '{}' WHERE username = 'admin';", hash);
        },
        Err(e) => {
            eprintln!("Error generating hash: {}", e);
            std::process::exit(1);
        }
    }
}




