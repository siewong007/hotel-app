import { formatStatusLabel } from '../../utils/formatters';
import type { SegmentFieldOptions, SegmentRules } from './types';

/** How the rule builder renders a field's value input. */
export type SegmentValueKind =
  | 'text' // free text
  | 'choice' // single value from distinct/enum options
  | 'number'
  | 'bool'
  | 'tag'
  | 'tier';

export interface SegmentOpMeta {
  op: string;
  /** Key under the `segments` namespace — resolve with `t()` at render. */
  labelKey: string;
}

export interface SegmentFieldMeta {
  field: string;
  /** Key under the `segments` namespace — resolve with `t()` at render. */
  labelKey: string;
  kind: SegmentValueKind;
  ops: SegmentOpMeta[];
  /** true when the `in` operator takes a comma-separated list */
  listCapable?: boolean;
  options?: (fieldOptions: SegmentFieldOptions) => { value: string; label: string }[];
}

const TEXT_OPS: SegmentOpMeta[] = [
  { op: 'eq', labelKey: 'ops.is' },
  { op: 'ne', labelKey: 'ops.isNot' },
  { op: 'in', labelKey: 'ops.isOneOf' },
  { op: 'is_set', labelKey: 'ops.isSet' },
  { op: 'is_not_set', labelKey: 'ops.isNotSet' },
];

const NUM_OPS: SegmentOpMeta[] = [
  { op: 'eq', labelKey: 'ops.isExactly' },
  { op: 'gte', labelKey: 'ops.atLeast' },
  { op: 'lte', labelKey: 'ops.atMost' },
];

const RANGE_OPS: SegmentOpMeta[] = [
  { op: 'gte', labelKey: 'ops.atLeast' },
  { op: 'lte', labelKey: 'ops.atMost' },
];

const BOOL_OPS: SegmentOpMeta[] = [{ op: 'eq', labelKey: 'ops.is' }];

const textChoice = (
  pick: (o: SegmentFieldOptions) => string[],
): ((o: SegmentFieldOptions) => { value: string; label: string }[]) => {
  return (o) => pick(o).map((v) => ({ value: v, label: v }));
};

export const SEGMENT_FIELDS: SegmentFieldMeta[] = [
  {
    field: 'country',
    labelKey: 'fields.country',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.countries),
  },
  {
    field: 'nationality',
    labelKey: 'fields.nationality',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.nationalities),
  },
  {
    field: 'language_preference',
    labelKey: 'fields.language_preference',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.languages),
  },
  {
    field: 'communication_preference',
    labelKey: 'fields.communication_preference',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.communication_preferences),
  },
  {
    field: 'vip_status',
    labelKey: 'fields.vip_status',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.vip_statuses),
  },
  {
    field: 'guest_type',
    labelKey: 'fields.guest_type',
    kind: 'choice',
    ops: [
      { op: 'eq', labelKey: 'ops.is' },
      { op: 'ne', labelKey: 'ops.isNot' },
      { op: 'in', labelKey: 'ops.isOneOf' },
    ],
    listCapable: true,
    options: (o) => o.guest_types.map((v) => ({ value: v, label: formatStatusLabel(v) })),
  },
  {
    field: 'marketing_opt_in',
    labelKey: 'fields.marketing_opt_in',
    kind: 'bool',
    ops: BOOL_OPS,
  },
  {
    field: 'tags',
    labelKey: 'fields.tags',
    kind: 'tag',
    ops: [
      { op: 'contains', labelKey: 'ops.includesTag' },
      { op: 'not_contains', labelKey: 'ops.excludesTag' },
    ],
  },
  { field: 'total_stays', labelKey: 'fields.total_stays', kind: 'number', ops: NUM_OPS },
  { field: 'total_spend', labelKey: 'fields.total_spend', kind: 'number', ops: RANGE_OPS },
  { field: 'age_years', labelKey: 'fields.age_years', kind: 'number', ops: RANGE_OPS },
  {
    field: 'days_since_last_stay',
    labelKey: 'fields.days_since_last_stay',
    kind: 'number',
    ops: RANGE_OPS,
  },
  {
    field: 'loyalty_tier_id',
    labelKey: 'fields.loyalty_tier_id',
    kind: 'tier',
    ops: [
      { op: 'eq', labelKey: 'ops.is' },
      { op: 'in', labelKey: 'ops.isOneOf' },
    ],
    listCapable: true,
    options: (o) => o.loyalty_tiers.map((t) => ({ value: String(t.id), label: t.name })),
  },
  {
    field: 'has_loyalty_membership',
    labelKey: 'fields.has_loyalty_membership',
    kind: 'bool',
    ops: BOOL_OPS,
  },
];

export const segmentFieldMeta = (field: string): SegmentFieldMeta | undefined =>
  SEGMENT_FIELDS.find((f) => f.field === field);

export const opNeedsValue = (op: string): boolean => op !== 'is_set' && op !== 'is_not_set';

export const NO_VALUE_OPS = new Set(['is_set', 'is_not_set']);

/** Every group needs ≥1 condition; value-taking ops need a non-empty value.
 * Mirrors the backend's reject-empty rules so the dialog can fail fast. */
export const hasUsableRules = (rules: SegmentRules): boolean =>
  rules.groups.length > 0 &&
  rules.groups.every(
    (g) =>
      g.conditions.length > 0 &&
      g.conditions.every((c) => {
        if (NO_VALUE_OPS.has(c.op)) return true;
        if (Array.isArray(c.value)) return c.value.length > 0;
        return c.value !== undefined && c.value !== null && c.value !== '';
      }),
  );
