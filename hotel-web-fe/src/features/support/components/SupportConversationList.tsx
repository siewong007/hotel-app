import {
  Box,
  Divider,
  List,
  ListItemButton,
  Stack,
  TablePagination,
  Typography,
} from '@mui/material';
import { LogoLoader } from '../../../components';
import type { SupportConversationSummary } from '../types';
import { useTranslation } from '../../../i18n/useTranslation';
import {
  formatSupportDate,
  supportCategoryLabel,
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
  const { t, tOr } = useTranslation('support');
  return (
    <Stack
      sx={{
        height: "100%",
        minHeight: 0
      }}>
      <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1
          }}>
          <Typography variant="subtitle2">{t('list.title')}</Typography>
          <Typography variant="caption" sx={{
            color: "text.secondary"
          }}>
            {isFetching && !isLoading ? t('list.refreshing') : t('list.total', { count: total })}
          </Typography>
        </Stack>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto"
        }}>
        {isLoading ? (
          <LogoLoader variant="page" minHeight={240} label={t('list.loading')} />
        ) : conversations.length === 0 ? (
          <Stack
            spacing={0.5}
            sx={{
              alignItems: "center",
              justifyContent: "center",
              minHeight: 240,
              px: 3,
              textAlign: 'center'
            }}>
            <Typography variant="subtitle2">{t('list.empty')}</Typography>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              {t('list.emptyHint')}
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
                  <Stack
                    spacing={0.8}
                    sx={{
                      width: "100%",
                      minWidth: 0
                    }}>
                    <Stack
                      direction="row"
                      sx={{
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 1
                      }}>
                      <Box sx={{
                        minWidth: 0
                      }}>
                        <Typography variant="body2" noWrap sx={{
                          fontWeight: 700
                        }}>
                          {conversation.guest_name || t('list.guestFallback')}
                        </Typography>
                        <Typography variant="caption" noWrap sx={{
                          color: "text.secondary"
                        }}>
                          {/* intentional: dynamic key — tOr resolves categories.<category>; out-of-enum values humanize */}
                          {conversation.conversation_number} · {supportCategoryLabel(tOr, conversation.category)}
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                          whiteSpace: "nowrap"
                        }}>
                        {formatSupportDate(conversation.last_activity_at)}
                      </Typography>
                    </Stack>

                    <Typography variant="body2" noWrap sx={{
                      color: "text.secondary"
                    }}>
                      {conversation.last_message_preview || t('list.noMessage')}
                    </Typography>

                    <Stack
                      direction="row"
                      useFlexGap
                      sx={{
                        gap: 0.75,
                        flexWrap: "wrap",
                        alignItems: "center"
                      }}>
                      <SupportStatusChip status={conversation.status} />
                      <SupportPriorityChip priority={conversation.priority} />
                      <SupportSlaChip
                        isAtRisk={conversation.is_sla_at_risk}
                        isBreached={conversation.is_sla_breached}
                        dueAt={conversation.first_response_due_at ?? conversation.resolution_due_at}
                      />
                      {conversation.unread_count > 0 ? (
                        <Typography
                          variant="caption"
                          sx={{
                            fontWeight: 700,
                            color: "primary.main"
                          }}>
                          {t('list.unread', { count: conversation.unread_count })}
                        </Typography>
                      ) : null}
                    </Stack>

                    <Typography variant="caption" noWrap sx={{
                      color: "text.secondary"
                    }}>
                      {conversation.assigned_to_name ? t('list.assignedTo', { name: conversation.assigned_to_name }) : t('list.unassigned')}
                      {conversation.room_number ? ` · ${t('list.room', { number: conversation.room_number })}` : ''}
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
        labelRowsPerPage={t('list.perPage')}
      />
    </Stack>
  );
}

