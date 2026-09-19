# gRPC-Web Migration

Phase records for the REST → gRPC strangler (ADR 014). These are
**point-in-time documents**: each captures the state at the end of its phase and
is not updated afterwards. The current contract of record is `proto/` (buf); the
current rollout state is
[`../../features.md`](../../features.md) → *gRPC-Web transport*.

| Phase | Document | Captures |
|---|---|---|
| 0 | [`phase-0-audit.md`](phase-0-audit.md) | REST surface inventory taken before any migration work |
| 1 | [`phase-1-contract.md`](phase-1-contract.md) | Proto contract and REST → RPC mapping for the rooms + housekeeping pilot |
| 3 | [`phase-3-web-client.md`](phase-3-web-client.md) | Generated Connect-ES clients and the per-context runtime flags in the React app |

Phase 2 (server-side tonic services) produced no standalone document — its
outcome is the `hotel-app-be/src/grpc/` module and the ADR.

Phases 0–3 have landed: rooms, room types, housekeeping, maintenance and guests
are served by tonic on the same Axum port and reachable from generated clients
behind per-context flags that default to REST. The production edge does not
route `/hotel.` yet, so the flags stay off outside development — see
[`../decision-records.md`](../decision-records.md) (ADR 014) and
[`../../guides/deployment.md`](../../guides/deployment.md).
