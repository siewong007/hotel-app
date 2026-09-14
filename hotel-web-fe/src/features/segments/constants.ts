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
  label: string;
}

export interface SegmentFieldMeta {
  field: string;
  label: string;
  kind: SegmentValueKind;
  ops: SegmentOpMeta[];
  /** true when the `in` operator takes a comma-separated list */
  listCapable?: boolean;
  options?: (fieldOptions: SegmentFieldOptions) => { value: string; label: string }[];
}

const TEXT_OPS: SegmentOpMeta[] = [
  { op: 'eq', label: 'is' },
  { op: 'ne', label: 'is not' },
  { op: 'in', label: 'is one of' },
  { op: 'is_set', label: 'is set' },
  { op: 'is_not_set', label: 'is not set' },
];

const NUM_OPS: SegmentOpMeta[] = [
  { op: 'eq', label: 'is exactly' },
  { op: 'gte', label: 'at least' },
  { op: 'lte', label: 'at most' },
];

const RANGE_OPS: SegmentOpMeta[] = [
  { op: 'gte', label: 'at least' },
  { op: 'lte', label: 'at most' },
];

const BOOL_OPS: SegmentOpMeta[] = [{ op: 'eq', label: 'is' }];

const textChoice = (
  pick: (o: SegmentFieldOptions) => string[],
): ((o: SegmentFieldOptions) => { value: string; label: string }[]) => {
  return (o) => pick(o).map((v) => ({ value: v, label: v }));
};

export const SEGMENT_FIELDS: SegmentFieldMeta[] = [
  {
    field: 'country',
    label: 'Country',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.countries),
  },
  {
    field: 'nationality',
    label: 'Nationality',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.nationalities),
  },
  {
    field: 'language_preference',
    label: 'Language preference',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.languages),
  },
  {
    field: 'communication_preference',
    label: 'Communication preference',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.communication_preferences),
  },
  {
    field: 'vip_status',
    label: 'VIP status',
    kind: 'choice',
    ops: TEXT_OPS,
    listCapable: true,
    options: textChoice((o) => o.distinct_values.vip_statuses),
  },
  {
    field: 'guest_type',
    label: 'Guest type',
    kind: 'choice',
    ops: [
      { op: 'eq', label: 'is' },
      { op: 'ne', label: 'is not' },
      { op: 'in', label: 'is one of' },
    ],
    listCapable: true,
    options: (o) => o.guest_types.map((v) => ({ value: v, label: formatStatusLabel(v) })),
  },
  {
    field: 'marketing_opt_in',
    label: 'Marketing opt-in',
    kind: 'bool',
    ops: BOOL_OPS,
  },
  {
    field: 'tags',
    label: 'Guest tags',
    kind: 'tag',
    ops: [
      { op: 'contains', label: 'includes tag' },
      { op: 'not_contains', label: 'excludes tag' },
    ],
  },
  { field: 'total_stays', label: 'Total stays', kind: 'number', ops: NUM_OPS },
  { field: 'total_spend', label: 'Total spend', kind: 'number', ops: RANGE_OPS },
  { field: 'age_years', label: 'Age (years)', kind: 'number', ops: RANGE_OPS },
  {
    field: 'days_since_last_stay',
    label: 'Days since last stay',
    kind: 'number',
    ops: RANGE_OPS,
  },
  {
    field: 'loyalty_tier_id',
    label: 'Loyalty tier',
    kind: 'tier',
    ops: [
      { op: 'eq', label: 'is' },
      { op: 'in', label: 'is one of' },
    ],
    listCapable: true,
    options: (o) => o.loyalty_tiers.map((t) => ({ value: String(t.id), label: t.name })),
  },
  {
    field: 'has_loyalty_membership',
    label: 'Loyalty membership',
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
