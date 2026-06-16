use rust_decimal::Decimal;
use std::convert::TryFrom;
fn main() {
    let d = Decimal::try_from(12.34f64).unwrap();
    println!("{}", d);
}
