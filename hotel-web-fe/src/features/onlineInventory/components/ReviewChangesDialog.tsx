import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';

import type { EditSummaryGroup } from '../utils';

interface ReviewChangesDialogProps {
  open: boolean;
  groups: EditSummaryGroup[];
  totalCount: number;
  isSaving: boolean;
  onClose(): void;
  onConfirm(): void;
}

const runLabel = (from: string, to: string): string =>
  from === to ? from : `${from} – ${to}`;

/**
 * Review-before-commit dialog — every staged change spelled out per room type
 * before the single atomic save goes out.
 */
export const ReviewChangesDialog = ({
  open,
  groups,
  totalCount,
  isSaving,
  onClose,
  onConfirm,
}: ReviewChangesDialogProps) => (
  <Dialog open={open} onClose={isSaving ? undefined : onClose} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ fontWeight: 800 }}>Review changes</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2.5}>
        {groups.map((group) => (
          <Box key={group.roomTypeId}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 0.5 }}>
              <Typography sx={{ fontWeight: 800 }}>{group.name}</Typography>
              {group.code && (
                <Chip size="small" label={group.code} variant="outlined" sx={{ fontWeight: 700 }} />
              )}
            </Stack>
            <Stack spacing={0.5} component="ul" sx={{ m: 0, pl: 2.5 }}>
              {group.runs.map((run) => (
                <Typography
                  component="li"
                  variant="body2"
                  key={`${run.from}:${run.to}`}
                  sx={{ color: 'text.secondary' }}
                >
                  <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    {runLabel(run.from, run.to)}
                  </Box>
                  {`: ${run.lines.join(' · ')}`}
                </Typography>
              ))}
            </Stack>
          </Box>
        ))}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          All {totalCount} {totalCount === 1 ? 'change' : 'changes'} are applied together — if any
          cell fails, nothing is saved.
        </Typography>
      </Stack>
    </DialogContent>
    <DialogActions sx={{ px: 3, py: 2 }}>
      <Button onClick={onClose} disabled={isSaving}>
        Cancel
      </Button>
      <Button
        variant="contained"
        onClick={onConfirm}
        disabled={isSaving || totalCount === 0}
        startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : undefined}
        aria-label={
          isSaving
            ? 'Saving'
            : `Apply ${totalCount} ${totalCount === 1 ? 'change' : 'changes'}`
        }
      >
        {isSaving ? 'Saving…' : `Apply ${totalCount} ${totalCount === 1 ? 'change' : 'changes'}`}
      </Button>
    </DialogActions>
  </Dialog>
);
