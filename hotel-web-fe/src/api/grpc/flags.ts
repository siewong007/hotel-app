// Per-bounded-context runtime switch for the strangler migration. A context
// migrates to gRPC-Web only when enabled; everything else stays on REST, so
// each context can roll forward (and roll back) independently.
//
// Resolution order:
//   1. `storage['grpcContexts']` — explicit per-browser override, written by
//      the rollout toggle / dev tooling. Presence (even an empty list) wins
//      over the build default so a bad context can be forced off without a
//      redeploy.
//   2. `VITE_GRPC_CONTEXTS` — build-time default set (comma-separated).
//   3. Default: none — REST everywhere until a context has been validated.

import { storage } from '../../utils/storage';

export type GrpcContext = 'rooms' | 'housekeeping' | 'maintenance' | 'guests';

const envContexts = new Set(
  ((import.meta.env.VITE_GRPC_CONTEXTS as string | undefined) || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
);

export function grpcEnabled(context: GrpcContext): boolean {
  const stored = storage.getItem<GrpcContext[]>('grpcContexts');
  if (Array.isArray(stored)) {
    return stored.includes(context);
  }
  return envContexts.has(context);
}

/** Persists the rollout override; pass `null` to fall back to the build default. */
export function setGrpcContexts(contexts: GrpcContext[] | null): void {
  if (contexts === null) {
    storage.removeItem('grpcContexts');
  } else {
    storage.setItem('grpcContexts', contexts);
  }
}
