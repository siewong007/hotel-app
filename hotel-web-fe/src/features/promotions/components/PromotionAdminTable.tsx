import ArchiveIcon from '@mui/icons-material/Archive';
import EditIcon from '@mui/icons-material/Edit';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { PROMOTION_STATUS_LABELS } from '../constants';
import type { Promotion, PromotionLifecycleAction } from '../types';
import { formatPromotionDiscount } from '../utils';

interface PromotionAdminTableProps {
  promotions: Promotion[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  canManage: boolean;
  isTransitioning: boolean;
  onEdit: (promotion: Promotion) => void;
  onTransition: (promotion: Promotion, action: PromotionLifecycleAction) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const statusColor = {
  draft: 'default',
  published: 'success',
  paused: 'warning',
  archived: 'default',
} as const;

export function PromotionAdminTable({
  promotions,
  total,
  page,
  pageSize,
  isLoading,
  canManage,
  isTransitioning,
  onEdit,
  onTransition,
  onPageChange,
  onPageSizeChange,
}: PromotionAdminTableProps) {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Promotion</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Discount</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Claims</TableCell>
              <TableCell>Public</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {promotions.map((promotion) => (
              <TableRow key={promotion.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={600}>
                    {promotion.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {promotion.slug}
                  </Typography>
                </TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>
                  {promotion.promotion_kind}
                </TableCell>
                <TableCell>{formatPromotionDiscount(promotion)}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={PROMOTION_STATUS_LABELS[promotion.status] ?? promotion.status}
                    color={statusColor[promotion.status] ?? 'default'}
                  />
                </TableCell>
                <TableCell>
                  {promotion.claimed_count}
                  {promotion.claim_limit ? ` / ${promotion.claim_limit}` : ''}
                </TableCell>
                <TableCell>{promotion.is_public ? 'Yes' : 'No'}</TableCell>
                <TableCell align="right">
                  {canManage ? (
                    <Stack direction="row" justifyContent="flex-end" spacing={0.25}>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => onEdit(promotion)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {promotion.status === 'draft' || promotion.status === 'paused' ? (
                        <Tooltip title="Publish">
                          <IconButton
                            size="small"
                            color="success"
                            disabled={isTransitioning}
                            onClick={() => onTransition(promotion, 'publish')}
                          >
                            <PlayCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {promotion.status === 'published' ? (
                        <Tooltip title="Pause">
                          <IconButton
                            size="small"
                            color="warning"
                            disabled={isTransitioning}
                            onClick={() => onTransition(promotion, 'pause')}
                          >
                            <PauseCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {promotion.status !== 'archived' ? (
                        <Tooltip title="Archive">
                          <IconButton
                            size="small"
                            disabled={isTransitioning}
                            onClick={() => onTransition(promotion, 'archive')}
                          >
                            <ArchiveIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Read only
                    </Typography>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {promotions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                  No promotions found.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={[10, 25, 50]}
        onPageChange={(_, nextPage) => onPageChange(nextPage)}
        onRowsPerPageChange={(event) => onPageSizeChange(Number(event.target.value))}
      />
    </>
  );
}
