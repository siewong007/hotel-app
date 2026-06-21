#[allow(dead_code)] // seed defaults; not yet wired to a seeding routine
pub const DEFAULT_TIERS: [(&str, &str, i32, i32, i32, f64, &str); 3] = [
    (
        "silver",
        "Silver",
        1,
        0,
        0,
        0.0,
        r#"["Member rates","Points on eligible stays"]"#,
    ),
    (
        "gold",
        "Gold",
        2,
        5000,
        10,
        2500.0,
        r#"["Priority support","Late checkout when available","Bonus earning"]"#,
    ),
    (
        "platinum",
        "Platinum",
        3,
        15000,
        30,
        7500.0,
        r#"["Room upgrade priority","Welcome amenity","Highest earning rate"]"#,
    ),
];

#[allow(dead_code)] // seed defaults; not yet wired to a seeding routine
pub const DEFAULT_REWARDS: [(&str, &str, &str, i32, bool); 3] = [
    (
        "Late checkout",
        "Request a late checkout on an eligible stay.",
        "service",
        750,
        true,
    ),
    (
        "Room upgrade request",
        "Request a one-category room upgrade when available.",
        "room_upgrade",
        2000,
        true,
    ),
    (
        "Dining credit",
        "Apply a dining credit during a future stay.",
        "dining",
        1500,
        false,
    ),
];
