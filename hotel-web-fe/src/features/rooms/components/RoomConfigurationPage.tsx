import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  CircularProgress,
  IconButton,
  Chip,
  MenuItem,
  Switch,
  FormControlLabel,
  Collapse,
  Drawer,
  Tooltip,
  InputAdornment,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  CheckCircle as ActiveIcon,
  Cancel as InactiveIcon,
  Close as CloseIcon,
  Check as CheckIcon,
  ChevronRight as ChevronRightIcon,
  ExpandMore as ExpandMoreIcon,
  MeetingRoom as DoorIcon,
  KingBed as BedIcon,
  People as PeopleIcon,
  Search as SearchIcon,
  Category as LayersIcon,
  Apartment as BuildingIcon,
  Accessible as AccessibleIcon,
  RemoveCircleOutlined as MinusIcon,
  AddCircleOutlined as PlusIcon,
  SmokingRooms as SmokingIcon,
  AddPhotoAlternate as AddPhotoIcon,
  MoreVert as MoreVertIcon,
} from '@mui/icons-material';
import { Room, RoomType, RoomTypeCreateInput, RoomTypeUpdateInput } from '../../../types';
import { errorMessage } from '../../../utils';
import { useTranslation } from '../../../i18n/useTranslation';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { compareMoney, toMoneyNumber } from '../../../utils/money';
import { apiUrl } from '../../../desktop/runtimeApi';
import {
  useAllRoomTypes,
  useCreateRoom,
  useCreateRoomType,
  useDeleteRoom,
  useDeleteRoomType,
  useRooms,
  useUpdateRoom,
  useUpdateRoomType,
  useUploadRoomTypeImage,
} from '../hooks/useRoomQueries';
import { ActionsMenu } from '../../../components/common/ActionsMenu';
import type { ActionMenuItem } from '../../../components/common/ActionsMenu';
import { SearchAndFilters } from '../../../components/common/SearchAndFilters';
import { useIsPhone } from '../../../hooks/useIsPhone';

/* ---------- Design tokens (Room Configuration) — aliases onto --hotel-* ---------- */
const C = {
  surface: 'var(--hotel-surface)',
  surface2: 'var(--hotel-surface-raised)',
  surface3: 'var(--hotel-surface-sunken)',
  border: 'var(--hotel-border)',
  borderHi: 'var(--hotel-border-strong)',
  ink: 'var(--hotel-text)',
  ink2: 'var(--hotel-text-secondary)',
  ink3: 'var(--hotel-text-muted)',
  emerald: 'var(--hotel-primary)',
  emeraldDeep: 'var(--hotel-primary-hover)',
  emeraldDarker: 'var(--hotel-primary-active)',
  emeraldSoft: 'var(--hotel-primary-subtle)',
  blue: 'var(--hotel-info)',
  blueSoft: 'var(--hotel-info-bg)',
  amber: 'var(--hotel-warning)',
  amberSoft: 'var(--hotel-warning-bg)',
  amberBorder: 'var(--hotel-warning-border)',
  rose: 'var(--hotel-danger)',
  roseSoft: 'var(--hotel-danger-bg)',
  slateSoft: 'var(--hotel-neutral-bg)',
};

const BED_TYPES = ['Single', 'Twin', 'Double', 'Queen', 'King', 'Super King', 'Bunk'];

type RoomStatus = 'available' | 'unavailable' | 'maintenance';

const statusColor: Record<RoomStatus, string> = {
  available: C.emerald,
  unavailable: C.rose,
  maintenance: C.amber,
};

function roomStatus(room: Room): RoomStatus {
  if ((room.status || '').toLowerCase() === 'maintenance') return 'maintenance';
  return room.available ? 'available' : 'unavailable';
}

function bedSummary(rt?: RoomType | null): string {
  if (!rt) return '—';
  const count = rt.bed_count || 1;
  const type = rt.bed_type || 'Queen';
  return `${count}× ${type}`;
}

interface RoomTypeFormData {
  name: string;
  code: string;
  description: string;
  base_price: number | '';
  weekday_rate: number | '';
  weekend_rate: number | '';
  max_occupancy: number;
  bed_type: string;
  bed_count: number;
  allows_extra_bed: boolean;
  max_extra_beds: number;
  extra_bed_charge: number | '';
  sort_order: number;
  is_active: boolean;
}

const emptyTypeForm: RoomTypeFormData = {
  name: '',
  code: '',
  description: '',
  base_price: '',
  weekday_rate: '',
  weekend_rate: '',
  max_occupancy: 2,
  bed_type: 'Queen',
  bed_count: 1,
  allows_extra_bed: false,
  max_extra_beds: 0,
  extra_bed_charge: '',
  sort_order: 0,
  is_active: true,
};

interface RoomFormData {
  room_number: string;
  floor: number | '';
  building: string;
  custom_price: number | '';
  is_accessible: boolean;
  is_smoking: boolean;
}

const emptyRoomForm: RoomFormData = {
  room_number: '',
  floor: '',
  building: '',
  custom_price: '',
  is_accessible: false,
  is_smoking: false,
};

const RoomConfigurationPage: React.FC = () => {
  const { t } = useTranslation('rooms');
  const { hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const isPhone = useIsPhone();
  const hasAccess =
    hasPermission('rooms:read') ||
    hasPermission('rooms:manage');
  const canEdit =
    hasPermission('rooms:write') ||
    hasPermission('rooms:update') ||
    hasPermission('rooms:manage');

  const [error, setError] = useState<string | null>(null);
  const roomsQuery = useRooms(hasAccess);
  const roomTypesQuery = useAllRoomTypes(hasAccess);
  const createRoomMutation = useCreateRoom();
  const updateRoomMutation = useUpdateRoom();
  const deleteRoomMutation = useDeleteRoom();
  const createRoomTypeMutation = useCreateRoomType();
  const updateRoomTypeMutation = useUpdateRoomType();
  const deleteRoomTypeMutation = useDeleteRoomType();
  const uploadRoomTypeImageMutation = useUploadRoomTypeImage();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RoomStatus>('all');
  const [groupBy, setGroupBy] = useState<'type' | 'floor'>('type');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Room type drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingType, setEditingType] = useState<RoomType | null>(null);
  const [typeForm, setTypeForm] = useState<RoomTypeFormData>(emptyTypeForm);
  const [typeDeleteTarget, setTypeDeleteTarget] = useState<RoomType | null>(null);

  // Room dialogs
  const [addingRoomFor, setAddingRoomFor] = useState<RoomType | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomForm, setRoomForm] = useState<RoomFormData>(emptyRoomForm);
  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null);

  const [formLoading, setFormLoading] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const loadData = async () => {
    try {
      await Promise.all([roomsQuery.refetch(), roomTypesQuery.refetch()]);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('errors.loadData')));
    }
  };

  const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data]);
  const roomTypes = useMemo(
    () => [...(roomTypesQuery.data ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [roomTypesQuery.data]
  );
  const queryError = roomsQuery.error || roomTypesQuery.error;
  const loading = roomsQuery.isPending || roomTypesQuery.isPending;
  const pageError = error || (queryError instanceof Error ? queryError.message : null);

  const typeByName = useMemo(() => {
    const m: Record<string, RoomType> = {};
    roomTypes.forEach((t) => {
      m[t.name] = t;
    });
    return m;
  }, [roomTypes]);

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms.filter((r) => {
      if (statusFilter !== 'all' && roomStatus(r) !== statusFilter) return false;
      if (!q) return true;
      const t = typeByName[r.room_type];
      return (
        String(r.room_number).toLowerCase().includes(q) ||
        (r.room_type || '').toLowerCase().includes(q) ||
        (t?.code || '').toLowerCase().includes(q) ||
        String(r.floor ?? '').includes(q)
      );
    });
  }, [rooms, query, statusFilter, typeByName]);

  const counts = useMemo(() => {
    const total = rooms.length;
    const avail = rooms.filter((r) => roomStatus(r) === 'available').length;
    const unav = rooms.filter((r) => roomStatus(r) === 'unavailable').length;
    const maint = rooms.filter((r) => roomStatus(r) === 'maintenance').length;
    return { total, avail, unav, maint, types: roomTypes.length };
  }, [rooms, roomTypes]);

  type GroupT =
    | { kind: 'type'; key: string; type: RoomType; items: Room[] }
    | { kind: 'floor'; key: string; floor: number | string; items: Room[] }
    | { kind: 'unassigned'; key: string; items: Room[] };

  const groups: GroupT[] = useMemo(() => {
    if (groupBy === 'type') {
      const g: GroupT[] = roomTypes.map((t) => ({
        kind: 'type' as const,
        key: `t-${t.id}`,
        type: t,
        items: filteredRooms
          .filter((r) => r.room_type === t.name)
          .sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true })),
      }));
      const orphan = filteredRooms.filter((r) => !typeByName[r.room_type]);
      if (orphan.length) g.push({ kind: 'unassigned', key: 'unassigned', items: orphan });
      return g;
    }
    const floors = [...new Set(filteredRooms.map((r) => r.floor ?? 0))].sort(
      (a, b) => Number(a) - Number(b)
    );
    return floors.map((f) => ({
      kind: 'floor' as const,
      key: `f-${f}`,
      floor: f,
      items: filteredRooms
        .filter((r) => (r.floor ?? 0) === f)
        .sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true })),
    }));
  }, [filteredRooms, groupBy, roomTypes, typeByName]);

  const toggleCollapsed = (key: string) =>
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  /* ---------- Room type actions ---------- */
  const openNewType = () => {
    setEditingType(null);
    setTypeForm(emptyTypeForm);
    setDrawerOpen(true);
  };
  const openEditType = (t: RoomType) => {
    setEditingType(t);
    setTypeForm({
      name: t.name,
      code: t.code,
      description: t.description || '',
      base_price: toMoneyNumber(t.base_price),
      weekday_rate: t.weekday_rate ? toMoneyNumber(t.weekday_rate) : '',
      weekend_rate: t.weekend_rate ? toMoneyNumber(t.weekend_rate) : '',
      max_occupancy: t.max_occupancy,
      bed_type: t.bed_type || 'Queen',
      bed_count: t.bed_count || 1,
      allows_extra_bed: t.allows_extra_bed,
      max_extra_beds: t.max_extra_beds,
      extra_bed_charge: t.extra_bed_charge ? toMoneyNumber(t.extra_bed_charge) : '',
      sort_order: t.sort_order,
      is_active: t.is_active,
    });
    setDrawerOpen(true);
  };

  const setTF = (patch: Partial<RoomTypeFormData>) =>
    setTypeForm((f) => ({ ...f, ...patch }));

  const occupancySuggested = useMemo(() => {
    const cap = typeForm.bed_type === 'King' || typeForm.bed_type === 'Super King' || typeForm.bed_type === 'Queen' || typeForm.bed_type === 'Double' ? 2 : 1;
    return cap * (Number(typeForm.bed_count) || 0);
  }, [typeForm.bed_type, typeForm.bed_count]);

  const canSaveType =
    typeForm.name.trim() !== '' &&
    typeForm.code.trim() !== '' &&
    typeForm.base_price !== '';

  const handleSaveType = async () => {
    if (!canSaveType) return;
    try {
      setFormLoading(true);
      const base = {
        name: typeForm.name.trim(),
        code: typeForm.code.toUpperCase().trim(),
        description: typeForm.description || undefined,
        base_price: toMoneyNumber(typeForm.base_price),
        weekday_rate: typeForm.weekday_rate ? toMoneyNumber(typeForm.weekday_rate) : undefined,
        weekend_rate: typeForm.weekend_rate ? toMoneyNumber(typeForm.weekend_rate) : undefined,
        max_occupancy: Number(typeForm.max_occupancy) || 1,
        bed_type: typeForm.bed_type,
        bed_count: Number(typeForm.bed_count) || 1,
        allows_extra_bed: typeForm.allows_extra_bed,
        max_extra_beds: typeForm.allows_extra_bed ? typeForm.max_extra_beds : 0,
        extra_bed_charge:
          typeForm.allows_extra_bed && typeForm.extra_bed_charge
            ? toMoneyNumber(typeForm.extra_bed_charge)
            : 0,
        sort_order: Number(typeForm.sort_order) || 0,
      };
      if (editingType) {
        const input: RoomTypeUpdateInput = { ...base, is_active: typeForm.is_active };
        await updateRoomTypeMutation.mutateAsync({ roomTypeId: editingType.id, data: input });
        emitApiNotification({ message: t('notifications.roomTypeUpdated'), severity: 'success' });
      } else {
        const input: RoomTypeCreateInput = base;
        await createRoomTypeMutation.mutateAsync(input);
        emitApiNotification({ message: t('notifications.roomTypeCreated'), severity: 'success' });
      }
      setDrawerOpen(false);
      setEditingType(null);
      await loadData();
    } catch (err) {
      const msg = errorMessage(err, '');
      if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
        if (msg.includes('room_types_name_key')) {
          emitApiNotification({ message: t('notifications.duplicateName', { name: typeForm.name }), severity: 'error' });
        } else if (msg.includes('room_types_code_key')) {
          emitApiNotification({ message: t('notifications.duplicateCode', { code: typeForm.code.toUpperCase() }), severity: 'error' });
        } else {
          emitApiNotification({ message: t('notifications.duplicateNameOrCode'), severity: 'error' });
        }
      } else {
        emitApiNotification({ message: msg || t('errors.saveRoomType'), severity: 'error' });
      }
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleTypeActive = async (roomType: RoomType) => {
    try {
      await updateRoomTypeMutation.mutateAsync({ roomTypeId: roomType.id, data: { is_active: !roomType.is_active } });
      emitApiNotification({
        message: roomType.is_active
          ? t('notifications.roomTypeHidden')
          : t('notifications.roomTypeBookable'),
        severity: 'success',
      });
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.updateRoomType')), severity: 'error' });
    }
  };

  const handleDuplicateType = async (roomType: RoomType) => {
    try {
      const input: RoomTypeCreateInput = {
        name: `${roomType.name} (Copy)`,
        code: `${roomType.code}2`.slice(0, 10),
        description: roomType.description || undefined,
        base_price: toMoneyNumber(roomType.base_price),
        weekday_rate: roomType.weekday_rate ? toMoneyNumber(roomType.weekday_rate) : undefined,
        weekend_rate: roomType.weekend_rate ? toMoneyNumber(roomType.weekend_rate) : undefined,
        max_occupancy: roomType.max_occupancy,
        bed_type: roomType.bed_type,
        bed_count: roomType.bed_count,
        allows_extra_bed: roomType.allows_extra_bed,
        max_extra_beds: roomType.max_extra_beds,
        extra_bed_charge: toMoneyNumber(roomType.extra_bed_charge),
        sort_order: roomType.sort_order + 1,
      };
      await createRoomTypeMutation.mutateAsync(input);
      emitApiNotification({ message: t('notifications.roomTypeDuplicated'), severity: 'success' });
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.duplicateRoomType')), severity: 'error' });
    }
  };

  const handleUploadTypePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editingType) return;
    try {
      setPhotoBusy(true);
      const updated = await uploadRoomTypeImageMutation.mutateAsync({ roomTypeId: editingType.id, file });
      setEditingType(updated);
      emitApiNotification({ message: t('notifications.photoAdded'), severity: 'success' });
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.uploadPhoto')), severity: 'error' });
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemoveTypePhoto = async (url: string) => {
    if (!editingType) return;
    const remaining = (editingType.images ?? []).filter((image) => image !== url);
    try {
      setPhotoBusy(true);
      const updated = await updateRoomTypeMutation.mutateAsync({
        roomTypeId: editingType.id,
        data: { images: remaining },
      });
      setEditingType(updated);
      emitApiNotification({ message: t('notifications.photoRemoved'), severity: 'success' });
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.removePhoto')), severity: 'error' });
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleDeleteType = async () => {
    if (!typeDeleteTarget) return;
    try {
      setFormLoading(true);
      await deleteRoomTypeMutation.mutateAsync(typeDeleteTarget.id);
      emitApiNotification({ message: t('notifications.roomTypeDeleted'), severity: 'success' });
      setTypeDeleteTarget(null);
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.deleteRoomType')), severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  /* ---------- Room actions ---------- */
  const openAddRoom = (t: RoomType) => {
    setAddingRoomFor(t);
    setRoomForm(emptyRoomForm);
  };
  const openEditRoom = (r: Room) => {
    setEditingRoom(r);
    const t = typeByName[r.room_type];
    const price = toMoneyNumber(r.price_per_night);
    setRoomForm({
      room_number: r.room_number,
      floor: r.floor ?? '',
      building: '',
      custom_price: t && compareMoney(price, t.base_price) === 0 ? '' : price,
      is_accessible: false,
      is_smoking: !!r.is_smoking,
    });
  };

  const handleCreateRoom = async () => {
    if (!addingRoomFor || !roomForm.room_number.trim()) return;
    try {
      setFormLoading(true);
      const roomType = addingRoomFor;
      const price =
        roomForm.custom_price !== '' ? toMoneyNumber(roomForm.custom_price) : toMoneyNumber(roomType.base_price);
      await createRoomMutation.mutateAsync({
        room_number: roomForm.room_number.trim(),
        room_type: roomType.name,
        room_type_id: roomType.id,
        price_per_night: price,
        max_occupancy: roomType.max_occupancy,
        floor: roomForm.floor === '' ? 1 : Number(roomForm.floor),
        building: roomForm.building || undefined,
        custom_price: roomForm.custom_price !== '' ? toMoneyNumber(roomForm.custom_price) : undefined,
        is_accessible: roomForm.is_accessible,
        is_smoking: roomForm.is_smoking,
      });
      emitApiNotification({ message: t('notifications.roomCreated'), severity: 'success' });
      setAddingRoomFor(null);
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.createRoom')), severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateRoom = async () => {
    if (!editingRoom) return;
    try {
      setFormLoading(true);
      await updateRoomMutation.mutateAsync({ roomId: editingRoom.id, data: {
        room_number: roomForm.room_number,
        price_per_night:
          roomForm.custom_price !== '' ? toMoneyNumber(roomForm.custom_price) : undefined,
        available: editingRoom.available,
        is_smoking: roomForm.is_smoking,
      } });
      emitApiNotification({ message: t('notifications.roomUpdated'), severity: 'success' });
      setEditingRoom(null);
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.updateRoom')), severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleRoomStatus = async (r: Room) => {
    try {
      await updateRoomMutation.mutateAsync({ roomId: r.id, data: { available: !r.available } });
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.updateRoom')), severity: 'error' });
    }
  };

  const handleDeleteRoom = async () => {
    if (!deletingRoom) return;
    try {
      setFormLoading(true);
      await deleteRoomMutation.mutateAsync(deletingRoom.id);
      emitApiNotification({ message: t('notifications.roomDeleted'), severity: 'success' });
      setDeletingRoom(null);
      await loadData();
    } catch (err) {
      emitApiNotification({ message: errorMessage(err, t('errors.deleteRoom')), severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  if (!hasAccess) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          {t('config.forbidden')}
        </Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "400px"
        }}>
        <CircularProgress />
      </Box>
    );
  }

  /* ---------- small presentational helpers ---------- */
  const StatCard = ({
    label,
    value,
    color,
    delta,
  }: {
    label: string;
    value: React.ReactNode;
    color?: string;
    delta?: string;
  }) => (
    <Box sx={{ bgcolor: C.surface, p: '14px 18px', flex: 1, minWidth: 150 }}>
      <Typography
        sx={{ fontSize: 11, fontWeight: 600, color: C.ink3, letterSpacing: '0.6px', textTransform: 'uppercase' }}
      >
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, color: color || C.ink, lineHeight: 1.15, mt: 0.5 }}>
        {value}
      </Typography>
      {delta && <Typography sx={{ fontSize: 11, color: C.ink3, mt: 0.25 }}>{delta}</Typography>}
    </Box>
  );

  const StatusChip = ({
    active,
    label,
    count,
    onClick,
  }: {
    active: boolean;
    label: string;
    count: number;
    onClick: () => void;
  }) => (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        bgcolor: active ? C.ink : C.surface,
        color: active ? 'var(--hotel-bg)' : C.ink2,
        border: `1px solid ${active ? C.ink : C.border}`,
        borderRadius: 999,
        px: 1.5,
        py: 0.75,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {label}
      <Box
        component="span"
        sx={{
          bgcolor: active ? 'color-mix(in srgb, var(--hotel-bg) 20%, transparent)' : C.surface3,
          color: active ? 'var(--hotel-bg)' : C.ink3,
          px: 0.75,
          borderRadius: 999,
          fontSize: 10.5,
          fontWeight: 700,
        }}
      >
        {count}
      </Box>
    </Box>
  );

  const RoomCard = ({ room }: { room: Room }) => {
    const rt = typeByName[room.room_type];
    const st = roomStatus(room);
    const price = toMoneyNumber(room.price_per_night);
    const isCustom = !!rt && compareMoney(price, rt.base_price) !== 0;
    const roomActions: ActionMenuItem[] = [
      {
        id: 'toggle-availability',
        label: t('config.toggleAvailability'),
        icon: <ActiveIcon sx={{ fontSize: 16, color: statusColor[st] }} />,
        onClick: () => handleToggleRoomStatus(room),
      },
      {
        id: 'edit',
        label: t('config.editRoom'),
        icon: <EditIcon sx={{ fontSize: 16 }} />,
        onClick: () => openEditRoom(room),
      },
      {
        id: 'delete',
        label: t('config.deleteRoom'),
        icon: <DeleteIcon sx={{ fontSize: 16 }} />,
        destructive: true,
        onClick: () => setDeletingRoom(room),
      },
    ];
    return (
      <Box
        sx={{
          position: 'relative',
          bgcolor: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: '11px',
          p: '12px 14px',
          pl: '18px',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
          transition: 'border-color 120ms, box-shadow 120ms, transform 120ms',
          '&:hover': {
            borderColor: C.borderHi,
            boxShadow: 'var(--hotel-shadow-sm)',
            transform: 'translateY(-1px)',
          },
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            top: 14,
            bottom: 14,
            width: 3,
            borderRadius: 999,
            bgcolor: statusColor[st],
          },
        }}
      >

        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1 }}>
            {room.room_number}
            {room.floor != null && (
              <Box component="span" sx={{ fontSize: 10, fontWeight: 600, color: C.ink3, ml: 0.5 }}>
                · F{room.floor}
              </Box>
            )}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: statusColor[st],
                border: '2px solid var(--hotel-surface)',
                boxShadow: `0 0 0 1px color-mix(in srgb, ${statusColor[st]} 60%, transparent)`,
              }}
              title={t(`config.roomStatus.${st}`)}
            />
            {canEdit && (
              /* Persistent actions at every breakpoint — the old hover reveal
                 was undiscoverable on touch (there is no hover at any width). */
              <ActionsMenu
                trigger={
                  <IconButton
                    size="small"
                    aria-label={t('card.openActionsAria', { room: room.room_number, status: t(`config.roomStatus.${st}`) })}
                    sx={{ width: 26, height: 26, border: `1px solid ${C.border}`, bgcolor: C.surface }}
                  >
                    <MoreVertIcon sx={{ fontSize: 15, color: C.ink3 }} />
                  </IconButton>
                }
                actions={roomActions}
              />
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 11, color: C.ink3, flexWrap: 'wrap' }}>
          <span>{rt?.code || room.room_type || '—'}</span>
          <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: C.ink3 }} />
          <span>{bedSummary(rt)}</span>
          {room.is_smoking && (
            <Tooltip title={t('card.smokingTooltip')}>
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 24,
                  height: 20,
                  color: C.amber,
                  bgcolor: C.amberSoft,
                  border: `1px solid ${C.amberBorder}`,
                  borderRadius: '6px',
                }}
              >
                <SmokingIcon sx={{ fontSize: 12 }} />
              </Box>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75, mt: 0.25 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: isCustom ? C.blue : C.ink }}>
            {formatCurrency(price)}
          </Typography>
          {isCustom && (
            <Chip
              label={t('config.customChip')}
              size="small"
              sx={{ height: 18, fontSize: 9.5, fontWeight: 700, bgcolor: C.amberSoft, color: C.amber }}
            />
          )}
        </Box>
      </Box>
    );
  };

  /* ---------- Shared controlled filter controls ----------
     Both layouts render these same elements: desktop lays them out in one
     inline row; on phone the secondary controls mount inside the
     SearchAndFilters FilterSheet. All values/handlers live in page state, so
     the sheet's unmount-on-close is safe. */
  const searchField = (
    <TextField
      size="small"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder={t('config.searchPlaceholder')}
      sx={{
        minWidth: { xs: 0, sm: 280 },
        width: { xs: '100%', sm: 'auto' },
        bgcolor: C.surface,
        '& .MuiOutlinedInput-root': { borderRadius: '9px' },
      }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: C.ink3 }} />
            </InputAdornment>
          ),
        }
      }}
    />
  );

  const statusChips = (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      <StatusChip active={statusFilter === 'all'} label={t('filters.all')} count={counts.total} onClick={() => setStatusFilter('all')} />
      <StatusChip active={statusFilter === 'available'} label={t('config.roomStatus.available')} count={counts.avail} onClick={() => setStatusFilter('available')} />
      <StatusChip active={statusFilter === 'unavailable'} label={t('config.statUnavailable')} count={counts.unav} onClick={() => setStatusFilter('unavailable')} />
      <StatusChip active={statusFilter === 'maintenance'} label={t('config.roomStatus.maintenance')} count={counts.maint} onClick={() => setStatusFilter('maintenance')} />
    </Box>
  );

  const groupByToggle = (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={groupBy}
      onChange={(_, v) => v && setGroupBy(v)}
      sx={{
        bgcolor: C.surface,
        '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 600, fontSize: 12, px: 1.5, gap: 0.75 },
        '& .Mui-selected': { bgcolor: `${C.ink} !important`, color: 'var(--hotel-bg) !important' },
      }}
    >
      <ToggleButton value="type">
        <LayersIcon sx={{ fontSize: 15 }} /> {t('config.groupByType')}
      </ToggleButton>
      <ToggleButton value="floor">
        <BuildingIcon sx={{ fontSize: 15 }} /> {t('config.groupByFloor')}
      </ToggleButton>
    </ToggleButtonGroup>
  );

  // Non-default selections surfaced on the phone filter-button badge (the
  // search stays visible so it is not counted).
  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (groupBy !== 'type' ? 1 : 0);

  const handleResetFilters = () => {
    setQuery('');
    setStatusFilter('all');
    setGroupBy('type');
  };

  const sheetSectionLabel = (text: string) => (
    <Typography
      variant="caption"
      sx={{ display: 'block', fontWeight: 600, color: 'text.secondary', mb: 0.75 }}
    >
      {text}
    </Typography>
  );

  return (
    <Box sx={{ p: 3, maxWidth: 1480, mx: 'auto' }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 2.25 }}>
        <Box>
          <Box sx={{ fontSize: 11.5, color: C.ink3, fontWeight: 500, letterSpacing: '0.3px', display: 'flex', gap: 0.75, mb: 0.75 }}>
            <span>{t('config.breadcrumbSection')}</span>
            <span style={{ color: C.borderHi }}>›</span>
            <span style={{ color: C.ink2, fontWeight: 600 }}>{t('title')}</span>
          </Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <DoorIcon sx={{ fontSize: 24 }} />
            {t('title')}
          </Typography>
          <Typography sx={{ fontSize: 13, color: C.ink3, mt: 0.5 }}>
            {t('config.subtitle')}
          </Typography>
        </Box>
        {canEdit && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openNewType}
            sx={{
              bgcolor: C.emerald,
              borderRadius: '9px',
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': { bgcolor: C.emeraldDeep },
            }}
          >
            {t('config.newRoomType')}
          </Button>
        )}
      </Box>
      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {pageError}
        </Alert>
      )}
      {/* Stats strip */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1px',
          bgcolor: C.border,
          border: `1px solid ${C.border}`,
          borderRadius: '12px',
          overflow: 'hidden',
          mb: 2.5,
        }}
      >
        <StatCard label={t('config.statTotal')} value={counts.total} />
        <StatCard
          label={t('config.roomStatus.available')}
          value={counts.avail}
          color={C.emerald}
          delta={t('config.ofStock', { percent: counts.total ? Math.round((counts.avail / counts.total) * 100) : 0 })}
        />
        <StatCard label={t('config.statUnavailable')} value={counts.unav} color={C.rose} />
        <StatCard label={t('config.roomStatus.maintenance')} value={counts.maint} color={C.amber} />
        <StatCard label={t('config.statTypes')} value={counts.types} color={C.blue} />
      </Box>
      {/* Toolbar: phone → search + badged filter sheet via SearchAndFilters;
          desktop → the same controls in the original inline row. */}
      {isPhone ? (
        <Box
          sx={{
            bgcolor: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: '12px',
            overflow: 'hidden',
            mb: 2,
          }}
        >
          <SearchAndFilters
            search={searchField}
            activeFilterCount={activeFilterCount}
            onReset={handleResetFilters}
            sheetTitle={t('header.filtersTitle')}
          >
            <Box>
              {sheetSectionLabel(t('header.sectionStatus'))}
              {statusChips}
            </Box>
            <Box>
              {sheetSectionLabel(t('header.sectionGroupBy'))}
              {groupByToggle}
            </Box>
          </SearchAndFilters>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2, flexWrap: 'wrap' }}>
          {searchField}
          {statusChips}
          <Box sx={{ flex: 1 }} />
          {groupByToggle}
        </Box>
      )}
      {/* Groups */}
      {groups.length === 0 && (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            color: C.ink3,
            bgcolor: C.surface,
            border: `1.5px dashed ${C.borderHi}`,
            borderRadius: '11px',
          }}
        >
          <SearchIcon sx={{ fontSize: 22 }} />
          <Typography sx={{ mt: 1 }}>{t('config.noMatch')}</Typography>
        </Box>
      )}
      {groups.map((g) => {
        const isType = g.kind === 'type';
        const rt = isType ? g.type : null;
        const total = g.items.length;
        const avail = g.items.filter((r) => roomStatus(r) === 'available').length;
        const ratio = total ? (avail / total) * 100 : 0;
        const open = !collapsed[g.key];
        const title =
          g.kind === 'type'
            ? g.type.name
            : g.kind === 'floor'
            ? t('header.floorN', { floor: g.floor })
            : t('config.unassignedType');
        // Same four type-level actions as the desktop icon cluster —
        // surfaced through ActionsMenu on phone where space is tight.
        const typeActions: ActionMenuItem[] = rt
          ? [
              {
                id: 'toggle-active',
                label: rt.is_active ? t('config.hideFromBooking') : t('config.showInBooking'),
                icon: rt.is_active ? (
                  <ActiveIcon sx={{ fontSize: 16, color: C.emerald }} />
                ) : (
                  <InactiveIcon sx={{ fontSize: 16, color: C.amber }} />
                ),
                onClick: () => handleToggleTypeActive(rt),
              },
              {
                id: 'duplicate',
                label: t('common:actions.duplicate'),
                icon: <CopyIcon sx={{ fontSize: 16 }} />,
                onClick: () => handleDuplicateType(rt),
              },
              {
                id: 'edit',
                label: t('common:actions.edit'),
                icon: <EditIcon sx={{ fontSize: 16 }} />,
                onClick: () => openEditType(rt),
              },
              {
                id: 'delete',
                label: t('common:actions.delete'),
                icon: <DeleteIcon sx={{ fontSize: 16 }} />,
                destructive: true,
                onClick: () => setTypeDeleteTarget(rt),
              },
            ]
          : [];

        return (
          <Box
            key={g.key}
            sx={{
              bgcolor: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: '14px',
              overflow: 'hidden',
              mb: 1.75,
            }}
          >
            <Box
              onClick={() => toggleCollapsed(g.key)}
              sx={{
                display: 'grid',
                gridTemplateColumns: '28px 1fr auto',
                alignItems: 'center',
                gap: 1.75,
                p: '14px 18px',
                cursor: 'pointer',
                borderBottom: open ? `1px solid ${C.border}` : '1px solid transparent',
                '&:hover': { bgcolor: C.surface2 },
              }}
            >
              <Box sx={{ color: C.ink3, display: 'grid', placeItems: 'center' }}>
                {open ? <ExpandMoreIcon /> : <ChevronRightIcon />}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, minWidth: 0 }}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '11px',
                    bgcolor: C.emeraldSoft,
                    color: C.emeraldDeep,
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    border: `1px solid color-mix(in srgb, ${C.emerald} 16%, transparent)`,
                  }}
                >
                  {isType ? <BedIcon /> : <BuildingIcon />}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </Typography>
                    {rt && (
                      <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, fontWeight: 700, bgcolor: C.surface3, color: C.ink2, px: 0.875, py: 0.25, borderRadius: '5px' }}>
                        {rt.code}
                      </Box>
                    )}
                    {rt && !rt.is_active && (
                      <Box component="span" sx={{ fontSize: 10.5, fontWeight: 700, bgcolor: C.amberSoft, color: C.amber, px: 0.875, py: 0.25, borderRadius: '5px' }}>
                        {t('config.hiddenBadge')}
                      </Box>
                    )}
                    {rt && (
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'baseline',
                          gap: 0.5,
                          bgcolor: C.emeraldSoft,
                          border: `1px solid color-mix(in srgb, ${C.emerald} 20%, transparent)`,
                          color: C.emeraldDarker,
                          px: 1.125,
                          py: 0.5,
                          borderRadius: '7px',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {formatCurrency(toMoneyNumber(rt.base_price))}
                        <Box component="span" sx={{ color: C.ink3, fontWeight: 500, ml: 0.25 }}>
                          {t('config.perNight')}
                        </Box>
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, fontSize: 12, color: C.ink3, mt: 0.5, flexWrap: 'wrap' }}>
                    {rt ? (
                      <>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                          <BedIcon sx={{ fontSize: 13 }} />
                          <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>{bedSummary(rt)}</Box>
                        </Box>
                        <span style={{ color: C.borderHi }}>·</span>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                          <PeopleIcon sx={{ fontSize: 13 }} /> {t('config.sleepsCount', { count: rt.max_occupancy })}
                        </Box>
                        {rt.allows_extra_bed && (
                          <>
                            <span style={{ color: C.borderHi }}>·</span>
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                              <AddIcon sx={{ fontSize: 12 }} /> {t('config.extraBed')}{' '}
                              <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>
                                {formatCurrency(toMoneyNumber(rt.extra_bed_charge))}
                              </Box>
                            </Box>
                          </>
                        )}
                      </>
                    ) : (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                        <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>{total}</Box> {t('config.roomsLabel')}
                      </Box>
                    )}
                  </Box>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                {isPhone ? (
                  /* Phone: collapse the right column to the availability count
                     plus an ActionsMenu carrying the same four type actions. */
                  <>
                    <Box sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
                      <Box component="span" sx={{ color: C.emerald }}>{avail}</Box>
                      <Box component="span" sx={{ color: C.ink3, fontWeight: 500 }}>/{total}</Box>
                    </Box>
                    {isType && rt && canEdit && (
                      <ActionsMenu triggerLabel={t('card.moreActions')} actions={typeActions} />
                    )}
                  </>
                ) : (
                  <>
                    <Box sx={{ textAlign: 'right' }}>
                      <Box sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                        <Box component="span" sx={{ color: C.emerald }}>{avail}</Box>
                        <Box component="span" sx={{ color: C.ink3, fontWeight: 500 }}>/{total}</Box>
                      </Box>
                      <Typography sx={{ fontSize: 10.5, color: C.ink3, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', mt: 0.5 }}>
                        {t('config.roomStatus.available')}
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={ratio}
                        sx={{
                          width: 90,
                          height: 6,
                          borderRadius: 999,
                          mt: 0.75,
                          bgcolor: C.surface3,
                          '& .MuiLinearProgress-bar': { bgcolor: C.emerald },
                        }}
                      />
                    </Box>
                    {isType && rt && canEdit && (
                      <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
                        <Tooltip title={rt.is_active ? t('config.hideFromBooking') : t('config.showInBooking')}>
                          <IconButton size="small" onClick={() => handleToggleTypeActive(rt)}>
                            {rt.is_active ? <ActiveIcon sx={{ fontSize: 16, color: C.emerald }} /> : <InactiveIcon sx={{ fontSize: 16, color: C.amber }} />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common:actions.duplicate')}>
                          <IconButton size="small" onClick={() => handleDuplicateType(rt)}>
                            <CopyIcon sx={{ fontSize: 15, color: C.ink3 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common:actions.edit')}>
                          <IconButton size="small" onClick={() => openEditType(rt)}>
                            <EditIcon sx={{ fontSize: 15, color: C.ink3 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('common:actions.delete')}>
                          <IconButton size="small" onClick={() => setTypeDeleteTarget(rt)}>
                            <DeleteIcon sx={{ fontSize: 15, color: C.rose }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            </Box>

            <Collapse in={open} unmountOnExit>
              <Box sx={{ p: '16px 18px 18px', bgcolor: C.surface2 }}>
                {total === 0 && !isType && (
                  <Box sx={{ p: 3, textAlign: 'center', color: C.ink3, bgcolor: C.surface, border: `1.5px dashed ${C.borderHi}`, borderRadius: '11px' }}>
                    {g.kind === 'floor' ? t('config.noRoomsInFloor') : t('config.noRoomsInGroup')}
                  </Box>
                )}
                {(total > 0 || isType) && (
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
                      gap: 1.25,
                    }}
                  >
                    {g.items.map((r) => (
                      <RoomCard key={r.id} room={r} />
                    ))}
                    {isType && rt && canEdit && (
                      <Box
                        onClick={() => openAddRoom(rt)}
                        sx={{
                          border: `1.5px dashed ${C.borderHi}`,
                          borderRadius: '11px',
                          minHeight: 84,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 1,
                          fontSize: 12.5,
                          fontWeight: 600,
                          color: C.ink3,
                          cursor: 'pointer',
                          transition: 'all 120ms',
                          '&:hover': { borderColor: C.emerald, color: C.emerald, bgcolor: C.emeraldSoft },
                        }}
                      >
                        <AddIcon sx={{ fontSize: 16 }} /> {t('config.addRoom')}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            </Collapse>
          </Box>
        );
      })}
      {/* ---------- Room Type Drawer ---------- */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        slotProps={{
          paper: { sx: { width: 'min(580px, 100vw)' } }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '16px 22px', borderBottom: `1px solid ${C.border}` }}>
          <Box sx={{ width: 36, height: 36, borderRadius: '9px', bgcolor: C.emeraldSoft, color: C.emerald, display: 'grid', placeItems: 'center' }}>
            <BedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
              {editingType ? t('config.drawerEditTitle') : t('config.newRoomType')}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: C.ink3 }}>
              {editingType ? t('config.drawerEditing', { name: typeForm.name }) : t('config.drawerNewSubtitle')}
            </Typography>
          </Box>
          <IconButton sx={{ ml: 'auto' }} onClick={() => setDrawerOpen(false)} aria-label={t('common:actions.close')}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box sx={{ p: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {/* Preview */}
          <Box sx={{ bgcolor: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', p: '12px 14px', mb: 2 }}>
            <Typography sx={{ fontSize: 10.5, color: C.ink3, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', mb: 1 }}>
              {t('config.preview')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box sx={{ width: 38, height: 38, borderRadius: '9px', bgcolor: C.emeraldSoft, color: C.emeraldDeep, display: 'grid', placeItems: 'center', border: `1px solid color-mix(in srgb, ${C.emerald} 18%, transparent)` }}>
                <BedIcon sx={{ fontSize: 18 }} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                  {typeForm.name || t('config.previewNamePlaceholder')}
                  {typeForm.code && (
                    <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, bgcolor: C.surface3, color: C.ink2, px: 0.75, py: 0.125, borderRadius: '5px', ml: 0.75 }}>
                      {typeForm.code.toUpperCase()}
                    </Box>
                  )}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: C.ink3, mt: 0.25 }}>
                  {t('config.previewSummary', { beds: typeForm.bed_count, bedType: typeForm.bed_type, occupancy: typeForm.max_occupancy })}
                  {typeForm.allows_extra_bed ? t('config.previewExtraBed') : ''}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
                {formatCurrency(toMoneyNumber(typeForm.base_price))}
              </Typography>
            </Box>
          </Box>

          <SectionHeader>{t('config.secBasics')}</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
            <TextField
              size="small"
              label={t('common:field.name')}
              required
              value={typeForm.name}
              onChange={(e) => setTF({ name: e.target.value })}
              placeholder={t('config.namePlaceholder')}
            />
            <TextField
              size="small"
              label={t('config.shortCode')}
              required
              value={typeForm.code}
              onChange={(e) => setTF({ code: e.target.value.toUpperCase() })}
              placeholder="DLX"
              helperText={t('config.shortCodeHelper')}
              slotProps={{
                htmlInput: { maxLength: 10, style: { textTransform: 'uppercase' } }
              }}
            />
          </Box>
          <TextField
            size="small"
            fullWidth
            label={t('common:field.description')}
            multiline
            rows={2}
            value={typeForm.description}
            onChange={(e) => setTF({ description: e.target.value })}
            placeholder={t('config.descPlaceholder')}
            sx={{ mt: 1.5 }}
          />

          <SectionHeader>{t('config.secBedSetup')}</SectionHeader>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.borderHi}`, borderRadius: '8px', overflow: 'hidden' }}>
              <IconButton size="small" onClick={() => setTF({ bed_count: Math.max(1, typeForm.bed_count - 1) })} aria-label={t('config.decreaseBeds')}>
                <MinusIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <Box sx={{ minWidth: 36, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{typeForm.bed_count}</Box>
              <IconButton size="small" onClick={() => setTF({ bed_count: typeForm.bed_count + 1 })} aria-label={t('config.increaseBeds')}>
                <PlusIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            <TextField
              size="small"
              select
              fullWidth
              label={t('fields.bedType')}
              value={typeForm.bed_type}
              onChange={(e) => setTF({ bed_type: e.target.value })}
            >
              {BED_TYPES.map((b) => (
                <MenuItem key={b} value={b}>
                  {b}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <SectionHeader>{t('config.secCapacity')}</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, alignItems: 'start' }}>
            <Box>
              <TextField
                size="small"
                fullWidth
                label={t('fields.maxOccupancy')}
                type="number"
                value={typeForm.max_occupancy}
                onChange={(e) => setTF({ max_occupancy: Number(e.target.value) || 1 })}
                slotProps={{
                  htmlInput: { min: 1, max: 10 }
                }}
              />
              <Typography sx={{ fontSize: 11, color: C.ink3, mt: 0.5 }}>
                {t('config.suggestedFromBeds')} <b>{occupancySuggested}</b>{' '}
                {Number(typeForm.max_occupancy) !== occupancySuggested && occupancySuggested > 0 && (
                  <Button size="small" sx={{ minWidth: 0, py: 0, fontSize: 11 }} onClick={() => setTF({ max_occupancy: occupancySuggested })}>
                    {t('config.use')}
                  </Button>
                )}
              </Typography>
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={typeForm.allows_extra_bed}
                  onChange={(e) =>
                    setTF({
                      allows_extra_bed: e.target.checked,
                      max_extra_beds: e.target.checked ? typeForm.max_extra_beds || 1 : 0,
                    })
                  }
                />
              }
              label={t('config.extraBedAllowed')}
            />
          </Box>
          {typeForm.allows_extra_bed && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mt: 1.5 }}>
              <TextField
                size="small"
                label={t('config.maxExtraBeds')}
                type="number"
                value={typeForm.max_extra_beds}
                onChange={(e) => setTF({ max_extra_beds: Number(e.target.value) || 0 })}
                slotProps={{
                  htmlInput: { min: 1, max: 5 }
                }}
              />
              <TextField
                size="small"
                label={t('config.extraBedFee')}
                type="number"
                value={typeForm.extra_bed_charge}
                onChange={(e) => setTF({ extra_bed_charge: e.target.value ? toMoneyNumber(e.target.value) : '' })}
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
                }}
              />
            </Box>
          )}

          <SectionHeader>{t('config.secPricing')}</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 1.25 }}>
            <TextField
              size="small"
              label={t('config.rateBase')}
              required
              type="number"
              value={typeForm.base_price}
              onChange={(e) => setTF({ base_price: e.target.value ? toMoneyNumber(e.target.value) : '' })}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
              }}
            />
            <TextField
              size="small"
              label={t('config.rateWeekday')}
              type="number"
              value={typeForm.weekday_rate}
              onChange={(e) => setTF({ weekday_rate: e.target.value ? toMoneyNumber(e.target.value) : '' })}
              placeholder={t('config.rateBase')}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
              }}
            />
            <TextField
              size="small"
              label={t('config.rateWeekend')}
              type="number"
              value={typeForm.weekend_rate}
              onChange={(e) => setTF({ weekend_rate: e.target.value ? toMoneyNumber(e.target.value) : '' })}
              placeholder={t('config.rateBase')}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
              }}
            />
          </Box>

          <SectionHeader>{t('common:field.status')}</SectionHeader>
          <FormControlLabel
            control={<Switch checked={typeForm.is_active} onChange={(e) => setTF({ is_active: e.target.checked })} />}
            label={typeForm.is_active ? t('config.bookableLabel') : t('config.hiddenLabel')}
          />
          <TextField
            size="small"
            fullWidth
            label={t('config.sortOrder')}
            type="number"
            value={typeForm.sort_order}
            onChange={(e) => setTF({ sort_order: Number(e.target.value) || 0 })}
            helperText={t('config.sortOrderHelper')}
            sx={{ mt: 1.5 }}
          />

          <SectionHeader>{t('config.secPhotos')}</SectionHeader>
          {editingType ? (
            <>
              {(editingType.images ?? []).length > 0 && (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
                  {(editingType.images ?? []).map((url, index) => (
                    <Box
                      key={url}
                      sx={{
                        position: 'relative',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: `1px solid ${C.border}`,
                        aspectRatio: '4/3',
                        bgcolor: C.surface3,
                      }}
                    >
                      <Box
                        component="img"
                        src={url.startsWith('/') ? apiUrl(url) : url}
                        alt={t('config.photoAlt', { name: typeForm.name || t('config.previewNamePlaceholder'), index: index + 1 })}
                        sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                      {index === 0 && (
                        <Box
                          component="span"
                          sx={{
                            position: 'absolute',
                            top: 6,
                            left: 6,
                            fontSize: 9.5,
                            fontWeight: 700,
                            letterSpacing: '0.4px',
                            bgcolor: 'rgba(0,0,0,0.65)',
                            color: '#fff',
                            px: 0.75,
                            py: 0.25,
                            borderRadius: '5px',
                          }}
                        >
                          {t('config.coverBadge')}
                        </Box>
                      )}
                      <IconButton
                        size="small"
                        aria-label={t('config.removePhotoAria', { index: index + 1 })}
                        disabled={photoBusy}
                        onClick={() => handleRemoveTypePhoto(url)}
                        sx={{
                          position: 'absolute',
                          top: 4,
                          right: 4,
                          width: 22,
                          height: 22,
                          bgcolor: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          '&:hover': { bgcolor: 'rgba(0,0,0,0.85)' },
                        }}
                      >
                        <CloseIcon sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              )}
              <Button
                component="label"
                variant="outlined"
                size="small"
                disabled={photoBusy}
                startIcon={photoBusy ? <CircularProgress size={14} /> : <AddPhotoIcon />}
                sx={{ mt: 1.25, textTransform: 'none', borderColor: C.borderHi, color: C.ink2 }}
              >
                {photoBusy ? t('config.uploading') : t('config.uploadPhoto')}
                <input
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleUploadTypePhoto}
                />
              </Button>
              <Typography sx={{ fontSize: 11, color: C.ink3, mt: 0.75 }}>
                {t('config.photoHint')}
              </Typography>
            </>
          ) : (
            <Alert severity="info" sx={{ fontSize: 12 }}>
              {t('config.photoSaveFirst')}
            </Alert>
          )}
        </Box>

        <Box sx={{ p: '14px 22px', borderTop: `1px solid ${C.border}`, bgcolor: C.surface2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
          {editingType && (
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => {
                setTypeDeleteTarget(editingType);
                setDrawerOpen(false);
              }}
              sx={{ textTransform: 'none' }}
            >
              {t('common:actions.delete')}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDrawerOpen(false)} sx={{ textTransform: 'none' }}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!canSaveType || formLoading}
            onClick={handleSaveType}
            startIcon={formLoading ? <CircularProgress size={16} /> : <CheckIcon />}
            sx={{ bgcolor: C.emerald, textTransform: 'none', '&:hover': { bgcolor: C.emeraldDeep } }}
          >
            {editingType ? t('config.saveChanges') : t('config.createRoomType')}
          </Button>
        </Box>
      </Drawer>
      {/* ---------- Add Room dialog ---------- */}
      <Dialog open={!!addingRoomFor} onClose={() => setAddingRoomFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('config.addRoomTitle', { name: addingRoomFor?.name ?? '' })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              autoFocus
              label={t('fields.roomNumber')}
              required
              value={roomForm.room_number}
              onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
              helperText={t('config.roomNumberHelper')}
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label={t('fields.floor')}
                type="number"
                value={roomForm.floor}
                onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value ? Number(e.target.value) : '' })}
                slotProps={{
                  htmlInput: { min: 0 }
                }}
              />
              <TextField
                label={t('fields.customPrice')}
                type="number"
                value={roomForm.custom_price}
                onChange={(e) => setRoomForm({ ...roomForm, custom_price: e.target.value ? toMoneyNumber(e.target.value) : '' })}
                helperText={addingRoomFor ? t('config.basePriceHelper', { price: formatCurrency(toMoneyNumber(addingRoomFor.base_price)) }) : ''}
                slotProps={{
                  input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
                }}
              />
            </Box>
            <TextField
              label={t('fields.building')}
              value={roomForm.building}
              onChange={(e) => setRoomForm({ ...roomForm, building: e.target.value })}
              helperText={t('common:field.optional')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={roomForm.is_accessible}
                  onChange={(e) => setRoomForm({ ...roomForm, is_accessible: e.target.checked })}
                />
              }
              label={t('config.wheelchair')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={roomForm.is_smoking}
                  onChange={(e) => setRoomForm({ ...roomForm, is_smoking: e.target.checked })}
                />
              }
              label={t('config.smokingRoom')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddingRoomFor(null)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleCreateRoom}
            disabled={!roomForm.room_number.trim() || formLoading}
            sx={{ bgcolor: C.emerald, '&:hover': { bgcolor: C.emeraldDeep } }}
          >
            {formLoading ? <CircularProgress size={20} /> : t('config.addRoomSubmit')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ---------- Edit Room dialog ---------- */}
      <Dialog open={!!editingRoom} onClose={() => setEditingRoom(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('config.editRoomTitle', { room: editingRoom?.room_number ?? '' })}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              label={t('fields.roomNumber')}
              value={roomForm.room_number}
              onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
            />
            <TextField
              label={t('fields.customPrice')}
              type="number"
              value={roomForm.custom_price}
              onChange={(e) => setRoomForm({ ...roomForm, custom_price: e.target.value ? toMoneyNumber(e.target.value) : '' })}
              helperText={t('config.customPriceHelper')}
              slotProps={{
                input: { startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }
              }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={roomForm.is_smoking}
                  onChange={(e) => setRoomForm({ ...roomForm, is_smoking: e.target.checked })}
                />
              }
              label={t('config.smokingRoom')}
            />
            <Alert severity="info">
              {t('config.immutableHint')}
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRoom(null)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleUpdateRoom}
            disabled={formLoading}
            sx={{ bgcolor: C.emerald, '&:hover': { bgcolor: C.emeraldDeep } }}
          >
            {formLoading ? <CircularProgress size={20} /> : t('config.saveChanges')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ---------- Delete Room ---------- */}
      <Dialog open={!!deletingRoom} onClose={() => setDeletingRoom(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('config.deleteRoomTitle')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('config.deleteRoomConfirmPre')}<strong>{deletingRoom?.room_number}</strong>{t('config.deleteRoomConfirmPost')}
          </Alert>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('config.deleteRoomBody')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingRoom(null)}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteRoom} disabled={formLoading}>
            {formLoading ? <CircularProgress size={20} /> : t('config.deleteRoomTitle')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* ---------- Delete Room Type ---------- */}
      <Dialog open={!!typeDeleteTarget} onClose={() => setTypeDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('config.deleteTypeTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('config.deleteTypeConfirmPre')}<strong>{typeDeleteTarget?.name}</strong>{t('config.deleteTypeConfirmPost')}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mt: 1
            }}>
            {t('config.deleteTypeBody')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTypeDeleteTarget(null)}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteType} disabled={formLoading}>
            {formLoading ? <CircularProgress size={20} /> : t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const SectionHeader: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, m: '18px 0 10px' }}>
    <Typography sx={{ fontSize: 11, fontWeight: 700, color: C.ink3, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
      {children}
    </Typography>
    <Box sx={{ flex: 1, height: '1px', bgcolor: C.border }} />
  </Box>
);

export default RoomConfigurationPage;
