//! Passphrase encryption for `hotel-backup` export files.
//!
//! The `system` scope carries credential, session and eKYC material, so its
//! documents must never exist as plaintext outside the database. This module
//! wraps the export byte stream in a chunked AEAD envelope and hands the
//! import path a `Read` adapter that decrypts transparently, so a staged
//! upload stays encrypted on disk and only ever decrypts into memory.
//!
//! Chunking is what keeps the export streaming: a single AES-GCM message
//! would have to be fully buffered before its tag could be written (and,
//! worse, fully buffered before a reader could trust a byte of it). Each
//! chunk is sealed independently and the reader authenticates it before
//! releasing it, so peak memory stays at one chunk in each direction.
//!
//! Envelope layout, all integers big-endian:
//!
//! ```text
//! magic       20 bytes  b"SALIMINN-BACKUP-ENC\x01"
//! header_len  u32
//! header      header_len bytes of JSON (KDF parameters, salt, nonce prefix)
//! frames      repeated { len: u32, body: ciphertext || 16-byte tag }
//! ```
//!
//! Three properties the envelope has to carry beyond confidentiality:
//!
//! - **Header integrity.** Every frame's AAD begins with a digest of the
//!   magic and header bytes, so an attacker cannot lower `iterations`, swap
//!   the salt, or re-point the nonce prefix without every frame failing to
//!   open.
//! - **Order.** The AAD binds the frame index, so frames cannot be reordered
//!   or spliced between files.
//! - **Truncation.** The last frame is sealed with a `final` marker; a reader
//!   that hits EOF without one errors instead of returning a short document.
//!   Without this a truncated file would decrypt cleanly into a partial
//!   backup, which is exactly the failure a backup must not have.

use std::io::{self, Read};
use std::num::NonZeroU32;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use ring::pbkdf2;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::core::error::ApiError;

/// Magic + envelope version. The trailing byte is the envelope revision, not
/// the `hotel-backup` document version — the plaintext inside carries its own.
pub const ENVELOPE_MAGIC: &[u8] = b"SALIMINN-BACKUP-ENC\x01";

/// Plaintext bytes per frame. Bounds both directions' working memory; the
/// export's cursor batches are far smaller, so this is the dominant term.
const CHUNK_PLAINTEXT_BYTES: usize = 1024 * 1024;

/// Largest `chunkSize` an incoming header may declare. A hostile file must
/// not be able to make the reader allocate arbitrarily.
const MAX_CHUNK_PLAINTEXT_BYTES: usize = 8 * 1024 * 1024;

/// PBKDF2-HMAC-SHA256 iterations — OWASP's 2023 floor for this primitive.
/// Deriving costs roughly half a second, which is why every caller runs the
/// derivation on a blocking worker.
const PBKDF2_ITERATIONS: u32 = 600_000;

/// Smallest iteration count the reader will honour from a file's header, so a
/// tampered envelope cannot downgrade the work factor to something brute
/// forceable. Files are always written at [`PBKDF2_ITERATIONS`].
const MIN_PBKDF2_ITERATIONS: u32 = 100_000;

const SALT_LEN: usize = 16;
const NONCE_PREFIX_LEN: usize = 4;
const KEY_LEN: usize = 32;
const TAG_LEN: usize = 16;
const HEADER_LEN_BYTES: usize = 4;
const FRAME_LEN_BYTES: usize = 4;

/// Largest header the reader will read before rejecting the file.
const MAX_HEADER_BYTES: usize = 4096;

/// Shortest passphrase accepted. A backup holding password hashes, TOTP seeds
/// and eKYC evidence is worth offline cracking, and PBKDF2 only buys so much
/// time — the length floor is what actually carries the entropy.
pub const MIN_PASSPHRASE_LEN: usize = 12;

/// The KDF and cipher parameters, stored as plaintext JSON ahead of the
/// frames. Authenticated by every frame's AAD rather than left malleable.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeHeader {
    cipher: String,
    kdf: String,
    iterations: u32,
    salt: String,
    nonce_prefix: String,
    chunk_size: u32,
}

/// Reject passphrases that cannot carry enough entropy to be worth the KDF.
pub fn validate_passphrase(passphrase: &str) -> Result<(), ApiError> {
    if passphrase.chars().count() < MIN_PASSPHRASE_LEN {
        return Err(ApiError::BadRequest(format!(
            "the backup passphrase must be at least {MIN_PASSPHRASE_LEN} characters"
        )));
    }
    Ok(())
}

/// Whether a staged file's leading bytes are an encrypted envelope. Used by
/// the upload sniff and by every path that must decide whether it needs a
/// passphrase before it can read the document.
pub fn is_encrypted_backup(prefix: &[u8]) -> bool {
    prefix.starts_with(ENVELOPE_MAGIC)
}

fn derive_key(passphrase: &str, salt: &[u8], iterations: u32) -> Result<[u8; KEY_LEN], String> {
    let iterations = NonZeroU32::new(iterations)
        .ok_or_else(|| "iteration count must be positive".to_string())?;
    let mut key = [0u8; KEY_LEN];
    pbkdf2::derive(
        pbkdf2::PBKDF2_HMAC_SHA256,
        iterations,
        salt,
        passphrase.as_bytes(),
        &mut key,
    );
    Ok(key)
}

/// The 32-byte AAD prefix every frame is bound to: a digest over the magic
/// and the exact header bytes as they appear in the file.
fn aad_prefix(header_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(ENVELOPE_MAGIC);
    hasher.update(header_bytes);
    hasher.finalize().into()
}

/// AAD for one frame: header digest, frame index, and whether this frame
/// closes the document.
fn frame_aad(prefix: &[u8; 32], index: u64, is_final: bool) -> [u8; 41] {
    let mut aad = [0u8; 41];
    aad[..32].copy_from_slice(prefix);
    aad[32..40].copy_from_slice(&index.to_be_bytes());
    aad[40] = u8::from(is_final);
    aad
}

fn nonce_for(nonce_prefix: &[u8; NONCE_PREFIX_LEN], index: u64) -> Nonce {
    let mut bytes = [0u8; 12];
    bytes[..NONCE_PREFIX_LEN].copy_from_slice(nonce_prefix);
    bytes[NONCE_PREFIX_LEN..].copy_from_slice(&index.to_be_bytes());
    // Unique by construction: the key is derived from a per-file random salt
    // and the index is strictly increasing within that file.
    Nonce::assume_unique_for_key(bytes)
}

fn unbound(key: &[u8; KEY_LEN]) -> LessSafeKey {
    LessSafeKey::new(UnboundKey::new(&AES_256_GCM, key).expect("valid AES-256 key"))
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

/// Wraps an outgoing export in the envelope. Callers push plaintext as it is
/// produced and emit whatever frames come back, then call [`finish`] exactly
/// once so the closing frame carries the `final` marker.
///
/// [`finish`]: BackupEncryptor::finish
pub struct BackupEncryptor {
    key: LessSafeKey,
    aad_prefix: [u8; 32],
    nonce_prefix: [u8; NONCE_PREFIX_LEN],
    prelude: Option<Vec<u8>>,
    buffer: Vec<u8>,
    counter: u64,
}

impl BackupEncryptor {
    /// Derive a fresh key and build the envelope prelude. Runs PBKDF2, so
    /// call it from a blocking context.
    pub fn new(passphrase: &str) -> Result<Self, ApiError> {
        validate_passphrase(passphrase)?;
        let mut rng = rand::rng();
        let salt: [u8; SALT_LEN] = rand::RngExt::random(&mut rng);
        let nonce_prefix: [u8; NONCE_PREFIX_LEN] = rand::RngExt::random(&mut rng);

        let header = EnvelopeHeader {
            cipher: "aes-256-gcm".to_string(),
            kdf: "pbkdf2-hmac-sha256".to_string(),
            iterations: PBKDF2_ITERATIONS,
            salt: B64.encode(salt),
            nonce_prefix: B64.encode(nonce_prefix),
            chunk_size: CHUNK_PLAINTEXT_BYTES as u32,
        };
        let header_bytes = serde_json::to_vec(&header)
            .map_err(|error| ApiError::Internal(format!("backup envelope header: {error}")))?;

        let key = derive_key(passphrase, &salt, PBKDF2_ITERATIONS)
            .map_err(|error| ApiError::Internal(format!("backup key derivation: {error}")))?;

        let mut prelude =
            Vec::with_capacity(ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES + header_bytes.len());
        prelude.extend_from_slice(ENVELOPE_MAGIC);
        prelude.extend_from_slice(&(header_bytes.len() as u32).to_be_bytes());
        prelude.extend_from_slice(&header_bytes);

        Ok(Self {
            key: unbound(&key),
            aad_prefix: aad_prefix(&header_bytes),
            nonce_prefix,
            prelude: Some(prelude),
            buffer: Vec::with_capacity(CHUNK_PLAINTEXT_BYTES),
            counter: 0,
        })
    }

    fn seal_frame(&mut self, plaintext: &[u8], is_final: bool) -> Result<Vec<u8>, ApiError> {
        let index = self.counter;
        self.counter += 1;
        let mut in_out = plaintext.to_vec();
        self.key
            .seal_in_place_append_tag(
                nonce_for(&self.nonce_prefix, index),
                Aad::from(frame_aad(&self.aad_prefix, index, is_final)),
                &mut in_out,
            )
            .map_err(|_| ApiError::Internal("backup frame encryption failed".to_string()))?;
        let mut frame = Vec::with_capacity(FRAME_LEN_BYTES + in_out.len());
        frame.extend_from_slice(&(in_out.len() as u32).to_be_bytes());
        frame.extend_from_slice(&in_out);
        Ok(frame)
    }

    /// Absorb plaintext and return any bytes ready to go out — the prelude on
    /// the first call, then a sealed frame per full chunk.
    pub fn push(&mut self, data: &[u8]) -> Result<Vec<u8>, ApiError> {
        let mut out = self.prelude.take().unwrap_or_default();
        self.buffer.extend_from_slice(data);
        while self.buffer.len() >= CHUNK_PLAINTEXT_BYTES {
            let rest = self.buffer.split_off(CHUNK_PLAINTEXT_BYTES);
            let chunk = std::mem::replace(&mut self.buffer, rest);
            out.extend_from_slice(&self.seal_frame(&chunk, false)?);
        }
        Ok(out)
    }

    /// Seal whatever is buffered as the closing frame. Always emits a frame —
    /// even for an empty tail — so the `final` marker is never absent.
    pub fn finish(mut self) -> Result<Vec<u8>, ApiError> {
        let mut out = self.prelude.take().unwrap_or_default();
        let tail = std::mem::take(&mut self.buffer);
        out.extend_from_slice(&self.seal_frame(&tail, true)?);
        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

/// A `Read` over an encrypted envelope that yields the plaintext document, so
/// `serde_json::from_reader` and the sensitivity sniff work against an
/// encrypted staged file without either learning about the envelope.
///
/// Each frame is authenticated before any of its bytes are handed out, and
/// EOF before the `final` frame is an error — a truncated backup fails loudly
/// instead of parsing as a shorter one.
pub struct DecryptingReader<R: Read> {
    inner: R,
    key: LessSafeKey,
    aad_prefix: [u8; 32],
    nonce_prefix: [u8; NONCE_PREFIX_LEN],
    max_frame_len: usize,
    counter: u64,
    plain: Vec<u8>,
    offset: usize,
    saw_final: bool,
}

impl<R: Read> DecryptingReader<R> {
    /// Read and validate the envelope prelude, deriving the key. Runs PBKDF2,
    /// so call it from a blocking context.
    pub fn new(mut inner: R, passphrase: &str) -> Result<Self, String> {
        let mut magic = vec![0u8; ENVELOPE_MAGIC.len()];
        inner
            .read_exact(&mut magic)
            .map_err(|_| "the file is too short to be an encrypted backup".to_string())?;
        if magic != ENVELOPE_MAGIC {
            return Err("the file is not an encrypted backup envelope".to_string());
        }

        let mut len_bytes = [0u8; HEADER_LEN_BYTES];
        inner
            .read_exact(&mut len_bytes)
            .map_err(|_| "the encrypted backup header is truncated".to_string())?;
        let header_len = u32::from_be_bytes(len_bytes) as usize;
        if header_len == 0 || header_len > MAX_HEADER_BYTES {
            return Err("the encrypted backup header is not a plausible size".to_string());
        }
        let mut header_bytes = vec![0u8; header_len];
        inner
            .read_exact(&mut header_bytes)
            .map_err(|_| "the encrypted backup header is truncated".to_string())?;

        let header: EnvelopeHeader = serde_json::from_slice(&header_bytes)
            .map_err(|error| format!("the encrypted backup header is unreadable: {error}"))?;
        if header.cipher != "aes-256-gcm" {
            return Err(format!("unsupported backup cipher '{}'", header.cipher));
        }
        if header.kdf != "pbkdf2-hmac-sha256" {
            return Err(format!(
                "unsupported backup key derivation '{}'",
                header.kdf
            ));
        }
        if header.iterations < MIN_PBKDF2_ITERATIONS {
            return Err("the backup header declares too weak a key derivation".to_string());
        }
        let chunk_size = header.chunk_size as usize;
        if chunk_size == 0 || chunk_size > MAX_CHUNK_PLAINTEXT_BYTES {
            return Err("the backup header declares an implausible chunk size".to_string());
        }

        let salt = B64
            .decode(&header.salt)
            .map_err(|_| "the backup header salt is not valid base64".to_string())?;
        if salt.len() != SALT_LEN {
            return Err("the backup header salt is the wrong length".to_string());
        }
        let nonce_prefix_bytes = B64
            .decode(&header.nonce_prefix)
            .map_err(|_| "the backup header nonce is not valid base64".to_string())?;
        if nonce_prefix_bytes.len() != NONCE_PREFIX_LEN {
            return Err("the backup header nonce is the wrong length".to_string());
        }
        let mut nonce_prefix = [0u8; NONCE_PREFIX_LEN];
        nonce_prefix.copy_from_slice(&nonce_prefix_bytes);

        let key = derive_key(passphrase, &salt, header.iterations)?;

        Ok(Self {
            inner,
            key: unbound(&key),
            aad_prefix: aad_prefix(&header_bytes),
            nonce_prefix,
            max_frame_len: chunk_size + TAG_LEN,
            counter: 0,
            plain: Vec::new(),
            offset: 0,
            saw_final: false,
        })
    }

    /// Pull and authenticate the next frame into `plain`. `Ok(false)` means a
    /// clean end of document.
    fn fill(&mut self) -> io::Result<bool> {
        if self.saw_final {
            // A frame after the closing one means bytes were appended.
            let mut probe = [0u8; 1];
            return match self.inner.read(&mut probe) {
                Ok(0) => Ok(false),
                Ok(_) => Err(invalid(
                    "the encrypted backup has trailing data after its final frame",
                )),
                Err(error) => Err(error),
            };
        }

        let mut len_bytes = [0u8; FRAME_LEN_BYTES];
        match self.inner.read_exact(&mut len_bytes) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {
                return Err(invalid(
                    "the encrypted backup ends before its final frame — the file is truncated",
                ));
            }
            Err(error) => return Err(error),
        }
        let frame_len = u32::from_be_bytes(len_bytes) as usize;
        if frame_len < TAG_LEN || frame_len > self.max_frame_len {
            return Err(invalid(
                "the encrypted backup declares an invalid frame size",
            ));
        }
        let mut frame = vec![0u8; frame_len];
        self.inner
            .read_exact(&mut frame)
            .map_err(|_| invalid("the encrypted backup ends mid-frame — the file is truncated"))?;

        let index = self.counter;
        self.counter += 1;

        // Which marker the frame was sealed under is not known until it
        // opens, so try the closing form and fall back to the interior one.
        let nonce = nonce_for(&self.nonce_prefix, index);
        let mut candidate = frame.clone();
        let opened = self
            .key
            .open_in_place(
                nonce,
                Aad::from(frame_aad(&self.aad_prefix, index, true)),
                &mut candidate,
            )
            .map(|plain| (plain.len(), true));
        let (plain_len, is_final) = match opened {
            Ok(result) => result,
            Err(_) => {
                candidate = frame;
                let plain = self
                    .key
                    .open_in_place(
                        nonce_for(&self.nonce_prefix, index),
                        Aad::from(frame_aad(&self.aad_prefix, index, false)),
                        &mut candidate,
                    )
                    .map_err(|_| {
                        invalid(
                            "the backup could not be decrypted — wrong passphrase, or the file has been altered",
                        )
                    })?;
                (plain.len(), false)
            }
        };

        candidate.truncate(plain_len);
        self.plain = candidate;
        self.offset = 0;
        self.saw_final = is_final;
        // A closing frame may legitimately be empty; keep going so the
        // trailing-data probe runs on the next call.
        Ok(!self.plain.is_empty() || !is_final)
    }
}

impl<R: Read> Read for DecryptingReader<R> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        while self.offset >= self.plain.len() {
            if !self.fill()? {
                return Ok(0);
            }
        }
        let take = (self.plain.len() - self.offset).min(out.len());
        out[..take].copy_from_slice(&self.plain[self.offset..self.offset + take]);
        self.offset += take;
        Ok(take)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seal(passphrase: &str, plaintext: &[u8]) -> Vec<u8> {
        let mut encryptor = BackupEncryptor::new(passphrase).expect("encryptor");
        let mut out = encryptor.push(plaintext).expect("push");
        out.extend_from_slice(&encryptor.finish().expect("finish"));
        out
    }

    fn open(passphrase: &str, sealed: &[u8]) -> Result<Vec<u8>, String> {
        let mut reader = DecryptingReader::new(io::Cursor::new(sealed.to_vec()), passphrase)?;
        let mut plain = Vec::new();
        reader
            .read_to_end(&mut plain)
            .map_err(|error| error.to_string())?;
        Ok(plain)
    }

    #[test]
    fn round_trips_a_document() {
        let document = br#"{"format":"hotel-backup","version":1}"#;
        let sealed = seal("correct horse battery", document);
        assert!(is_encrypted_backup(&sealed));
        assert_eq!(open("correct horse battery", &sealed).unwrap(), document);
    }

    #[test]
    fn round_trips_across_many_chunks() {
        // Three chunks plus a remainder, so interior and closing frames and
        // the reader's refill path all get exercised.
        let document: Vec<u8> = (0..CHUNK_PLAINTEXT_BYTES * 3 + 7)
            .map(|index| (index % 251) as u8)
            .collect();
        let sealed = seal("correct horse battery", &document);
        assert_eq!(open("correct horse battery", &sealed).unwrap(), document);
    }

    #[test]
    fn round_trips_an_empty_document() {
        let sealed = seal("correct horse battery", b"");
        assert_eq!(open("correct horse battery", &sealed).unwrap(), b"");
    }

    #[test]
    fn rejects_the_wrong_passphrase() {
        let sealed = seal("correct horse battery", b"{}");
        let error = open("incorrect horse batt", &sealed).unwrap_err();
        assert!(error.contains("wrong passphrase"), "{error}");
    }

    #[test]
    fn rejects_a_truncated_file() {
        let document: Vec<u8> = vec![b'x'; CHUNK_PLAINTEXT_BYTES * 2];
        let sealed = seal("correct horse battery", &document);
        // Drop the closing frame entirely.
        let cut = sealed.len() - 64;
        let error = open("correct horse battery", &sealed[..cut]).unwrap_err();
        assert!(error.contains("truncated"), "{error}");
    }

    #[test]
    fn rejects_appended_data() {
        let mut sealed = seal("correct horse battery", b"{}");
        sealed.extend_from_slice(b"junk");
        let error = open("correct horse battery", &sealed).unwrap_err();
        assert!(error.contains("trailing data"), "{error}");
    }

    #[test]
    fn rejects_a_tampered_header() {
        let mut sealed = seal("correct horse battery", b"{}");
        // Flip a byte inside the header JSON, past the magic and length.
        let index = ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES + 2;
        sealed[index] ^= 0x20;
        // Either the header stops parsing or every frame fails to open —
        // both are rejections, neither may return plaintext.
        assert!(open("correct horse battery", &sealed).is_err());
    }

    #[test]
    fn rejects_reordered_frames() {
        let document: Vec<u8> = vec![b'y'; CHUNK_PLAINTEXT_BYTES + 32];
        let sealed = seal("correct horse battery", &document);
        let prelude_len = {
            let header_len = u32::from_be_bytes(
                sealed[ENVELOPE_MAGIC.len()..ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES]
                    .try_into()
                    .unwrap(),
            ) as usize;
            ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES + header_len
        };
        // Replay the first frame in place of itself twice: the second copy
        // sits at index 1 and must fail its AAD.
        let first_len = u32::from_be_bytes(
            sealed[prelude_len..prelude_len + FRAME_LEN_BYTES]
                .try_into()
                .unwrap(),
        ) as usize;
        let first = &sealed[prelude_len..prelude_len + FRAME_LEN_BYTES + first_len];
        let mut replayed = sealed[..prelude_len].to_vec();
        replayed.extend_from_slice(first);
        replayed.extend_from_slice(first);
        assert!(open("correct horse battery", &replayed).is_err());
    }

    #[test]
    fn rejects_a_short_passphrase() {
        let error = BackupEncryptor::new("short").err().unwrap();
        assert!(matches!(error, ApiError::BadRequest(_)));
    }

    #[test]
    fn rejects_a_downgraded_iteration_count() {
        // A file claiming a cheap KDF must be refused before the key is even
        // derived, so a stolen backup cannot be re-headed for fast cracking.
        let sealed = seal("correct horse battery", b"{}");
        let header_len = u32::from_be_bytes(
            sealed[ENVELOPE_MAGIC.len()..ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES]
                .try_into()
                .unwrap(),
        ) as usize;
        let start = ENVELOPE_MAGIC.len() + HEADER_LEN_BYTES;
        let mut header: EnvelopeHeader =
            serde_json::from_slice(&sealed[start..start + header_len]).unwrap();
        header.iterations = 10;
        let rewritten = serde_json::to_vec(&header).unwrap();
        let mut forged = Vec::new();
        forged.extend_from_slice(ENVELOPE_MAGIC);
        forged.extend_from_slice(&(rewritten.len() as u32).to_be_bytes());
        forged.extend_from_slice(&rewritten);
        forged.extend_from_slice(&sealed[start + header_len..]);
        let error = open("correct horse battery", &forged).unwrap_err();
        assert!(error.contains("too weak"), "{error}");
    }
}
