export interface IdempotencyAttempt {
  fingerprint: string;
  key: string;
}

export function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function getIdempotencyAttempt(
  current: IdempotencyAttempt | null,
  fingerprint: string,
): IdempotencyAttempt {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, key: createIdempotencyKey() };
}
