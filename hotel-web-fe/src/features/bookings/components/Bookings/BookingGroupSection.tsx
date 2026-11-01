import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { api, toApiError } from '../../../../api/client';
import { statusLabel, useTranslation } from '../../../../i18n';
import { useCurrency } from '../../../../hooks/useCurrency';
import { toMoneyNumber } from '../../../../utils/money';

export interface StaffBookingGroupRoom {
  booking_id: number;
  booking_number: string;
  room_number?: string | null;
  room_type_name?: string | null;
  adults: number;
  children: number;
  extra_bed_count: number;
  status: string;
  payment_status: string;
  total_amount: string | number;
}

export interface StaffBookingGroup {
  group: {
    id: number;
    group_number: string;
    status: string;
    payment_status: string;
    room_count: number;
    total_amount: string | number;
  } | null;
  rooms: StaffBookingGroupRoom[];
}

export async function fetchBookingGroup(bookingId: number | string): Promise<StaffBookingGroup | null> {
  return await api.get(`bookings/${bookingId}/group`).json<StaffBookingGroup | null>();
}

export type GroupAction = 'cancel' | 'checkin' | 'checkout';

export interface GroupActionResult {
  booking_group_id: number;
  action: GroupAction;
  processed: number[];
  skipped: { booking_id: number; status: string }[];
}

/** Staff group action on the group `bookingId` belongs to (server enforces bookings:update). */
export async function runBookingGroupAction(
  bookingId: number | string,
  action: GroupAction,
  reason?: string,
): Promise<GroupActionResult> {
  return await api
    .post(`bookings/${bookingId}/group/${action}`, { json: action === 'cancel' ? { reason: reason || null } : {} })
    .json<GroupActionResult>();
}

const IN_HOUSE = ['checked_in', 'auto_checked_in', 'late_checkout'];
const DEPARTED = ['checked_out', 'completed'];

/** Which group actions apply — mirrors the server's planning rules. */
export function availableGroupActions(rooms: StaffBookingGroupRoom[]): GroupAction[] {
  const live = rooms.filter((room) => room.status !== 'voided');
  const arrivedOrGone = live.some((room) => IN_HOUSE.includes(room.status) || DEPARTED.includes(room.status));
  const actions: GroupAction[] = [];
  if (live.some((room) => !IN_HOUSE.includes(room.status) && !DEPARTED.includes(room.status))) actions.push('checkin');
  if (live.some((room) => IN_HOUSE.includes(room.status))) actions.push('checkout');
  if (live.length > 0 && !arrivedOrGone) actions.push('cancel');
  return actions;
}

const PAY_METHODS = ['cash', 'card', 'bank_transfer', 'duitnow', 'online_banking'] as const;

interface BookingGroupSectionProps {
  bookingId: number | string;
  /** Staff with bookings:update — shows the group action buttons. */
  canManage?: boolean;
  /** Called after a group action succeeds so the caller can refresh the booking. */
  onChanged?: () => void | Promise<void>;
  /** True once this booking is known to belong to a group. */
  onGroup?: (inGroup: boolean) => void;
}

/** Staff view of the multi-room booking this room belongs to; renders nothing for a single-room booking. */
export function BookingGroupSection({ bookingId, canManage = false, onChanged, onGroup }: BookingGroupSectionProps) {
  const { t } = useTranslation('bookings');
  const { format: formatCurrency } = useCurrency();
  const [data, setData] = useState<{ id: number | string; value: StaffBookingGroup | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState<GroupAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payMethod, setPayMethod] = useState<(typeof PAY_METHODS)[number]>('cash');
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const onGroupRef = useRef(onGroup);
  useEffect(() => {
    onGroupRef.current = onGroup;
  }, [onGroup]);
  useEffect(() => {
    let live = true;
    fetchBookingGroup(bookingId)
      .then((value) => {
        if (!live) return;
        setData({ id: bookingId, value });
        onGroupRef.current?.(Boolean(value?.group));
      })
      .catch(() => {
        if (!live) return;
        setData({ id: bookingId, value: null });
        onGroupRef.current?.(false);
      });
    return () => { live = false; };
  }, [bookingId, reloadKey]);
  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runBookingGroupAction(bookingId, pending, reason.trim() || undefined);
      setNotice(t(`details.group.actions.${pending}.done`, { count: result.processed.length }));
      setPending(null);
      setReason('');
      setReloadKey((key) => key + 1);
      await onChanged?.();
    } catch (err) {
      setError(toApiError(err, t('details.group.actions.failed')).message);
    } finally {
      setBusy(false);
    }
  }, [bookingId, onChanged, pending, reason, t]);
  const value = data?.id === bookingId ? data.value : null;
  if (!value?.group) return null;
  const { group, rooms } = value;
  const actions = canManage ? availableGroupActions(rooms) : [];
  const liveRooms = rooms.filter((room) => room.status !== 'voided');
  const owesMoney = liveRooms.some((room) => ['unpaid', 'unpaid_deposit', 'partial'].includes(room.payment_status));
  const claimOpen = liveRooms.some((room) => room.status === 'pending_confirmation');
  const canPay = canManage && owesMoney && !claimOpen;
  const canReactivateGroup = canManage && rooms.length > 0 && rooms.every((room) => room.status === 'voided');
  const refundWarning = liveRooms.some((room) => room.payment_status === 'paid' || room.payment_status === 'partial');
  const methodLabel = (method: (typeof PAY_METHODS)[number]) => {
    if (method === 'cash') return t('details.group.actions.pay.methods.cash');
    if (method === 'card') return t('details.group.actions.pay.methods.card');
    if (method === 'bank_transfer') return t('details.group.actions.pay.methods.bank_transfer');
    if (method === 'duitnow') return t('details.group.actions.pay.methods.duitnow');
    return t('details.group.actions.pay.methods.online_banking');
  };
  const takePayment = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post(`bookings/${bookingId}/group/pay`, {
        json: {
          payment_method: payMethod,
          transaction_reference: payReference.trim() || null,
          notes: payNotes.trim() || null,
        },
      }).json<{ amount: string | number }>();
      setNotice(t('details.group.actions.pay.done', { amount: formatCurrency(toMoneyNumber(result.amount)) }));
      setPayOpen(false);
      setPayReference('');
      setPayNotes('');
      setReloadKey((key) => key + 1);
      await onChanged?.();
    } catch (err) {
      setError(toApiError(err, t('details.group.actions.failed')).message);
    } finally {
      setBusy(false);
    }
  };
  const reactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`bookings/${bookingId}/group/reactivate`).json();
      setNotice(t('details.group.actions.reactivate.done'));
      setReactivateOpen(false);
      setReloadKey((key) => key + 1);
      await onChanged?.();
    } catch (err) {
      setError(toApiError(err, t('details.group.actions.failed')).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Box data-testid="staff-booking-group" sx={{ p: 2.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 900 }}>
        {t('details.group.title', { number: group.group_number })}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('details.group.summary', { count: group.room_count, total: formatCurrency(toMoneyNumber(group.total_amount)) })}
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        {rooms.map((room) => (
          <Stack key={room.booking_id} direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', opacity: room.status === 'voided' ? 0.6 : 1 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: String(room.booking_id) === String(bookingId) ? 800 : 600 }}>
                {room.booking_number}
                {room.room_number ? ` · ${t('details.roomNumber', { number: room.room_number })}` : ''}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {[room.room_type_name, t('details.group.guests', { adults: room.adults, children: room.children }), room.extra_bed_count > 0 ? t('details.group.extraBeds', { count: room.extra_bed_count }) : null].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            <Stack sx={{ alignItems: 'flex-end' }}>
              <Chip size="small" label={statusLabel(t, 'booking', room.status)} />
              <Typography variant="body2">{formatCurrency(toMoneyNumber(room.total_amount))}</Typography>
            </Stack>
          </Stack>
        ))}
      </Stack>
      {notice && <Alert severity="success" sx={{ mt: 1.5 }} onClose={() => setNotice(null)}>{notice}</Alert>}
      {(actions.length > 0 || canPay || canReactivateGroup) && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }} data-testid="staff-booking-group-actions">
          {canPay && (
            <Button size="small" variant="contained" onClick={() => { setError(null); setPayOpen(true); }}>
              {t('details.group.actions.pay.button')}
            </Button>
          )}
          {canReactivateGroup && (
            <Button size="small" variant="outlined" onClick={() => { setError(null); setReactivateOpen(true); }}>
              {t('details.group.actions.reactivate.button')}
            </Button>
          )}
          {actions.map((action) => (
            <Button
              key={action}
              size="small"
              variant="outlined"
              color={action === 'cancel' ? 'error' : 'primary'}
              onClick={() => { setError(null); setPending(action); }}
            >
              {t(`details.group.actions.${action}.button`)}
            </Button>
          ))}
        </Stack>
      )}
      <Dialog open={pending !== null} onClose={() => { if (!busy) setPending(null); }} fullWidth maxWidth="xs">
        {pending && (
          <>
            <DialogTitle>{t(`details.group.actions.${pending}.title`, { number: group.group_number })}</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: pending === 'cancel' ? 2 : 0 }}>
                {t(`details.group.actions.${pending}.body`)}
              </Typography>
              {pending === 'cancel' && refundWarning && (
                <Alert severity="warning" sx={{ mb: 2 }}>{t('details.group.actions.cancel.refundWarning')}</Alert>
              )}
              {pending === 'cancel' && (
                <TextField
                  fullWidth
                  size="small"
                  label={t('details.group.actions.reason')}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
              {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)} disabled={busy}>{t('details.group.actions.back')}</Button>
              <Button
                variant="contained"
                color={pending === 'cancel' ? 'error' : 'primary'}
                onClick={() => { void confirm(); }}
                disabled={busy}
              >
                {t(`details.group.actions.${pending}.confirm`)}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      <Dialog open={payOpen} onClose={() => { if (!busy) setPayOpen(false); }} fullWidth maxWidth="xs">
        <DialogTitle>{t('details.group.actions.pay.title', { number: group.group_number })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>{t('details.group.actions.pay.body')}</Typography>
          <TextField
            select
            fullWidth
            size="small"
            label={t('details.group.actions.pay.method')}
            value={payMethod}
            onChange={(event) => setPayMethod(event.target.value as (typeof PAY_METHODS)[number])}
          >
            {PAY_METHODS.map((method) => (
              <MenuItem key={method} value={method}>{methodLabel(method)}</MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label={t('details.group.actions.pay.reference')}
            value={payReference}
            onChange={(event) => setPayReference(event.target.value)}
          />
          <TextField
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label={t('details.group.actions.pay.notes')}
            value={payNotes}
            onChange={(event) => setPayNotes(event.target.value)}
          />
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayOpen(false)} disabled={busy}>{t('details.group.actions.back')}</Button>
          <Button variant="contained" onClick={() => { void takePayment(); }} disabled={busy}>
            {t('details.group.actions.pay.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={reactivateOpen} onClose={() => { if (!busy) setReactivateOpen(false); }} fullWidth maxWidth="xs">
        <DialogTitle>{t('details.group.actions.reactivate.title', { number: group.group_number })}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('details.group.actions.reactivate.body')}</Typography>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReactivateOpen(false)} disabled={busy}>{t('details.group.actions.back')}</Button>
          <Button variant="contained" onClick={() => { void reactivate(); }} disabled={busy}>
            {t('details.group.actions.reactivate.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
