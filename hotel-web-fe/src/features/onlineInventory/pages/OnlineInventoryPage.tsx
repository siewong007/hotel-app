import { useMemo, useState } from 'react';
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

import { formatLocalDate } from '../../../utils/date';
import { useCurrency } from '../../../hooks/useCurrency';
import { useConfirm } from '../../../components/common/ConfirmProvider';
import { GRID_DAYS } from '../constants';
import type { CellKey, GridCellView } from '../types';
import { dateRange, summarizeEdits } from '../utils';
import { useOnlineInventory } from '../hooks/useOnlineInventory';
import { useGridSelection } from '../hooks/useGridSelection';
import { BulkEditPanel } from '../components/BulkEditPanel';
import { CellEditorPopover } from '../components/CellEditorPopover';
import { GridToolbar } from '../components/GridToolbar';
import { InventoryGrid } from '../components/InventoryGrid';
import { InventorySummary } from '../components/InventorySummary';
import { ReviewChangesDialog } from '../components/ReviewChangesDialog';

const OnlineInventoryPage = () => {
  const today = formatLocalDate();
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
      title: 'Discard unsaved changes',
      message,
      confirmText: 'Discard changes',
      severity: 'warning',
    });

  const changeStart = async (next: string) => {
    if (!next || next === start) return;
    if (
      inv.changedCount > 0 &&
      !(await confirmDiscard('Move the window and discard your unsaved inventory changes?'))
    ) {
      return;
    }
    sel.clear();
    setStart(next);
  };

  const refreshInventory = async () => {
    if (
      inv.changedCount > 0 &&
      !(await confirmDiscard('Refresh availability and discard your unsaved inventory changes?'))
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
              Inventory settings
            </Typography>
          </Stack>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 850, letterSpacing: -0.7 }}>
            Online availability
          </Typography>
          <Typography sx={{ color: 'text.secondary', mt: 0.75, maxWidth: 720 }}>
            Control {GRID_DAYS} days of online inventory at once — click cells to select, open the
            editor to stage changes, then review and apply everything in one safe save.
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
        />

        {inv.error && <Alert severity="error">{inv.error}</Alert>}

        {inv.isLoading ? (
          <Paper
            variant="outlined"
            sx={{ display: 'grid', placeItems: 'center', minHeight: 280, borderRadius: 3 }}
          >
            <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
              <CircularProgress size={32} />
              <Typography sx={{ color: 'text.secondary' }}>Loading room availability…</Typography>
            </Stack>
          </Paper>
        ) : inv.roomTypes.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 3 }}>
            <CloudDoneOutlinedIcon sx={{ fontSize: 44, color: 'text.secondary', mb: 1 }} />
            <Typography variant="h6" sx={{ fontWeight: 750 }}>
              No room types to configure
            </Typography>
            <Typography sx={{ color: 'text.secondary' }}>
              Add a room type before setting its online availability.
            </Typography>
          </Paper>
        ) : (
          <>
            <InventorySummary
              cells={summaryCells}
              label={selectedViews.length > 0 ? 'Selected cells' : 'Visible window'}
            />
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
            <BulkEditPanel
              targets={selectedViews}
              onApply={inv.stageMany}
              onClear={sel.clear}
            />
          </>
        )}
      </Stack>

      <CellEditorPopover
        view={editorKey !== null ? inv.cells.get(editorKey) ?? null : null}
        anchorEl={editorAnchor}
        onClose={closeEditor}
        onApply={inv.stageCell}
        formatPrice={formatPrice}
      />

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
            bottom: 16,
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
              {inv.changedCount} {inv.changedCount === 1 ? 'cell' : 'cells'} changed
            </Typography>
            <Button onClick={inv.discardChanges} disabled={inv.isSaving} color="inherit">
              Discard
            </Button>
            <Button
              variant="contained"
              onClick={() => setReviewOpen(true)}
              disabled={inv.isSaving}
            >
              Review &amp; apply
            </Button>
          </Stack>
        </Paper>
      )}

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
