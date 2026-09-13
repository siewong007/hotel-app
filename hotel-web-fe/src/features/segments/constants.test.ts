import { describe, expect, it } from 'vitest';

import {
  NO_VALUE_OPS,
  SEGMENT_FIELDS,
  hasUsableRules,
  opNeedsValue,
  segmentFieldMeta,
} from './constants';
import type { SegmentRules } from './types';

describe('segment field metadata', () => {
  it('every field the backend compiler accepts is present', () => {
    const fields = new Set(SEGMENT_FIELDS.map((f) => f.field));
    for (const field of [
      'country',
      'nationality',
      'language_preference',
      'communication_preference',
      'vip_status',
      'guest_type',
      'marketing_opt_in',
      'tags',
      'total_stays',
      'total_spend',
      'age_years',
      'days_since_last_stay',
      'loyalty_tier_id',
      'has_loyalty_membership',
    ]) {
      expect(fields.has(field), `missing field meta: ${field}`).toBe(true);
    }
  });

  it('every declared op is known to the compiler vocabulary', () => {
    const known = new Set([
      'eq',
      'ne',
      'in',
      'is_set',
      'is_not_set',
      'gte',
      'lte',
      'contains',
      'not_contains',
    ]);
    for (const f of SEGMENT_FIELDS) {
      for (const o of f.ops) {
        expect(known.has(o.op), `unknown op ${o.op} on ${f.field}`).toBe(true);
      }
    }
  });

  it('is_set/is_not_set take no value', () => {
    expect(opNeedsValue('is_set')).toBe(false);
    expect(opNeedsValue('is_not_set')).toBe(false);
    expect(NO_VALUE_OPS.has('eq')).toBe(false);
  });
});

describe('hasUsableRules', () => {
  const rules = (groups: SegmentRules['groups']): SegmentRules => ({ groups });

  it('rejects empty groups and empty conditions', () => {
    expect(hasUsableRules(rules([]))).toBe(false);
    expect(hasUsableRules(rules([{ conditions: [] }]))).toBe(false);
  });

  it('rejects a value-taking op with an empty value', () => {
    expect(
      hasUsableRules(rules([{ conditions: [{ field: 'country', op: 'eq', value: '' }] }])),
    ).toBe(false);
    expect(
      hasUsableRules(rules([{ conditions: [{ field: 'country', op: 'in', value: [] }] }])),
    ).toBe(false);
  });

  it('accepts value-less ops and populated conditions', () => {
    expect(
      hasUsableRules(
        rules([{ conditions: [{ field: 'country', op: 'is_set' }] }]),
      ),
    ).toBe(true);
    expect(
      hasUsableRules(
        rules([
          {
            conditions: [
              { field: 'country', op: 'eq', value: 'Malaysia' },
              { field: 'total_stays', op: 'gte', value: 3 },
            ],
          },
          { conditions: [{ field: 'vip_status', op: 'is_set' }] },
        ]),
      ),
    ).toBe(true);
  });
});

describe('segmentFieldMeta', () => {
  it('maps each field to a known meta or undefined', () => {
    expect(segmentFieldMeta('country')?.kind).toBe('choice');
    expect(segmentFieldMeta('loyalty_tier_id')?.kind).toBe('tier');
    expect(segmentFieldMeta('nope')).toBeUndefined();
  });
});
