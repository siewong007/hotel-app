import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddOutlined as AddIcon,
  DeleteOutlineOutlined as DeleteIcon,
  HistoryOutlined as LegacyIcon,
  InfoOutlined as InfoIcon,
  SaveOutlined as SaveIcon,
} from '@mui/icons-material';
import { useQueryClient } from '@tanstack/react-query';
import type {
  GuestPreference,
  GuestPreferenceCategory,
  GuestPreferencesPutRequest,
  GuestProfile,
} from '../../../../types';
import { errorMessage } from '../../../../utils';
import { useTranslation } from '../../../../i18n/useTranslation';
import { formatStatusLabel } from '../../../../utils/formatters';
import { formatHotelDate } from '../../../../utils/date';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { queryKeys } from '../../../../api/queryKeys';
import { getQueryErrorMessage } from '../../../../api/queryConfig';
import {
  useGuestPreferences,
  usePutGuestPreferences,
} from '../../hooks/useGuestRelationsQueries';

/** The seven API-enforced categories, in display order. Labels resolve
 *  through `preferenceCategories.*` at render so they follow locale. */
const PREFERENCE_SECTIONS: GuestPreferenceCategory[] = [
  'room',
  'bed',
  'floor',
  'dietary',
  'communication',
  'occasion',
  'other',
];

const KNOWN_CATEGORIES = new Set<string>(PREFERENCE_SECTIONS);

const MAX_KEY_CHARS = 100;
const MAX_VALUE_CHARS = 2000;

/** One editable key/value row. `rowId` is a UI-only React key — the API
 *  identifies entries by (category, preference_key). */
interface PrefDraftRow {
  rowId: number;
  key: string;
  value: string;
}

const prefsForCategory = (prefs: GuestPreference[] | undefined, category: string) =>
  (prefs ?? []).filter((pref) => pref.category === category);

/** Compare a draft section against the stored rows. Blank/partial rows have
 *  no stored counterpart, so they always count as dirty — that keeps a
 *  half-typed row alive across background refetches. */
const rowsDifferFromBaseline = (
  rows: PrefDraftRow[],
  prefs: GuestPreference[] | undefined,
  category: string,
): boolean => {
  const baseline = prefsForCategory(prefs, category);
  if (rows.length !== baseline.length) return true;
  const keyOf = (key: string, value: string) => `${key.trim()}\u0000${value.trim()}`;
  const remaining = new Map<string, number>();
  for (const pref of baseline) {
    const k = keyOf(pref.preference_key, pref.preference_value);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  for (const row of rows) {
    const k = keyOf(row.key, row.value);
    const left = remaining.get(k) ?? 0;
    if (left === 0) return true;
    remaining.set(k, left - 1);
  }
  return false;
};

interface PreferencesTabProps {
  guestId: number;
  profile: GuestProfile;
  /** `guests:update` — without it the editor is read-only. */
  canEdit: boolean;
}

/**
 * Confirmed-preferences editor: one section per API category with key/value
 * rows, per-section save via `PUT /guests/{id}/preferences` with
 * `replace_categories: [section]` (the backend then deletes keys absent from
 * the submitted entries — that is what makes row removal persist).
 *
 * Below the editor, `guest.special_requests` / `guest.notes` / per-booking
 * special requests render as read-only panels — they are staff notes captured
 * elsewhere, not confirmed preferences, so they are styled apart and carry no
 * edit affordances.
 */
const PreferencesTab: React.FC<PreferencesTabProps> = ({ guestId, profile, canEdit }) => {
  const { t } = useTranslation('guests');
  const { guest, reservations } = profile;
  const queryClient = useQueryClient();
  const prefsQuery = useGuestPreferences(guestId);
  const putPrefs = usePutGuestPreferences();

  const rowIdRef = useRef(0);
  const nextRowId = () => ++rowIdRef.current;

  // Drafts hold only sections the user has touched; clean sections render
  // straight from the query baseline.
  const [drafts, setDrafts] = useState<Record<string, PrefDraftRow[]>>({});
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  // Drop drafts that no longer differ from the fresh baseline (post-save
  // refetch lands here); keep the ones with unsaved edits.
  useEffect(() => {
    const data = prefsQuery.data;
    if (!data) return;
    setDrafts((prev) => {
      const next: typeof prev = {};
      for (const [category, rows] of Object.entries(prev)) {
        if (rowsDifferFromBaseline(rows, data, category)) {
          next[category] = rows;
        }
      }
      return next;
    });
  }, [prefsQuery.data]);

  /** Rows stored under categories outside the current API allowlist (e.g.
   *  legacy imports). Editable writes would fail backend validation, so these
   *  render read-only under their own label. */
  const legacyCategories = useMemo(
    () =>
      Array.from(
        new Set(
          (prefsQuery.data ?? [])
            .map((pref) => pref.category)
            .filter((category) => !KNOWN_CATEGORIES.has(category)),
        ),
      ),
    [prefsQuery.data],
  );

  const baselineRows = (category: string): PrefDraftRow[] =>
    prefsForCategory(prefsQuery.data, category).map((pref) => ({
      rowId: -pref.id,
      key: pref.preference_key,
      value: pref.preference_value,
    }));

  const rowsFor = (category: string): PrefDraftRow[] => drafts[category] ?? baselineRows(category);

  const isDirty = (category: string): boolean =>
    drafts[category] != null &&
    rowsDifferFromBaseline(drafts[category], prefsQuery.data, category);

  const setRows = (category: string, rows: PrefDraftRow[]) => {
    setDrafts((prev) => ({ ...prev, [category]: rows }));
    setSectionErrors((prev) => {
      if (!prev[category]) return prev;
      const next = { ...prev };
      delete next[category];
      return next;
    });
  };

  const handleAddRow = (category: string) => {
    setRows(category, [...rowsFor(category), { rowId: nextRowId(), key: '', value: '' }]);
  };

  const handleRowChange = (
    category: string,
    rowId: number,
    field: 'key' | 'value',
    text: string,
  ) => {
    setRows(
      category,
      rowsFor(category).map((row) => (row.rowId === rowId ? { ...row, [field]: text } : row)),
    );
  };

  const handleRemoveRow = (category: string, rowId: number) => {
    setRows(
      category,
      rowsFor(category).filter((row) => row.rowId !== rowId),
    );
  };

  const handleSaveCategory = async (category: GuestPreferenceCategory) => {
    const rows = rowsFor(category).filter((row) => row.key.trim() || row.value.trim());
    const partial = rows.some((row) => !row.key.trim() || !row.value.trim());
    if (partial) {
      setSectionErrors((prev) => ({
        ...prev,
        [category]: t('preferences.partialError'),
      }));
      return;
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const normalized = row.key.trim().toLowerCase();
      if (seen.has(normalized)) {
        setSectionErrors((prev) => ({
          ...prev,
          [category]: t('preferences.duplicateKey', { key: row.key.trim() }),
        }));
        return;
      }
      seen.add(normalized);
    }

    const payload: GuestPreferencesPutRequest = {
      entries: rows.map((row) => ({
        category,
        preference_key: row.key.trim(),
        preference_value: row.value.trim(),
      })),
      // Replace semantics delete stored keys absent from this list — this is
      // what persists row removals and makes "remove all rows" valid.
      replace_categories: [category],
    };

    setSavingCategory(category);
    setSectionErrors((prev) => {
      const next = { ...prev };
      delete next[category];
      return next;
    });
    try {
      const result = await putPrefs.mutateAsync({ guestId, data: payload });
      // PUT returns the full refreshed list — seed it into the cache so the
      // baseline is correct before the invalidation refetch lands.
      queryClient.setQueryData(queryKeys.guests.preferences(guestId), result);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[category];
        return next;
      });
      emitApiNotification({
        message: t('preferences.saved', { category: t(`preferenceCategories.${category}`) }),
        severity: 'success',
      });
    } catch (err) {
      setSectionErrors((prev) => ({
        ...prev,
        [category]: errorMessage(err, t('preferences.saveFailed')),
      }));
    } finally {
      setSavingCategory(null);
    }
  };

  const bookingRequests = useMemo(
    () =>
      reservations.filter(
        (booking) => booking.special_requests && booking.special_requests.trim(),
      ),
    [reservations],
  );
  const hasUnconfirmedNotes = Boolean(
    guest.special_requests?.trim() || guest.notes?.trim() || bookingRequests.length > 0,
  );

  const renderSection = (category: GuestPreferenceCategory, label: string) => {
    const rows = rowsFor(category);
    const dirty = isDirty(category);
    const saving = savingCategory === category;
    return (
      <Paper key={category} variant="outlined" sx={{ p: 2 }}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {label}
            {dirty && canEdit && (
              <Chip label={t('preferences.unsaved')} size="small" color="warning" sx={{ ml: 1 }} />
            )}
          </Typography>
          {canEdit && (
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleAddRow(category)}
              sx={{ textTransform: 'none' }}
            >
              {t('preferences.addRow')}
            </Button>
          )}
        </Stack>

        {sectionErrors[category] && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {sectionErrors[category]}
          </Alert>
        )}

        {rows.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('preferences.emptySection', { section: label.toLowerCase() })}
          </Typography>
        ) : (
          <Stack spacing={1}>
            {rows.map((row) => (
              <Stack key={row.rowId} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  label={t('preferences.key')}
                  size="small"
                  value={row.key}
                  onChange={(event) =>
                    handleRowChange(category, row.rowId, 'key', event.target.value)
                  }
                  slotProps={{ htmlInput: { maxLength: MAX_KEY_CHARS } }}
                  disabled={!canEdit || saving}
                  sx={{ flex: { sm: 2 } }}
                  placeholder={category === 'room' ? t('preferences.keyPlaceholderRoom') : t('preferences.keyPlaceholder')}
                />
                <TextField
                  label={t('preferences.value')}
                  size="small"
                  value={row.value}
                  onChange={(event) =>
                    handleRowChange(category, row.rowId, 'value', event.target.value)
                  }
                  slotProps={{ htmlInput: { maxLength: MAX_VALUE_CHARS } }}
                  disabled={!canEdit || saving}
                  sx={{ flex: { sm: 3 } }}
                  placeholder={category === 'room' ? t('preferences.valuePlaceholderRoom') : t('preferences.valuePlaceholder')}
                />
                {canEdit && (
                  <Tooltip title={t('preferences.removeRow')}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveRow(category, row.rowId)}
                        disabled={saving}
                        aria-label={t('preferences.removeAria', { section: label })}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Stack>
            ))}
          </Stack>
        )}

        {canEdit && dirty && (
          <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<SaveIcon />}
              onClick={() => void handleSaveCategory(category)}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              {saving ? t('common:state.saving') : t('preferences.saveSection', { section: label.toLowerCase() })}
            </Button>
          </Box>
        )}
      </Paper>
    );
  };

  return (
    <Stack spacing={2.5}>
      {prefsQuery.isPending ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={140} />
          <Skeleton variant="rounded" height={140} />
        </Stack>
      ) : prefsQuery.isError ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void prefsQuery.refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {getQueryErrorMessage(prefsQuery.error, t('preferences.loadFailed')) ??
            t('preferences.loadFailed')}
        </Alert>
      ) : (
        <>
          {PREFERENCE_SECTIONS.map((category) =>
            renderSection(category, t(`preferenceCategories.${category}`)),
          )}

          {legacyCategories.map((category) => (
            <Paper key={category} variant="outlined" sx={{ p: 2, borderStyle: 'dashed' }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
                <LegacyIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  {formatStatusLabel(category)}
                </Typography>
                <Chip
                  label={t('preferences.legacyChip')}
                  size="small"
                  variant="outlined"
                  color="default"
                />
              </Stack>
              <Stack spacing={0.75}>
                {prefsForCategory(prefsQuery.data, category).map((pref) => (
                  <Typography key={pref.id} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                    <Box component="span" sx={{ fontWeight: 700 }}>
                      {pref.preference_key}
                    </Box>
                    {' — '}
                    {pref.preference_value}
                  </Typography>
                ))}
              </Stack>
            </Paper>
          ))}
        </>
      )}

      {/* Unconfirmed notes captured on the guest profile or on individual
          bookings — visually distinct (dashed border, muted fill) and never
          editable here so they cannot be mistaken for confirmed preferences. */}
      {hasUnconfirmedNotes && (
        <Paper
          variant="outlined"
          sx={{ p: 2, borderStyle: 'dashed', bgcolor: 'action.hover' }}
        >
          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mb: 0.5 }}>
            <InfoIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              {t('preferences.unconfirmedTitle')}
            </Typography>
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
            {t('preferences.unconfirmedNote')}
          </Typography>
          <Stack spacing={1.5}>
            {guest.special_requests?.trim() && (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                  {t('preferences.specialRequestsProfile')}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {guest.special_requests}
                </Typography>
              </Box>
            )}
            {guest.notes?.trim() && (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                  {t('preferences.guestNotesProfile')}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {guest.notes}
                </Typography>
              </Box>
            )}
            {bookingRequests.map((booking) => (
              <Box key={booking.id}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                  {t('preferences.bookingRef', { number: booking.booking_number || `#${booking.id}` })} ·{' '}
                  {formatHotelDate(booking.check_in_date)} – {formatHotelDate(booking.check_out_date)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {booking.special_requests}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
};

export default PreferencesTab;
