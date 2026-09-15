import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Snackbar,
  Stack,
  Typography,
} from '@mui/material';
import CloudDoneOutlinedIcon from '@mui/icons-material/CloudDoneOutlined';
import SettingsSuggestOutlinedIcon from '@mui/icons-material/SettingsSuggestOutlined';

import { useTranslation } from '../../../i18n/useTranslation';
import { formatLocalDate } from '../../../utils/date';
import { useCurrency } from '../../../hooks/useCurrency';
import { useIsPhone } from '../../../hooks/useIsPhone';
import { BottomSheet } from '../../../components/common/BottomSheet';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { StickyActionBar } from '../../../components/common/StickyActionBar';
import { GRID_DAYS } from '../constants';
import type { CellKey, GridCellView } from '../types';
import { dateRange, summarizeEdits } from '../utils';
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

const OnlineInventoryPage = () => {
  const { t } = useTranslation('onlineInventory');
  const today = formatLocalDate();
  const isPhone = useIsPhone();
  const confirm = useConfirm();
  const { format } = useCurrency();
  const formatPrice = (value: string) => format(Number(value));

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

  const changeStart = async (next: string) => {
    if (!next || next === start) return;
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

  const openEditor = (key: CellKey, anchor: HTMLElement) => {
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

  const openCellSheet = (key: CellKey) => setEditorKey(key);

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

  return (
    <Container maxWidth="xl" sx={{ py: { xs: 2, md: 3.5 }, pb: { xs: 14, md: 6 } }}>
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
          selectMode={selectMode}
          onToggleSelectMode={toggleSelectMode}
        />

        {inv.error && <Alert severity="error">{inv.error}</Alert>}

        {inv.isLoading ? (
          <Paper
            variant="outlined"
            sx={{ display: 'grid', placeItems: 'center', minHeight: 280, borderRadius: 3 }}
          >
            <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircularProgress size={32} />
              <Typography sx={{ color: 'text.secondary' }}>{t('loading')}</Typography>
            </Stack>
          </Paper>
        ) : inv.roomTypes.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
            <CloudDoneOutlinedIcon sx={{ fontSize: 44, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 750 }}>
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
                {sel.selected.size > 0 && (
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

      {!isPhone && (
        <CellEditorPopover
          view={editorKey !== null ? inv.cells.get(editorKey) ?? null : null}
          anchorEl={editorAnchor}
          onClose={closeEditor}
          onApply={inv.stageCell}
          formatPrice={formatPrice}
        />
      )}

      {isPhone && (
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
        onClose={() => setReviewOpen(false)}
        onConfirm={() => void confirmSave()}
      />

      {inv.changedCount > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            zIndex: (theme) => theme.zIndex.appBar - 1,
            left: { xs: 12, md: '50%' },
            right: { xs: 12, md: 'auto' },
            // Below md the 60px bottom nav (+ --sab home indicator) covers a
            // bar pinned at bottom:16 — lift it clear; while phone select
            // mode's StickyActionBar (~64px) is up, stack above it instead.
            bottom: {
              xs: `calc(${selectMode ? 136 : 76}px + var(--sab))`,
              sm: 'calc(76px + var(--sab))',
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
          aria-live="polite"
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontWeight: 750, flex: 1 }}>
              {t('changedBar', { count: inv.changedCount })}
            </Typography>
            <Button onClick={inv.discardChanges} disabled={inv.isSaving} color="inherit">
              {t('discard')}
            </Button>
            <Button
              variant="contained"
              onClick={() => setReviewOpen(true)}
              disabled={inv.isSaving}
            >
              {t('reviewApply')}
            </Button>
          </Stack>
        </Paper>
      )}

      {isPhone && selectMode && (
        <StickyActionBar
          summary={<span aria-live="polite">{t('bulk.cellsSelected', { count: sel.selected.size })}</span>}
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
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={t('bulk.editSelectedTitle')}
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
