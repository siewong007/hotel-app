use bcrypt::{hash, DEFAULT_COST};

fn main() {
    let password = std::env::args().nth(1).expect("Please provide a password");
    let hashed = hash(&password, DEFAULT_COST).expect("Failed to hash password");
    println!("Password: {}", password);
    println!("Hash: {}", hashed);
}
