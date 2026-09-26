import { useEffect, useMemo, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import {
  Alert,
  Box,
  Button,
  Container,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';

import { useAuth } from '../../../auth/AuthContext';
import { useTranslation } from '../../../i18n/useTranslation';
import { formatLocalDate } from '../../../utils/date';
import { useCurrency } from '../../../hooks/useCurrency';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { LogoLoader } from '../../../components';
import { BottomSheet } from '../../../components/common/BottomSheet';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { StickyActionBar } from '../../../components/common/StickyActionBar';
import { mobileActionBarProps } from '../../../components/common/mobileActionBar';
import { GRID_DAYS, START_MAX_OFFSET_DAYS, START_MIN_OFFSET_DAYS } from '../constants';
import type { CellKey, GridCellView } from '../types';
import { cellKey, dateRange, shiftDate, summarizeEdits } from '../utils';
import { FULL_DATE } from '../constants';
import { useOnlineInventory } from '../hooks/useOnlineInventory';
import { useGridSelection } from '../hooks/useGridSelection';
import { BulkEditFields, BulkEditPanel } from '../components/BulkEditPanel';
import { CellEditorPopover } from '../components/CellEditorPopover';
import { CellEditorSheet } from '../components/CellEditorSheet';
import { GridToolbar } from '../components/GridToolbar';
import { InventoryGrid } from '../components/InventoryGrid';
import { InventorySummary } from '../components/InventorySummary';
import { PhoneInventoryView } from '../components/PhoneInventoryView';
import { ReviewChangesDialog } from '../components/ReviewChangesDialog';

/** Writes need this; viewing stays on the route's `rooms:update`. */
export const ONLINE_INVENTORY_MANAGE = 'online_inventory:manage';

/** How many conflicting days the conflict banner names before "+N more". */
const CONFLICT_LIST_LIMIT = 6;

const OnlineInventoryPage = () => {
  const { t } = useTranslation('onlineInventory');
  const today = formatLocalDate();
  const isPhone = useIsPhone();
  const confirm = useConfirm();
  const { format } = useCurrency();
  const formatPrice = (value: string) => format(Number(value));
  const { hasPermission } = useAuth();
  const canEdit = hasPermission(ONLINE_INVENTORY_MANAGE);
  const minStart = shiftDate(today, START_MIN_OFFSET_DAYS);
  const maxStart = shiftDate(today, START_MAX_OFFSET_DAYS);

  const [start, setStart] = useState(today);
  const dates = useMemo(() => dateRange(start, GRID_DAYS), [start]);
  const inv = useOnlineInventory(start, dates[GRID_DAYS - 1]);

  const [overridesOnly, setOverridesOnly] = useState(false);
  const visibleDates = useMemo(() => {
    if (!overridesOnly) return dates;
    const flagged = dates.filter((date) =>
      inv.roomTypes.some((room) => {
        const view = inv.cells.get(`${room.room_type_id}:${date}`);
        return view !== undefined && (view.is_override || view.changed);
      }),
    );
    // Never collapse to zero columns — an empty filter shows everything.
    return flagged.length > 0 ? flagged : dates;
  }, [overridesOnly, dates, inv.roomTypes, inv.cells]);

  const roomTypeIds = useMemo(
    () => inv.roomTypes.map((room) => room.room_type_id),
    [inv.roomTypes],
  );
  const sel = useGridSelection(roomTypeIds, visibleDates);

  const [editorKey, setEditorKey] = useState<CellKey | null>(null);
  const [editorAnchor, setEditorAnchor] = useState<HTMLElement | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Phone-only: tap-to-select mode and its bulk-edit sheet.
  const [selectMode, setSelectMode] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const selectedViews = useMemo<GridCellView[]>(
    () =>
      [...sel.selected]
        .map((key) => inv.cells.get(key))
        .filter((view): view is GridCellView => view !== undefined),
    [sel.selected, inv.cells],
  );

  const summaryCells = useMemo(() => {
    const scope = selectedViews.length > 0 ? selectedViews : [...inv.cells.values()];
    return scope.map((view) => ({
      physical: view.physical,
      held: view.current.walk_in_reserved_rooms,
      online: view.online_available,
    }));
  }, [selectedViews, inv.cells]);

  // Cheap enough to compute in render (≤500 staged edits).
  const reviewGroups = summarizeEdits(inv.edits, inv.savedCells, formatPrice);

  const confirmDiscard = (message: string) =>
    confirm({
      title: t('confirm.discardTitle'),
      message,
      confirmText: t('confirm.discardConfirm'),
      severity: 'warning',
    });

  const changeStart = async (requested: string) => {
    if (!requested) return;
    // A jump past either edge lands on the edge instead.
    const next =
      requested < minStart ? minStart : requested > maxStart ? maxStart : requested;
    if (next === start) return;
    if (
      inv.changedCount > 0 &&
      !(await confirmDiscard(t('confirm.discardMove')))
    ) {
      return;
    }
    sel.clear();
    setBulkOpen(false);
    setStart(next);
  };

  const refreshInventory = async () => {
    if (
      inv.changedCount > 0 &&
      !(await confirmDiscard(t('confirm.discardRefresh')))
    ) {
      return;
    }
    void inv.reload();
  };

  // Leaving the page (in-app navigation) with staged edits asks first, in the
  // same dialog the date/Refresh prompts use; closing or reloading the tab
  // falls back to the browser's own "leave site?" prompt.
  const dirty = inv.changedCount > 0;
  useBlocker({
    shouldBlockFn: async () => !(await confirmDiscard(t('confirm.discardLeave'))),
    disabled: !dirty,
    enableBeforeUnload: false,
  });
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const openEditor = (key: CellKey, anchor: HTMLElement) => {
    if (!canEdit) return;
    setEditorKey(key);
    setEditorAnchor(anchor);
  };

  const closeEditor = () => {
    setEditorKey(null);
    setEditorAnchor(null);
  };

  // Phone select mode: taps toggle membership instead of opening the editor.
  const toggleSelect = (key: CellKey) => {
    const next = new Set(sel.selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    sel.setSelected(next);
  };

  const toggleSelectMode = () => {
    sel.clear();
    setBulkOpen(false);
    setSelectMode((current) => !current);
  };

  const openCellSheet = (key: CellKey) => {
    if (canEdit) setEditorKey(key);
  };

  // Resizing across the phone breakpoint swaps the editor host (popover ↔
  // sheet) — a stale anchor would point at an unmounted grid cell.
  useEffect(() => {
    setEditorKey(null);
    setEditorAnchor(null);
    setBulkOpen(false);
  }, [isPhone]);

  const confirmSave = async () => {
    if (await inv.saveChanges()) setReviewOpen(false);
  };

  // A conflict closes the review so the banner (and its Reload) is visible;
  // other failures stay in the dialog next to the Apply button.
  useEffect(() => {
    if (inv.conflicts !== null) setReviewOpen(false);
  }, [inv.conflicts]);

  const conflictLabels = (inv.conflicts ?? []).map((conflict) => {
    const name =
      inv.savedCells.get(cellKey(conflict.room_type_id, conflict.stay_date))?.room_type_name ??
      t('lines.roomTypeFallback', { id: conflict.room_type_id });
    return `${name} · ${FULL_DATE.format(new Date(`${conflict.stay_date}T12:00:00`))}`;
  });

  return (
    <Container
      maxWidth="xl"
      // The app shell's <main> already pads 16px on phones; a second gutter
      // here squeezed the day strips and toolbar to ~296px on a 360px screen.
      sx={{ py: { xs: 2, md: 3.5 }, pb: { xs: 17, md: 6 }, px: { xs: 0, sm: 3 } }}
    >
      <Stack spacing={2.5}>
        <Box>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', color: 'primary.main', mb: 0.75 }}
          >
            <SettingsSuggestOutlinedIcon fontSize="small" />
            <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1.2 }}>
              {t('kicker')}
            </Typography>
          </Stack>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 850, letterSpacing: -0.7 }}>
            {t('title')}
          </Typography>
          <Typography
            sx={{
              color: 'text.secondary',
              mt: 0.75,
              maxWidth: 720,
              display: { xs: 'none', sm: 'block' },
            }}
          >
            {t('subtitle', { days: GRID_DAYS })}
          </Typography>
        </Box>

        <GridToolbar
          start={start}
          onStartChange={(next) => void changeStart(next)}
          onRefresh={() => void refreshInventory()}
          refreshing={inv.isLoading}
          overridesOnly={overridesOnly}
          onToggleOverrides={() => {
            setOverridesOnly((current) => !current);
            sel.clear();
          }}
          selectedCount={sel.selected.size}
          selectMode={canEdit ? selectMode : undefined}
          onToggleSelectMode={canEdit ? toggleSelectMode : undefined}
          minStart={minStart}
          maxStart={maxStart}
        />

        {!canEdit && (
          <Alert
            severity="info"
            variant="outlined"
            icon={<VisibilityOutlinedIcon fontSize="inherit" />}
            sx={{ py: 0.25 }}
          >
            {t('readOnly.note')}
          </Alert>
        )}

        {inv.conflicts !== null && (
          <Alert
            severity="warning"
            role="alert"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => void inv.reloadAfterConflict()}
                sx={{ fontWeight: 700 }}
              >
                {t('conflict.reload')}
              </Button>
            }
          >
            <Typography sx={{ fontWeight: 700 }}>{t('conflict.title')}</Typography>
            <Typography variant="body2">{t('conflict.message')}</Typography>
            {conflictLabels.length > 0 && (
              <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {conflictLabels.slice(0, CONFLICT_LIST_LIMIT).map((label) => (
                  <Typography component="li" variant="body2" key={label}>
                    {label}
                  </Typography>
                ))}
                {conflictLabels.length > CONFLICT_LIST_LIMIT && (
                  <Typography component="li" variant="body2">
                    {t('conflict.more', { count: conflictLabels.length - CONFLICT_LIST_LIMIT })}
                  </Typography>
                )}
              </Box>
            )}
          </Alert>
        )}

        {inv.error && <Alert severity="error">{inv.error}</Alert>}

        {inv.isLoading ? (
          <Paper
            variant="outlined"
            sx={{ display: 'grid', placeItems: 'center', minHeight: 280, borderRadius: 3 }}
          >
            <LogoLoader variant="inline" size={32} label={t('loading')} />
          </Paper>
        ) : inv.loadError !== null ? (
          <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }} role="alert">
            <ErrorOutlineIcon sx={{ fontSize: 44, color: 'error.main', mb: 1 }} />
            <Typography variant="h6" component="h2" sx={{ fontWeight: 750 }}>
              {t('errors.loadTitle')}
            </Typography>
            <Typography sx={{ color: 'text.secondary', mb: 2 }}>{inv.loadError}</Typography>
            <Button variant="outlined" onClick={() => void inv.reload()}>
              {t('errors.retry')}
            </Button>
          </Paper>
        ) : inv.roomTypes.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
            <CloudDoneOutlinedIcon sx={{ fontSize: 44, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6" component="h2" sx={{ fontWeight: 750 }}>
              {t('empty.title')}
            </Typography>
            <Typography sx={{ color: 'text.secondary' }}>
              {t('empty.body')}
            </Typography>
          </Paper>
        ) : (
          <>
            <InventorySummary
              cells={summaryCells}
              label={selectedViews.length > 0 ? t('summary.selectedCells') : t('summary.visibleWindow')}
            />
            {isPhone ? (
              <PhoneInventoryView
                roomTypes={inv.roomTypes}
                dates={visibleDates}
                cells={inv.cells}
                today={today}
                selected={sel.selected}
                selectMode={selectMode}
                onToggleSelect={toggleSelect}
                onOpenCell={openCellSheet}
                formatPrice={formatPrice}
                readOnly={!canEdit}
              />
            ) : (
              <>
                <InventoryGrid
                  roomTypes={inv.roomTypes}
                  dates={visibleDates}
                  cells={inv.cells}
                  selected={sel.selected}
                  focused={sel.focused}
                  today={today}
                  onSelectCell={sel.selectCell}
                  onMoveFocus={sel.moveFocus}
                  onSelectRange={sel.selectRange}
                  onSelectRow={sel.selectRow}
                  onSelectColumn={sel.selectColumn}
                  onSelectAll={() => sel.setSelected(inv.cells.keys())}
                  onOpenEditor={openEditor}
                  onClearSelection={sel.clear}
                  formatPrice={formatPrice}
                />
                {canEdit && sel.selected.size > 0 && (
                  <BulkEditPanel
                    targets={selectedViews}
                    onApply={inv.stageMany}
                    onClear={sel.clear}
                  />
                )}
              </>
            )}
          </>
        )}
      </Stack>

      {canEdit && !isPhone && (
        <CellEditorPopover
          view={editorKey !== null ? inv.cells.get(editorKey) ?? null : null}
          anchorEl={editorAnchor}
          onClose={closeEditor}
          onApply={inv.stageCell}
          formatPrice={formatPrice}
        />
      )}

      {canEdit && isPhone && (
        <CellEditorSheet
          view={editorKey !== null ? inv.cells.get(editorKey) ?? null : null}
          onClose={closeEditor}
          onApply={inv.stageCell}
        />
      )}

      <ReviewChangesDialog
        open={reviewOpen}
        groups={reviewGroups}
        totalCount={inv.changedCount}
        isSaving={inv.isSaving}
        error={inv.error}
        onClose={() => setReviewOpen(false)}
        onConfirm={() => void confirmSave()}
      />

      {canEdit && inv.changedCount > 0 && (
        // Pinned to the viewport: the app shell keeps `contain: layout` and
        // lingering transforms off <main> and the route wrapper, so plain
        // `position: fixed` works here without a portal.
        <Paper
          {...mobileActionBarProps}
          elevation={8}
          sx={{
            position: 'fixed',
            zIndex: (theme) => theme.zIndex.appBar - 1,
            left: { xs: 12, md: '50%' },
            right: { xs: 12, md: 'auto' },
            // Below sm the 60px bottom nav (+ --sab home indicator) covers a
            // bar pinned at bottom:16 — lift it clear; while phone select
            // mode's StickyActionBar (~64px) is up, stack above it instead.
            bottom: {
              xs: `calc(${selectMode ? 136 : 76}px + var(--sab))`,
              sm: 'calc(16px + var(--sab))',
              md: 16,
            },
            transform: { md: 'translateX(-50%)' },
            width: { md: 'min(680px, calc(100vw - 48px))' },
            p: 1.25,
            pl: 2,
            borderRadius: 3,
            border: 1,
            borderColor: 'divider',
          }}
          role="region"
          aria-label={t('changedBarAria')}
          aria-live="polite"
        >
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
          >
            <Typography sx={{ fontWeight: 750, flex: '1 1 auto', minWidth: 0 }}>
              {t('changedBar', { count: inv.changedCount })}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ ml: 'auto', flexShrink: 0 }}>
              <Button
                onClick={inv.discardChanges}
                disabled={inv.isSaving}
                color="inherit"
                sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
              >
                {t('discard')}
              </Button>
              <Button
                variant="contained"
                onClick={() => setReviewOpen(true)}
                disabled={inv.isSaving}
                sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
              >
                {t('reviewApply')}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {canEdit && isPhone && selectMode && (
        <StickyActionBar
          summary={<span aria-live="polite">{t('bulk.selectedCount', { count: sel.selected.size })}</span>}
          secondary={
            <Button onClick={toggleSelectMode} sx={{ minHeight: 44 }}>
              {t('common:actions.done')}
            </Button>
          }
          primary={
            <Button
              variant="contained"
              disabled={sel.selected.size === 0}
              onClick={() => setBulkOpen(true)}
              sx={{ minHeight: 44 }}
            >
              {t('bulk.editSelected')}
            </Button>
          }
        />
      )}

      <BottomSheet
        open={canEdit && bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t('bulk.editSelectedCells')}
      >
        {selectedViews.length > 0 && (
          <Stack spacing={1.5}>
            <BulkEditFields targets={selectedViews} onApply={inv.stageMany} />
          </Stack>
        )}
      </BottomSheet>

      <Snackbar
        open={Boolean(inv.successMessage)}
        autoHideDuration={4000}
        onClose={inv.clearSuccessMessage}
        message={inv.successMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Container>
  );
};

export default OnlineInventoryPage;
