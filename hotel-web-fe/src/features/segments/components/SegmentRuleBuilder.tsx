import {
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';

import {
  NO_VALUE_OPS,
  SEGMENT_FIELDS,
  segmentFieldMeta,
  type SegmentFieldMeta,
} from '../constants';
import type {
  SegmentCondition,
  SegmentFieldOptions,
  SegmentRules,
} from '../types';

interface SegmentRuleBuilderProps {
  rules: SegmentRules;
  onChange: (rules: SegmentRules) => void;
  fieldOptions?: SegmentFieldOptions;
  disabled?: boolean;
}

const asList = (value: SegmentCondition['value']): (string | number)[] =>
  Array.isArray(value) ? value : [];

function ConditionRow({
  condition,
  fieldOptions,
  disabled,
  onChange,
  onRemove,
}: {
  condition: SegmentCondition;
  fieldOptions?: SegmentFieldOptions;
  disabled?: boolean;
  onChange: (next: SegmentCondition) => void;
  onRemove: () => void;
}) {
  const meta = segmentFieldMeta(condition.field);

  const changeField = (field: string) => {
    const nextMeta = segmentFieldMeta(field);
    onChange({ field, op: nextMeta?.ops[0]?.op ?? 'eq', value: undefined });
  };

  const changeOp = (op: string) => {
    let value: SegmentCondition['value'];
    if (!NO_VALUE_OPS.has(op)) {
      value = op === 'in' ? [] : meta?.kind === 'bool' ? false : meta?.kind === 'number' ? 0 : '';
    }
    onChange({ ...condition, op, value });
  };

  const valueInput = (m: SegmentFieldMeta) => {
    if (NO_VALUE_OPS.has(condition.op)) return null;

    if (condition.op === 'in' && m.listCapable && m.options) {
      const options = m.options(fieldOptions ?? EMPTY_OPTIONS);
      return (
        <TextField
          select
          label="Values"
          value={asList(condition.value).map(String)}
          onChange={(e) => {
            const raw = e.target.value as unknown as string[];
            onChange({
              ...condition,
              value: m.kind === 'tier' ? raw.map(Number) : raw,
            });
          }}
          slotProps={{ select: { multiple: true } }}
          sx={{ minWidth: 220 }}
          disabled={disabled}
        >
          {options.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      );
    }

    switch (m.kind) {
      case 'bool':
        return (
          <TextField
            select
            label="Value"
            value={condition.value === true || condition.value === 'true' ? 'true' : 'false'}
            onChange={(e) => onChange({ ...condition, value: e.target.value === 'true' })}
            sx={{ minWidth: 120 }}
            disabled={disabled}
          >
            <MenuItem value="true">True</MenuItem>
            <MenuItem value="false">False</MenuItem>
          </TextField>
        );
      case 'number':
        return (
          <TextField
            label="Value"
            type="number"
            value={condition.value ?? ''}
            onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
            sx={{ minWidth: 140 }}
            disabled={disabled}
          />
        );
      case 'choice':
      case 'tier': {
        const options = m.options?.(fieldOptions ?? EMPTY_OPTIONS) ?? [];
        const numeric = m.kind === 'tier';
        return (
          <TextField
            select
            label="Value"
            value={condition.value === undefined ? '' : String(condition.value)}
            onChange={(e) =>
              onChange({
                ...condition,
                value: numeric ? Number(e.target.value) : e.target.value,
              })
            }
            sx={{ minWidth: 200 }}
            disabled={disabled}
            helperText={options.length === 0 ? 'No recorded values yet — type is not allowed' : undefined}
          >
            {options.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        );
      }
      default:
        return (
          <TextField
            label={m.kind === 'tag' ? 'Tag' : 'Value'}
            value={condition.value ?? ''}
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
            sx={{ minWidth: 200 }}
            disabled={disabled}
          />
        );
    }
  };

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
      <TextField
        select
        label="Field"
        value={condition.field}
        onChange={(e) => changeField(e.target.value)}
        sx={{ minWidth: 200 }}
        disabled={disabled}
      >
        {SEGMENT_FIELDS.map((f) => (
          <MenuItem key={f.field} value={f.field}>
            {f.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Condition"
        value={condition.op}
        onChange={(e) => changeOp(e.target.value)}
        sx={{ minWidth: 140 }}
        disabled={disabled}
      >
        {(meta?.ops ?? []).map((o) => (
          <MenuItem key={o.op} value={o.op}>
            {o.label}
          </MenuItem>
        ))}
      </TextField>
      {meta && valueInput(meta)}
      <IconButton
        aria-label="Remove condition"
        onClick={onRemove}
        disabled={disabled}
        sx={{ mt: 0.5 }}
      >
        <DeleteOutlinedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

const EMPTY_OPTIONS: SegmentFieldOptions = {
  loyalty_tiers: [],
  guest_types: [],
  distinct_values: {
    countries: [],
    nationalities: [],
    languages: [],
    communication_preferences: [],
    vip_statuses: [],
  },
};

export function SegmentRuleBuilder({
  rules,
  onChange,
  fieldOptions,
  disabled,
}: SegmentRuleBuilderProps) {
  const patchGroup = (gi: number, conditions: SegmentCondition[]) => {
    const groups = rules.groups.map((g, i) => (i === gi ? { conditions } : g));
    onChange({ groups });
  };

  const removeGroup = (gi: number) =>
    onChange({ groups: rules.groups.filter((_, i) => i !== gi) });

  return (
    <Stack spacing={2}>
      {rules.groups.map((group, gi) => (
        <Box key={gi}>
          {gi > 0 && (
            <Divider sx={{ my: 1 }}>
              <Typography variant="caption" color="text.secondary">
                OR
              </Typography>
            </Divider>
          )}
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack spacing={1.5}>
              {group.conditions.map((condition, ci) => (
                <Box key={ci}>
                                  {ci > 0 && (
                    <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
                      AND
                    </Typography>
                  )}
                  <ConditionRow
                    condition={condition}
                    fieldOptions={fieldOptions}
                    disabled={disabled}
                    onChange={(next) =>
                      patchGroup(
                        gi,
                        group.conditions.map((c, i) => (i === ci ? next : c)),
                      )
                    }
                    onRemove={() =>
                      patchGroup(
                        gi,
                        group.conditions.filter((_, i) => i !== ci),
                      )
                    }
                  />
                </Box>
              ))}
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() =>
                    patchGroup(gi, [
                      ...group.conditions,
                      { field: SEGMENT_FIELDS[0].field, op: 'eq', value: '' },
                    ])
                  }
                  disabled={disabled}
                >
                  Add condition
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => removeGroup(gi)}
                  disabled={disabled}
                >
                  Remove group
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Box>
      ))}
      <Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() =>
            onChange({
              groups: [
                ...rules.groups,
                { conditions: [{ field: SEGMENT_FIELDS[0].field, op: 'eq', value: '' }] },
              ],
            })
          }
          disabled={disabled}
        >
          Add OR group
        </Button>
      </Box>
    </Stack>
  );
}
