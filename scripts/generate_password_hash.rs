// Quick script to generate bcrypt password hash
// Run with: cargo run --bin generate_password_hash

use bcrypt::{hash, DEFAULT_COST};

fn main() {
    let password = "admin123";
    match hash(password, DEFAULT_COST) {
        Ok(hash) => println!("Password: {}", password);
        println!("Hash: {}", hash);
        },
        Err(e) => eprintln!("Error: {}", e),
    }
}



