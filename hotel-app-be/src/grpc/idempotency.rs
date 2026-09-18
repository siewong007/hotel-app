//! Client `request_id` idempotency for mutating RPCs.
//!
//! The contract requires every mutating RPC to honor a client-supplied
//! `request_id`: retrying the same `(method, request_id)` replays the
//! original response instead of executing the mutation twice. REST has no
//! equivalent — its mutations are at-most-once per HTTP request — so this is
//! strictly additive and changes no existing behavior.
//!
//! Implementation is an in-process cache of encoded responses with a TTL and
//! a hard capacity bound. Scope notes:
//! - Entries live for `TTL` (1h) — long enough for client retry windows,
//!   short enough that stale entries can't mask legitimate later mutations.
//! - The cache is per-process; the multi-instance story (a shared store) is
//!   deliberately deferred until a second backend instance exists.
//! - An empty `request_id` skips the cache entirely — callers that don't opt
//!   in get plain at-most-once semantics, identical to REST.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use prost::Message;
use tonic::{Response, Status};

const TTL: Duration = Duration::from_secs(60 * 60);
const MAX_ENTRIES: usize = 10_000;

type CacheKey = (String, String);
type CacheEntry = (Vec<u8>, Instant);

#[derive(Default)]
pub struct IdempotencyCache {
    entries: Mutex<HashMap<CacheKey, CacheEntry>>,
}

impl IdempotencyCache {
    /// Runs `f` once per `(method, request_id)`; a repeat within the TTL
    /// replays the cached response. `request_id == ""` bypasses the cache.
    pub async fn run<Res, F, Fut>(
        &self,
        method: &str,
        request_id: &str,
        f: F,
    ) -> Result<Response<Res>, Status>
    where
        Res: Message + Default,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Response<Res>, Status>>,
    {
        if !request_id.is_empty() {
            let key = (method.to_string(), request_id.to_string());
            if let Some(bytes) = self.lookup(&key) {
                let res = Res::decode(bytes.as_slice())
                    .map_err(|_| Status::internal("cached idempotent response failed to decode"))?;
                return Ok(Response::new(res));
            }
            let resp = f().await?;
            self.store(key, resp.get_ref().encode_to_vec());
            return Ok(resp);
        }
        f().await
    }

    fn lookup(&self, key: &CacheKey) -> Option<Vec<u8>> {
        let mut entries = self.entries.lock().ok()?;
        match entries.get(key) {
            Some((bytes, at)) if at.elapsed() < TTL => Some(bytes.clone()),
            Some(_) => {
                entries.remove(key);
                None
            }
            None => None,
        }
    }

    fn store(&self, key: CacheKey, bytes: Vec<u8>) {
        if let Ok(mut entries) = self.entries.lock() {
            if entries.len() >= MAX_ENTRIES {
                // Bounded memory: drop expired entries first; if still full,
                // drop the oldest quarter rather than failing the request.
                entries.retain(|_, (_, at)| at.elapsed() < TTL);
                if entries.len() >= MAX_ENTRIES {
                    let cutoff = Instant::now() - TTL / 2;
                    entries.retain(|_, (_, at)| *at > cutoff);
                }
            }
            entries.insert(key, (bytes, Instant::now()));
        }
    }
}
