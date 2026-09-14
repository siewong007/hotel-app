import React from 'react';
import {
  Box,
  CircularProgress,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddCircleOutlineOutlined as NewBookingIcon,
  AutoAwesome as ConvertIcon,
  BlockOutlined as BlacklistIcon,
  CardGiftcardOutlined as CreditsIcon,
  DeleteOutlined as DeleteIcon,
  EditOutlined as EditIcon,
  HistoryOutlined as StayHistoryIcon,
  ManageAccountsOutlined as PortalAccountIcon,
  MoreVert as MoreIcon,
  VerifiedUserOutlined as EkycIcon,
  VisibilityOutlined as ViewIcon,
} from '@mui/icons-material';
import type { Guest } from '../../../types';
import { formatHotelDate } from '../../../utils/date';
import { DataTable, type ColumnDef } from '../../../components';
import { GUEST_DESIGN } from '../../guests/constants';
import { guestLegalName } from '../utils';
import {
  BlacklistedChip,
  GuestAvatar,
  MemberChip,
  OpenRequestChip,
  TourismChip,
  VipChip,
} from './GuestChips';

export interface GuestListTableActions {
  onOpen: (guest: Guest) => void;
  onEdit: (guest: Guest) => void;
  onNewBooking: (guest: Guest) => void;
  onStayHistory: (guest: Guest) => void;
  onViewCredits: (guest: Guest) => void;
  onConvertTourism: (guest: Guest) => void;
  onTransferPortalAccount: (guest: Guest) => void;
  onCreateEkyc: (guest: Guest) => void;
  onDelete: (guest: Guest) => void;
}

interface GuestListTableProps extends GuestListTableActions {
  guests: Guest[];
  loading: boolean;
  emptyMessage: React.ReactNode;
  tourismConversionGuestId: number | null;
  canCreateEkyc: boolean;
  canTransferPortalAccount: boolean;
}

// `last_stay_date` is a date-only (YYYY-MM-DD) value — formatHotelDate keeps
// the literal calendar date instead of shifting a day west of UTC.
const formatStayDate = (value?: string) => formatHotelDate(value, '—');

interface GuestRowActionsProps extends GuestListTableActions {
  guest: Guest;
  tourismConversionGuestId: number | null;
  canCreateEkyc: boolean;
  canTransferPortalAccount: boolean;
}

/** Row action cluster: quick icon buttons plus the ⋮ overflow menu holding the
 * secondary workflows ported from the monolith's detail panel. */
const GuestRowActions: React.FC<GuestRowActionsProps> = ({
  guest,
  onOpen,
  onEdit,
  onNewBooking,
  onStayHistory,
  onViewCredits,
  onConvertTourism,
  onTransferPortalAccount,
  onCreateEkyc,
  onDelete,
  tourismConversionGuestId,
  canCreateEkyc,
  canTransferPortalAccount,
}) => {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const closeMenu = () => setAnchorEl(null);
  const isConverting = tourismConversionGuestId === guest.id;

  const run = (action: (guest: Guest) => void) => () => {
    closeMenu();
    action(guest);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.25 }}>
      <Tooltip title="View guest 360">
        <IconButton size="small" aria-label={`View ${guest.nick_name}`} onClick={() => onOpen(guest)}>
          <ViewIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Edit guest">
        <IconButton size="small" aria-label={`Edit ${guest.nick_name}`} onClick={() => onEdit(guest)}>
          <EditIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="New booking">
        <IconButton size="small" aria-label={`New booking for ${guest.nick_name}`} onClick={() => onNewBooking(guest)}>
          <NewBookingIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="More actions">
        <IconButton
          size="small"
          aria-label={`More actions for ${guest.nick_name}`}
          aria-haspopup="menu"
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          <MoreIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={closeMenu}>
        <MenuItem onClick={run(onStayHistory)}>
          <ListItemIcon><StayHistoryIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Stay history</ListItemText>
        </MenuItem>
        <MenuItem onClick={run(onViewCredits)}>
          <ListItemIcon><CreditsIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Free-night credits</ListItemText>
        </MenuItem>
        <MenuItem onClick={run(onConvertTourism)} disabled={isConverting}>
          <ListItemIcon>
            {isConverting ? <CircularProgress size={16} /> : <ConvertIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>Set tourism from last check-in</ListItemText>
        </MenuItem>
        {canTransferPortalAccount && (
          <MenuItem onClick={run(onTransferPortalAccount)}>
            <ListItemIcon><PortalAccountIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Transfer portal account</ListItemText>
          </MenuItem>
        )}
        {canCreateEkyc && (
          <MenuItem onClick={run(onCreateEkyc)}>
            <ListItemIcon><EkycIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Create eKYC</ListItemText>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={run(onDelete)} sx={{ color: GUEST_DESIGN.rose }}>
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Delete guest</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

const GuestListTable: React.FC<GuestListTableProps> = ({
  guests,
  loading,
  emptyMessage,
  tourismConversionGuestId,
  canCreateEkyc,
  canTransferPortalAccount,
  onOpen,
  onEdit,
  onNewBooking,
  onStayHistory,
  onViewCredits,
  onConvertTourism,
  onTransferPortalAccount,
  onCreateEkyc,
  onDelete,
}) => {
  const columns = React.useMemo<ColumnDef<Guest, any>[]>(() => [
    {
      id: 'guest',
      header: 'Guest',
      accessorFn: (guest: Guest) => guest.nick_name,
      enableSorting: false,
      cell: (info) => {
        const guest = info.row.original;
        const legalName = guestLegalName(guest);
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <GuestAvatar guest={guest} />
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {guest.nick_name}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {legalName && legalName !== guest.nick_name ? `${legalName} · ` : ''}#{guest.id}
              </Typography>
            </Box>
          </Box>
        );
      },
    },
    {
      id: 'contact',
      header: 'Contact',
      accessorFn: (guest: Guest) => guest.email ?? guest.phone ?? '',
      enableSorting: false,
      cell: (info) => {
        const guest = info.row.original;
        return (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {guest.email || '—'}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {guest.phone || 'No phone'}
              {guest.company_name ? ` · ${guest.company_name}` : ''}
            </Typography>
          </Box>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (guest: Guest) => guest.guest_type,
      enableSorting: false,
      cell: (info) => {
        const guest = info.row.original;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {guest.guest_type === 'member' && <MemberChip />}
            {guest.vip_status?.trim() && <VipChip status={guest.vip_status} />}
            <TourismChip guest={guest} />
          </Box>
        );
      },
    },
    {
      id: 'last_stay',
      header: 'Last stay',
      accessorFn: (guest: Guest) => guest.last_stay_date ?? '',
      enableSorting: false,
      cell: (info) => {
        const guest = info.row.original;
        return (
          <Box>
            <Typography sx={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
              {formatStayDate(guest.last_stay_date)}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
              {(guest.bookings_count ?? 0) === 0
                ? 'No stays'
                : `${guest.bookings_count} ${guest.bookings_count === 1 ? 'stay' : 'stays'}`}
            </Typography>
          </Box>
        );
      },
    },
    {
      id: 'alerts',
      header: 'Alerts',
      enableSorting: false,
      cell: (info) => {
        const guest = info.row.original;
        // The list payload exposes is_blacklisted plus has_open_support (the
        // open-conversation flag — every status but 'closed'); alert-note
        // counts are still not selected (see repositories/guest.rs
        // select_cols).
        if (!guest.is_blacklisted && !guest.has_open_support) {
          return <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>—</Typography>;
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {guest.is_blacklisted && (
              <Tooltip title={guest.blacklist_reason ? `Blacklisted — ${guest.blacklist_reason}` : 'Blacklisted guest'}>
                <BlacklistedChip />
              </Tooltip>
            )}
            {guest.has_open_support && (
              <Tooltip title="Open support conversation">
                <OpenRequestChip />
              </Tooltip>
            )}
          </Box>
        );
      },
    },
    {
      id: 'account',
      header: 'Account',
      accessorFn: (guest: Guest) => guest.account_username ?? '',
      enableSorting: false,
      cell: (info) => {
        const guest = info.row.original;
        if (!guest.account_username) {
          return <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>—</Typography>;
        }
        return (
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {guest.account_username}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: guest.account_is_active ? GUEST_DESIGN.green700 : 'text.secondary' }}>
              {guest.account_is_active ? 'Active' : 'Deactivated'}
            </Typography>
          </Box>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      meta: { align: 'right', stopRowClick: true },
      cell: (info) => (
        <GuestRowActions
          guest={info.row.original}
          tourismConversionGuestId={tourismConversionGuestId}
          canCreateEkyc={canCreateEkyc}
          canTransferPortalAccount={canTransferPortalAccount}
          onOpen={onOpen}
          onEdit={onEdit}
          onNewBooking={onNewBooking}
          onStayHistory={onStayHistory}
          onViewCredits={onViewCredits}
          onConvertTourism={onConvertTourism}
          onTransferPortalAccount={onTransferPortalAccount}
          onCreateEkyc={onCreateEkyc}
          onDelete={onDelete}
        />
      ),
    },
  ], [tourismConversionGuestId, canCreateEkyc, canTransferPortalAccount, onOpen, onEdit, onNewBooking, onStayHistory, onViewCredits, onConvertTourism, onTransferPortalAccount, onCreateEkyc, onDelete]);

  const renderMobileCard = (guest: Guest) => {
    const legalName = guestLegalName(guest);
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <GuestAvatar guest={guest} size={40} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {guest.nick_name}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
              {legalName && legalName !== guest.nick_name ? `${legalName} · ` : ''}#{guest.id}
            </Typography>
          </Box>
          {/* Keep action taps from triggering the card's row-click navigation. */}
          <Box onClick={(event) => event.stopPropagation()}>
            <GuestRowActions
              guest={guest}
              tourismConversionGuestId={tourismConversionGuestId}
              canCreateEkyc={canCreateEkyc}
              canTransferPortalAccount={canTransferPortalAccount}
              onOpen={onOpen}
              onEdit={onEdit}
              onNewBooking={onNewBooking}
              onStayHistory={onStayHistory}
              onViewCredits={onViewCredits}
              onConvertTourism={onConvertTourism}
              onTransferPortalAccount={onTransferPortalAccount}
              onCreateEkyc={onCreateEkyc}
              onDelete={onDelete}
            />
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', mt: 0.75 }}>
          {guest.guest_type === 'member' && <MemberChip />}
          {guest.vip_status?.trim() && <VipChip status={guest.vip_status} />}
          <TourismChip guest={guest} />
          {guest.is_blacklisted && (
            <BlacklistedChip icon={<BlacklistIcon sx={{ fontSize: 13 }} />} />
          )}
          {guest.has_open_support && <OpenRequestChip />}
        </Box>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.75 }}>
          {guest.email || guest.phone || 'No contact details'}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
          {(guest.bookings_count ?? 0) === 0 ? 'No stays' : `${guest.bookings_count} ${guest.bookings_count === 1 ? 'stay' : 'stays'}`}
          {' · '}Last stay: {formatStayDate(guest.last_stay_date)}
        </Typography>
      </Box>
    );
  };

  return (
    <DataTable<Guest>
      data={guests}
      columns={columns}
      loading={loading}
      loadingRowCount={8}
      emptyMessage={emptyMessage}
      onRowClick={onOpen}
      renderMobileCard={renderMobileCard}
      getRowId={(row) => String(row.id)}
      containerProps={{ sx: { borderRadius: 0, boxShadow: 'none' } }}
    />
  );
};

export default GuestListTable;
