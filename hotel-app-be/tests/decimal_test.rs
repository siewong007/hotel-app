use rust_decimal::Decimal;
use std::convert::TryFrom;
#[test]
fn test_decimal_try_from() {
    let d = Decimal::try_from(12.34f64).unwrap();
    assert_eq!(d.to_string(), "12.34");
}
