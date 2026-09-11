import { describe, expect, it } from 'vitest';
import type { UserSessionInfo } from '../../../../types';
import { sessionActivityLine, sessionLocation } from './sessionLocation';

function session(overrides: Partial<UserSessionInfo> = {}): UserSessionInfo {
  return {
    id: 'session-1',
    created_at: '2026-09-01T10:00:00Z',
    last_used_at: '2026-09-02T10:00:00Z',
    expires_at: '2026-10-01T10:00:00Z',
    is_current: false,
    ...overrides,
  };
}

describe('sessionLocation', () => {
  it('uses the label the backend derived', () => {
    expect(sessionLocation(session({ location: 'Kuala Lumpur' }))).toBe('Kuala Lumpur');
  });

  it('falls back to the raw zone when no label was derived', () => {
    expect(sessionLocation(session({ location: null, timezone: 'Etc/GMT+8' }))).toBe('Etc/GMT+8');
  });

  it('returns null for a session that carries no location at all', () => {
    // Normal for sessions minted before the field existed — the UI must render
    // those without an empty "·" dangling off the end of the line.
    expect(sessionLocation(session())).toBeNull();
    expect(sessionLocation(session({ location: '  ', timezone: '  ' }))).toBeNull();
  });
});

describe('sessionActivityLine', () => {
  it('marks the location as approximate, because it is a time zone and not a position', () => {
    const line = sessionActivityLine(session({ location: 'Kuala Lumpur' }));
    expect(line).toContain('Kuala Lumpur');
    expect(line).toContain('approximate');
  });

  it('omits the location clause entirely when there is none', () => {
    const line = sessionActivityLine(session());
    expect(line).toContain('Last active:');
    expect(line).not.toContain('approximate');
    expect(line).not.toContain('·');
  });
});
