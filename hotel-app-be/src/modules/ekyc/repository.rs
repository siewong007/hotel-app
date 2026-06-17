//! eKYC repository.
//!
//! Re-exports from the global repository for backward compatibility.
//! During incremental migration, SQL queries remain in `repositories/ekyc.rs`.

pub use crate::repositories::ekyc::{
    EkycActionUpdate, EkycHistoryInsert, EkycNoteInsert, EkycRepository, NewEkycVerification,
};