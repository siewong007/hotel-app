import {
  Box,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  Stack,
  TablePagination,
  Typography,
} from '@mui/material';
import type { SupportConversationSummary } from '../types';
import {
  formatSupportDate,
  humanizeSupportValue,
  SupportPriorityChip,
  SupportSlaChip,
  SupportStatusChip,
} from './SupportStatusChip';

interface SupportConversationListProps {
  conversations: SupportConversationSummary[];
  selectedConversationId?: number;
  isLoading: boolean;
  isFetching: boolean;
  total: number;
  page: number;
  pageSize: number;
  onSelect: (conversationId: number) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function SupportConversationList({
  conversations,
  selectedConversationId,
  isLoading,
  isFetching,
  total,
  page,
  pageSize,
  onSelect,
  onPageChange,
  onPageSizeChange,
}: SupportConversationListProps) {
  return (
    <Stack height="100%" minHeight={0}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
          <Typography variant="subtitle2">Conversations</Typography>
          <Typography variant="caption" color="text.secondary">
            {isFetching && !isLoading ? 'Refreshing…' : `${total} total`}
          </Typography>
        </Stack>
      </Box>

      <Box flex={1} minHeight={0} overflow="auto">
        {isLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }} spacing={1}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Loading conversations…</Typography>
          </Stack>
        ) : conversations.length === 0 ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240, px: 3, textAlign: 'center' }} spacing={0.5}>
            <Typography variant="subtitle2">No conversations found</Typography>
            <Typography variant="body2" color="text.secondary">
              Adjust the filters or check another queue.
            </Typography>
          </Stack>
        ) : (
          <List disablePadding>
            {conversations.map((conversation, index) => (
              <Box key={conversation.id}>
                {index > 0 ? <Divider component="li" /> : null}
                <ListItemButton
                  selected={conversation.id === selectedConversationId}
                  onClick={() => onSelect(conversation.id)}
                  alignItems="flex-start"
                  sx={{ px: 2, py: 1.5 }}
                >
                  <Stack spacing={0.8} width="100%" minWidth={0}>
                    <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
                      <Box minWidth={0}>
                        <Typography variant="body2" fontWeight={700} noWrap>
                          {conversation.guest_name || 'Guest'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {conversation.conversation_number} · {humanizeSupportValue(conversation.category)}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary" whiteSpace="nowrap">
                        {formatSupportDate(conversation.last_activity_at)}
                      </Typography>
                    </Stack>

                    <Typography variant="body2" color="text.secondary" noWrap>
                      {conversation.last_message_preview || 'No guest-visible message yet'}
                    </Typography>

                    <Stack direction="row" gap={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                      <SupportStatusChip status={conversation.status} />
                      <SupportPriorityChip priority={conversation.priority} />
                      <SupportSlaChip
                        isAtRisk={conversation.is_sla_at_risk}
                        isBreached={conversation.is_sla_breached}
                        dueAt={conversation.first_response_due_at ?? conversation.resolution_due_at}
                      />
                      {conversation.unread_count > 0 ? (
                        <Typography variant="caption" fontWeight={700} color="primary.main">
                          {conversation.unread_count} unread
                        </Typography>
                      ) : null}
                    </Stack>

                    <Typography variant="caption" color="text.secondary" noWrap>
                      {conversation.assigned_to_name ? `Assigned to ${conversation.assigned_to_name}` : 'Unassigned'}
                      {conversation.room_number ? ` · Room ${conversation.room_number}` : ''}
                    </Typography>
                  </Stack>
                </ListItemButton>
              </Box>
            ))}
          </List>
        )}
      </Box>

      <TablePagination
        component="div"
        count={total}
        page={Math.max(0, page - 1)}
        onPageChange={(_, nextPage) => onPageChange(nextPage + 1)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(event) => onPageSizeChange(Number(event.target.value))}
        rowsPerPageOptions={[10, 20, 50]}
        labelRowsPerPage="Per page"
      />
    </Stack>
  );
}

