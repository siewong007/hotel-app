import React, { useEffect, useMemo, useState } from 'react';
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
  RemoveCircleOutline as MinusIcon,
  AddCircleOutline as PlusIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { Room, RoomType, RoomTypeCreateInput, RoomTypeUpdateInput } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { useCurrency } from '../../../hooks/useCurrency';
import { toNumber } from '../../../utils/currency';
import { emitApiNotification } from '../../../utils/apiNotifications';

/* ---------- Design tokens (Salim Inn · Room Configuration) ---------- */
const C = {
  surface: '#FFFFFF',
  surface2: '#F8FAFB',
  surface3: '#EFF2F5',
  border: '#E2E6EC',
  borderHi: '#CBD2DA',
  ink: '#0F172A',
  ink2: '#475569',
  ink3: '#7B8794',
  emerald: '#10A47C',
  emeraldDeep: '#0E8C6A',
  emeraldDarker: '#0B6A50',
  emeraldSoft: '#E7F5EF',
  blue: '#2F7DE1',
  blueSoft: '#E8F1FB',
  amber: '#C8941D',
  amberSoft: '#FBF1DC',
  rose: '#D14256',
  roseSoft: '#FCE8EC',
  slateSoft: '#F0F3F7',
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
}

const emptyRoomForm: RoomFormData = {
  room_number: '',
  floor: '',
  building: '',
  custom_price: '',
  is_accessible: false,
};

const RoomConfigurationPage: React.FC = () => {
  const { hasRole, hasPermission } = useAuth();
  const { format: formatCurrency, symbol: currencySymbol } = useCurrency();
  const hasAccess =
    hasRole('admin') ||
    hasRole('receptionist') ||
    hasRole('manager') ||
    hasPermission('rooms:read') ||
    hasPermission('rooms:manage');
  const canEdit =
    hasRole('admin') ||
    hasRole('manager') ||
    hasPermission('rooms:write') ||
    hasPermission('rooms:manage');

  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (hasAccess) loadData();
  }, [hasAccess]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [roomsData, typesData] = await Promise.all([
        HotelAPIService.getAllRooms(),
        HotelAPIService.getAllRoomTypes(),
      ]);
      setRooms(roomsData);
      setRoomTypes([...typesData].sort((a, b) => a.sort_order - b.sort_order));
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

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
      base_price: toNumber(t.base_price),
      weekday_rate: t.weekday_rate ? toNumber(t.weekday_rate) : '',
      weekend_rate: t.weekend_rate ? toNumber(t.weekend_rate) : '',
      max_occupancy: t.max_occupancy,
      bed_type: t.bed_type || 'Queen',
      bed_count: t.bed_count || 1,
      allows_extra_bed: t.allows_extra_bed,
      max_extra_beds: t.max_extra_beds,
      extra_bed_charge: t.extra_bed_charge ? toNumber(t.extra_bed_charge) : '',
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
        base_price: Number(typeForm.base_price),
        weekday_rate: typeForm.weekday_rate ? Number(typeForm.weekday_rate) : undefined,
        weekend_rate: typeForm.weekend_rate ? Number(typeForm.weekend_rate) : undefined,
        max_occupancy: Number(typeForm.max_occupancy) || 1,
        bed_type: typeForm.bed_type,
        bed_count: Number(typeForm.bed_count) || 1,
        allows_extra_bed: typeForm.allows_extra_bed,
        max_extra_beds: typeForm.allows_extra_bed ? typeForm.max_extra_beds : 0,
        extra_bed_charge:
          typeForm.allows_extra_bed && typeForm.extra_bed_charge
            ? Number(typeForm.extra_bed_charge)
            : 0,
        sort_order: Number(typeForm.sort_order) || 0,
      };
      if (editingType) {
        const input: RoomTypeUpdateInput = { ...base, is_active: typeForm.is_active };
        await HotelAPIService.updateRoomType(editingType.id, input);
        emitApiNotification({ message: 'Room type updated successfully', severity: 'success' });
      } else {
        const input: RoomTypeCreateInput = base;
        await HotelAPIService.createRoomType(input);
        emitApiNotification({ message: 'Room type created successfully', severity: 'success' });
      }
      setDrawerOpen(false);
      setEditingType(null);
      await loadData();
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
        if (msg.includes('room_types_name_key')) {
          emitApiNotification({ message: `A room type named "${typeForm.name}" already exists.`, severity: 'error' });
        } else if (msg.includes('room_types_code_key')) {
          emitApiNotification({ message: `Room type code "${typeForm.code.toUpperCase()}" already exists.`, severity: 'error' });
        } else {
          emitApiNotification({ message: 'A room type with this name or code already exists.', severity: 'error' });
        }
      } else {
        emitApiNotification({ message: msg || 'Failed to save room type', severity: 'error' });
      }
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleTypeActive = async (t: RoomType) => {
    try {
      await HotelAPIService.updateRoomType(t.id, { is_active: !t.is_active });
      emitApiNotification({
        message: `Room type ${t.is_active ? 'hidden from booking' : 'made bookable'}`,
        severity: 'success',
      });
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to update room type', severity: 'error' });
    }
  };

  const handleDuplicateType = async (t: RoomType) => {
    try {
      const input: RoomTypeCreateInput = {
        name: `${t.name} (Copy)`,
        code: `${t.code}2`.slice(0, 10),
        description: t.description || undefined,
        base_price: toNumber(t.base_price),
        weekday_rate: t.weekday_rate ? toNumber(t.weekday_rate) : undefined,
        weekend_rate: t.weekend_rate ? toNumber(t.weekend_rate) : undefined,
        max_occupancy: t.max_occupancy,
        bed_type: t.bed_type,
        bed_count: t.bed_count,
        allows_extra_bed: t.allows_extra_bed,
        max_extra_beds: t.max_extra_beds,
        extra_bed_charge: toNumber(t.extra_bed_charge),
        sort_order: t.sort_order + 1,
      };
      await HotelAPIService.createRoomType(input);
      emitApiNotification({ message: 'Room type duplicated', severity: 'success' });
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to duplicate', severity: 'error' });
    }
  };

  const handleDeleteType = async () => {
    if (!typeDeleteTarget) return;
    try {
      setFormLoading(true);
      await HotelAPIService.deleteRoomType(typeDeleteTarget.id);
      emitApiNotification({ message: 'Room type deleted', severity: 'success' });
      setTypeDeleteTarget(null);
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to delete room type', severity: 'error' });
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
    const price = toNumber(r.price_per_night);
    setRoomForm({
      room_number: r.room_number,
      floor: r.floor ?? '',
      building: '',
      custom_price: t && price === toNumber(t.base_price) ? '' : price,
      is_accessible: false,
    });
  };

  const handleCreateRoom = async () => {
    if (!addingRoomFor || !roomForm.room_number.trim()) return;
    try {
      setFormLoading(true);
      const t = addingRoomFor;
      const price =
        roomForm.custom_price !== '' ? Number(roomForm.custom_price) : toNumber(t.base_price);
      await HotelAPIService.createRoom({
        room_number: roomForm.room_number.trim(),
        room_type: t.name,
        room_type_id: t.id,
        price_per_night: price,
        max_occupancy: t.max_occupancy,
        floor: roomForm.floor === '' ? 1 : Number(roomForm.floor),
        building: roomForm.building || undefined,
        custom_price: roomForm.custom_price !== '' ? Number(roomForm.custom_price) : undefined,
        is_accessible: roomForm.is_accessible,
      });
      emitApiNotification({ message: 'Room created successfully', severity: 'success' });
      setAddingRoomFor(null);
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to create room', severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateRoom = async () => {
    if (!editingRoom) return;
    try {
      setFormLoading(true);
      await HotelAPIService.updateRoom(editingRoom.id, {
        room_number: roomForm.room_number,
        price_per_night:
          roomForm.custom_price !== '' ? (Number(roomForm.custom_price) as any) : undefined,
        available: editingRoom.available,
      });
      emitApiNotification({ message: 'Room updated successfully', severity: 'success' });
      setEditingRoom(null);
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to update room', severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleRoomStatus = async (r: Room) => {
    try {
      await HotelAPIService.updateRoom(r.id, { available: !r.available });
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to update room', severity: 'error' });
    }
  };

  const handleDeleteRoom = async () => {
    if (!deletingRoom) return;
    try {
      setFormLoading(true);
      await HotelAPIService.deleteRoom(deletingRoom.id as unknown as number);
      emitApiNotification({ message: 'Room deleted successfully', severity: 'success' });
      setDeletingRoom(null);
      await loadData();
    } catch (err: any) {
      emitApiNotification({ message: err?.message || 'Failed to delete room', severity: 'error' });
    } finally {
      setFormLoading(false);
    }
  };

  if (!hasAccess) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          You do not have permission to access this page. Contact your administrator for access.
        </Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
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
        color: active ? '#fff' : C.ink2,
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
          bgcolor: active ? 'rgba(255,255,255,0.22)' : C.surface3,
          color: active ? '#fff' : C.ink3,
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
    const t = typeByName[room.room_type];
    const st = roomStatus(room);
    const price = toNumber(room.price_per_night);
    const isCustom = !!t && price !== toNumber(t.base_price);
    return (
      <Box
        sx={{
          position: 'relative',
          bgcolor: '#fff',
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
            boxShadow: '0 2px 6px rgba(15,23,42,0.05)',
            transform: 'translateY(-1px)',
          },
          '&:hover .rc-actions': { display: 'flex' },
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
        {canEdit && (
          <Box className="rc-actions" sx={{ position: 'absolute', top: 6, right: 6, display: 'none', gap: 0.5 }}>
            <Tooltip title="Toggle availability">
              <IconButton
                size="small"
                onClick={() => handleToggleRoomStatus(room)}
                sx={{ width: 24, height: 24, border: `1px solid ${C.border}`, bgcolor: '#fff' }}
              >
                <ActiveIcon sx={{ fontSize: 13, color: statusColor[st] }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Edit room">
              <IconButton
                size="small"
                onClick={() => openEditRoom(room)}
                sx={{ width: 24, height: 24, border: `1px solid ${C.border}`, bgcolor: '#fff' }}
              >
                <EditIcon sx={{ fontSize: 13, color: C.ink3 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete room">
              <IconButton
                size="small"
                onClick={() => setDeletingRoom(room)}
                sx={{ width: 24, height: 24, border: `1px solid ${C.border}`, bgcolor: '#fff' }}
              >
                <DeleteIcon sx={{ fontSize: 13, color: C.rose }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
          <Typography sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1 }}>
            {room.room_number}
            {room.floor != null && (
              <Box component="span" sx={{ fontSize: 10, fontWeight: 600, color: C.ink3, ml: 0.5 }}>
                · F{room.floor}
              </Box>
            )}
          </Typography>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: statusColor[st],
              border: '2px solid #fff',
              boxShadow: `0 0 0 1px ${statusColor[st]}99`,
            }}
            title={st}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: 11, color: C.ink3 }}>
          <span>{t?.code || room.room_type || '—'}</span>
          <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: C.ink3 }} />
          <span>{bedSummary(t)}</span>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75, mt: 0.25 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: isCustom ? C.blue : C.ink }}>
            {formatCurrency(price)}
          </Typography>
          {isCustom && (
            <Chip
              label="Custom"
              size="small"
              sx={{ height: 18, fontSize: 9.5, fontWeight: 700, bgcolor: '#FDF1E0', color: C.amber }}
            />
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1480, mx: 'auto' }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 2.25 }}>
        <Box>
          <Box sx={{ fontSize: 11.5, color: C.ink3, fontWeight: 500, letterSpacing: '0.3px', display: 'flex', gap: 0.75, mb: 0.75 }}>
            <span>Configuration</span>
            <span style={{ color: C.borderHi }}>›</span>
            <span style={{ color: C.ink2, fontWeight: 600 }}>Rooms</span>
          </Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <DoorIcon sx={{ fontSize: 24 }} />
            Rooms
          </Typography>
          <Typography sx={{ fontSize: 13, color: C.ink3, mt: 0.5 }}>
            Manage room types and individual rooms in one place.
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
            New Room Type
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
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
        <StatCard label="Total Rooms" value={counts.total} />
        <StatCard
          label="Available"
          value={counts.avail}
          color={C.emerald}
          delta={`${counts.total ? Math.round((counts.avail / counts.total) * 100) : 0}% of stock`}
        />
        <StatCard label="Unavailable" value={counts.unav} color={C.rose} />
        <StatCard label="Maintenance" value={counts.maint} color={C.amber} />
        <StatCard label="Room Types" value={counts.types} color={C.blue} />
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search room number, type or floor…"
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: C.ink3 }} />
              </InputAdornment>
            ),
          }}
          sx={{ minWidth: 280, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: '9px' } }}
        />
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          <StatusChip active={statusFilter === 'all'} label="All" count={counts.total} onClick={() => setStatusFilter('all')} />
          <StatusChip active={statusFilter === 'available'} label="Available" count={counts.avail} onClick={() => setStatusFilter('available')} />
          <StatusChip active={statusFilter === 'unavailable'} label="Unavailable" count={counts.unav} onClick={() => setStatusFilter('unavailable')} />
          <StatusChip active={statusFilter === 'maintenance'} label="Maintenance" count={counts.maint} onClick={() => setStatusFilter('maintenance')} />
        </Box>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={groupBy}
          onChange={(_, v) => v && setGroupBy(v)}
          sx={{
            bgcolor: '#fff',
            '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 600, fontSize: 12, px: 1.5, gap: 0.75 },
            '& .Mui-selected': { bgcolor: `${C.ink} !important`, color: '#fff !important' },
          }}
        >
          <ToggleButton value="type">
            <LayersIcon sx={{ fontSize: 15 }} /> By type
          </ToggleButton>
          <ToggleButton value="floor">
            <BuildingIcon sx={{ fontSize: 15 }} /> By floor
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Groups */}
      {groups.length === 0 && (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            color: C.ink3,
            bgcolor: '#fff',
            border: `1.5px dashed ${C.borderHi}`,
            borderRadius: '11px',
          }}
        >
          <SearchIcon sx={{ fontSize: 22 }} />
          <Typography sx={{ mt: 1 }}>No rooms match the current filter.</Typography>
        </Box>
      )}

      {groups.map((g) => {
        const isType = g.kind === 'type';
        const t = isType ? g.type : null;
        const total = g.items.length;
        const avail = g.items.filter((r) => roomStatus(r) === 'available').length;
        const ratio = total ? (avail / total) * 100 : 0;
        const open = !collapsed[g.key];
        const title =
          g.kind === 'type'
            ? g.type.name
            : g.kind === 'floor'
            ? `Floor ${g.floor}`
            : 'Unassigned type';

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
                    border: `1px solid ${C.emerald}29`,
                  }}
                >
                  {isType ? <BedIcon /> : <BuildingIcon />}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Typography sx={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {title}
                    </Typography>
                    {t && (
                      <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, fontWeight: 700, bgcolor: C.surface3, color: C.ink2, px: 0.875, py: 0.25, borderRadius: '5px' }}>
                        {t.code}
                      </Box>
                    )}
                    {t && !t.is_active && (
                      <Box component="span" sx={{ fontSize: 10.5, fontWeight: 700, bgcolor: C.amberSoft, color: C.amber, px: 0.875, py: 0.25, borderRadius: '5px' }}>
                        HIDDEN
                      </Box>
                    )}
                    {t && (
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'baseline',
                          gap: 0.5,
                          bgcolor: C.emeraldSoft,
                          border: `1px solid ${C.emerald}33`,
                          color: C.emeraldDarker,
                          px: 1.125,
                          py: 0.5,
                          borderRadius: '7px',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        {formatCurrency(toNumber(t.base_price))}
                        <Box component="span" sx={{ color: C.ink3, fontWeight: 500, ml: 0.25 }}>
                          /night
                        </Box>
                      </Box>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, fontSize: 12, color: C.ink3, mt: 0.5, flexWrap: 'wrap' }}>
                    {t ? (
                      <>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                          <BedIcon sx={{ fontSize: 13 }} />
                          <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>{bedSummary(t)}</Box>
                        </Box>
                        <span style={{ color: C.borderHi }}>·</span>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                          <PeopleIcon sx={{ fontSize: 13 }} /> Sleeps{' '}
                          <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>{t.max_occupancy}</Box>
                        </Box>
                        {t.allows_extra_bed && (
                          <>
                            <span style={{ color: C.borderHi }}>·</span>
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                              <AddIcon sx={{ fontSize: 12 }} /> Extra bed{' '}
                              <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>
                                {formatCurrency(toNumber(t.extra_bed_charge))}
                              </Box>
                            </Box>
                          </>
                        )}
                      </>
                    ) : (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                        <Box component="span" sx={{ color: C.ink2, fontWeight: 600 }}>{total}</Box> rooms
                      </Box>
                    )}
                  </Box>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                <Box sx={{ textAlign: 'right' }}>
                  <Box sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
                    <Box component="span" sx={{ color: C.emerald }}>{avail}</Box>
                    <Box component="span" sx={{ color: C.ink3, fontWeight: 500 }}>/{total}</Box>
                  </Box>
                  <Typography sx={{ fontSize: 10.5, color: C.ink3, fontWeight: 600, letterSpacing: '0.4px', textTransform: 'uppercase', mt: 0.5 }}>
                    Available
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
                {isType && t && canEdit && (
                  <Box sx={{ display: 'flex', gap: 0.5, ml: 1 }}>
                    <Tooltip title={t.is_active ? 'Hide from booking' : 'Show in booking'}>
                      <IconButton size="small" onClick={() => handleToggleTypeActive(t)}>
                        {t.is_active ? <ActiveIcon sx={{ fontSize: 16, color: C.emerald }} /> : <InactiveIcon sx={{ fontSize: 16, color: C.amber }} />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Duplicate">
                      <IconButton size="small" onClick={() => handleDuplicateType(t)}>
                        <CopyIcon sx={{ fontSize: 15, color: C.ink3 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEditType(t)}>
                        <EditIcon sx={{ fontSize: 15, color: C.ink3 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => setTypeDeleteTarget(t)}>
                        <DeleteIcon sx={{ fontSize: 15, color: C.rose }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
              </Box>
            </Box>

            <Collapse in={open} unmountOnExit>
              <Box sx={{ p: '16px 18px 18px', bgcolor: C.surface2 }}>
                {total === 0 && !isType && (
                  <Box sx={{ p: 3, textAlign: 'center', color: C.ink3, bgcolor: '#fff', border: `1.5px dashed ${C.borderHi}`, borderRadius: '11px' }}>
                    No rooms in this {g.kind === 'floor' ? 'floor' : 'group'} yet.
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
                    {isType && t && canEdit && (
                      <Box
                        onClick={() => openAddRoom(t)}
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
                        <AddIcon sx={{ fontSize: 16 }} /> Add room
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
        PaperProps={{ sx: { width: 'min(580px, 100vw)' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: '16px 22px', borderBottom: `1px solid ${C.border}` }}>
          <Box sx={{ width: 36, height: 36, borderRadius: '9px', bgcolor: C.emeraldSoft, color: C.emerald, display: 'grid', placeItems: 'center' }}>
            <BedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
              {editingType ? 'Edit Room Type' : 'New Room Type'}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: C.ink3 }}>
              {editingType ? `Editing ${typeForm.name}` : 'Define a reusable room template'}
            </Typography>
          </Box>
          <IconButton sx={{ ml: 'auto' }} onClick={() => setDrawerOpen(false)}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box sx={{ p: '18px 22px', overflowY: 'auto', flex: 1 }}>
          {/* Preview */}
          <Box sx={{ bgcolor: C.surface2, border: `1px solid ${C.border}`, borderRadius: '10px', p: '12px 14px', mb: 2 }}>
            <Typography sx={{ fontSize: 10.5, color: C.ink3, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', mb: 1 }}>
              Preview
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box sx={{ width: 38, height: 38, borderRadius: '9px', bgcolor: C.emeraldSoft, color: C.emeraldDeep, display: 'grid', placeItems: 'center', border: `1px solid ${C.emerald}2E` }}>
                <BedIcon sx={{ fontSize: 18 }} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                  {typeForm.name || 'Room Type Name'}
                  {typeForm.code && (
                    <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700, bgcolor: C.surface3, color: C.ink2, px: 0.75, py: 0.125, borderRadius: '5px', ml: 0.75 }}>
                      {typeForm.code.toUpperCase()}
                    </Box>
                  )}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: C.ink3, mt: 0.25 }}>
                  {typeForm.bed_count}× {typeForm.bed_type} · Sleeps {typeForm.max_occupancy}
                  {typeForm.allows_extra_bed ? ' + extra bed' : ''}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>
                {formatCurrency(Number(typeForm.base_price) || 0)}
              </Typography>
            </Box>
          </Box>

          <SectionHeader>Basics</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
            <TextField
              size="small"
              label="Name"
              required
              value={typeForm.name}
              onChange={(e) => setTF({ name: e.target.value })}
              placeholder="e.g. Deluxe King"
            />
            <TextField
              size="small"
              label="Short Code"
              required
              value={typeForm.code}
              onChange={(e) => setTF({ code: e.target.value.toUpperCase() })}
              placeholder="DLX"
              inputProps={{ maxLength: 10, style: { textTransform: 'uppercase' } }}
              helperText="2–10 letters, used in reports"
            />
          </Box>
          <TextField
            size="small"
            fullWidth
            label="Description"
            multiline
            rows={2}
            value={typeForm.description}
            onChange={(e) => setTF({ description: e.target.value })}
            placeholder="One-liner for staff and guests…"
            sx={{ mt: 1.5 }}
          />

          <SectionHeader>Bed Setup</SectionHeader>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', border: `1px solid ${C.borderHi}`, borderRadius: '8px', overflow: 'hidden' }}>
              <IconButton size="small" onClick={() => setTF({ bed_count: Math.max(1, typeForm.bed_count - 1) })}>
                <MinusIcon sx={{ fontSize: 18 }} />
              </IconButton>
              <Box sx={{ minWidth: 36, textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{typeForm.bed_count}</Box>
              <IconButton size="small" onClick={() => setTF({ bed_count: typeForm.bed_count + 1 })}>
                <PlusIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            <TextField
              size="small"
              select
              fullWidth
              label="Bed Type"
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

          <SectionHeader>Capacity</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, alignItems: 'start' }}>
            <Box>
              <TextField
                size="small"
                fullWidth
                label="Max Occupancy"
                type="number"
                value={typeForm.max_occupancy}
                onChange={(e) => setTF({ max_occupancy: Number(e.target.value) || 1 })}
                inputProps={{ min: 1, max: 10 }}
              />
              <Typography sx={{ fontSize: 11, color: C.ink3, mt: 0.5 }}>
                Suggested from beds: <b>{occupancySuggested}</b>{' '}
                {Number(typeForm.max_occupancy) !== occupancySuggested && occupancySuggested > 0 && (
                  <Button size="small" sx={{ minWidth: 0, py: 0, fontSize: 11 }} onClick={() => setTF({ max_occupancy: occupancySuggested })}>
                    Use
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
              label="Extra bed allowed"
            />
          </Box>
          {typeForm.allows_extra_bed && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, mt: 1.5 }}>
              <TextField
                size="small"
                label="Max Extra Beds"
                type="number"
                value={typeForm.max_extra_beds}
                onChange={(e) => setTF({ max_extra_beds: Number(e.target.value) || 0 })}
                inputProps={{ min: 1, max: 5 }}
              />
              <TextField
                size="small"
                label="Extra Bed Fee / Night"
                type="number"
                value={typeForm.extra_bed_charge}
                onChange={(e) => setTF({ extra_bed_charge: e.target.value ? Number(e.target.value) : '' })}
                InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
              />
            </Box>
          )}

          <SectionHeader>Pricing</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.25 }}>
            <TextField
              size="small"
              label="Base"
              required
              type="number"
              value={typeForm.base_price}
              onChange={(e) => setTF({ base_price: e.target.value ? Number(e.target.value) : '' })}
              InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
            />
            <TextField
              size="small"
              label="Weekday"
              type="number"
              value={typeForm.weekday_rate}
              onChange={(e) => setTF({ weekday_rate: e.target.value ? Number(e.target.value) : '' })}
              InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
              placeholder="Base"
            />
            <TextField
              size="small"
              label="Weekend"
              type="number"
              value={typeForm.weekend_rate}
              onChange={(e) => setTF({ weekend_rate: e.target.value ? Number(e.target.value) : '' })}
              InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
              placeholder="Base"
            />
          </Box>

          <SectionHeader>Status</SectionHeader>
          <FormControlLabel
            control={<Switch checked={typeForm.is_active} onChange={(e) => setTF({ is_active: e.target.checked })} />}
            label={typeForm.is_active ? 'Bookable — visible in booking flow' : 'Hidden — not shown to staff or guests'}
          />
          <TextField
            size="small"
            fullWidth
            label="Sort Order"
            type="number"
            value={typeForm.sort_order}
            onChange={(e) => setTF({ sort_order: Number(e.target.value) || 0 })}
            helperText="Lower numbers appear first"
            sx={{ mt: 1.5 }}
          />
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
              Delete
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDrawerOpen(false)} sx={{ textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={!canSaveType || formLoading}
            onClick={handleSaveType}
            startIcon={formLoading ? <CircularProgress size={16} /> : <CheckIcon />}
            sx={{ bgcolor: C.emerald, textTransform: 'none', '&:hover': { bgcolor: C.emeraldDeep } }}
          >
            {editingType ? 'Save Changes' : 'Create Room Type'}
          </Button>
        </Box>
      </Drawer>

      {/* ---------- Add Room dialog ---------- */}
      <Dialog open={!!addingRoomFor} onClose={() => setAddingRoomFor(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Add Room — {addingRoomFor?.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              autoFocus
              label="Room Number"
              required
              value={roomForm.room_number}
              onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
              helperText="e.g. 215"
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label="Floor"
                type="number"
                value={roomForm.floor}
                onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value ? Number(e.target.value) : '' })}
                inputProps={{ min: 0 }}
              />
              <TextField
                label={`Custom Price`}
                type="number"
                value={roomForm.custom_price}
                onChange={(e) => setRoomForm({ ...roomForm, custom_price: e.target.value ? Number(e.target.value) : '' })}
                InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
                helperText={addingRoomFor ? `Base ${formatCurrency(toNumber(addingRoomFor.base_price))}` : ''}
              />
            </Box>
            <TextField
              label="Building"
              value={roomForm.building}
              onChange={(e) => setRoomForm({ ...roomForm, building: e.target.value })}
              helperText="Optional"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={roomForm.is_accessible}
                  onChange={(e) => setRoomForm({ ...roomForm, is_accessible: e.target.checked })}
                />
              }
              label="Wheelchair accessible"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddingRoomFor(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleCreateRoom}
            disabled={!roomForm.room_number.trim() || formLoading}
            sx={{ bgcolor: C.emerald, '&:hover': { bgcolor: C.emeraldDeep } }}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Add Room'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---------- Edit Room dialog ---------- */}
      <Dialog open={!!editingRoom} onClose={() => setEditingRoom(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Room {editingRoom?.room_number}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              label="Room Number"
              value={roomForm.room_number}
              onChange={(e) => setRoomForm({ ...roomForm, room_number: e.target.value })}
            />
            <TextField
              label="Custom Price"
              type="number"
              value={roomForm.custom_price}
              onChange={(e) => setRoomForm({ ...roomForm, custom_price: e.target.value ? Number(e.target.value) : '' })}
              InputProps={{ startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment> }}
              helperText="Leave empty to use room type base price"
            />
            <Alert severity="info">
              Room type, floor, and building cannot be changed after creation. Delete and recreate the room to change these.
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRoom(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleUpdateRoom}
            disabled={formLoading}
            sx={{ bgcolor: C.emerald, '&:hover': { bgcolor: C.emeraldDeep } }}
          >
            {formLoading ? <CircularProgress size={20} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---------- Delete Room ---------- */}
      <Dialog open={!!deletingRoom} onClose={() => setDeletingRoom(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Room</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Are you sure you want to delete room <strong>{deletingRoom?.room_number}</strong>?
          </Alert>
          <Typography variant="body2" color="text.secondary">
            This cannot be undone. The room can only be deleted if it has no existing bookings.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingRoom(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDeleteRoom} disabled={formLoading}>
            {formLoading ? <CircularProgress size={20} /> : 'Delete Room'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---------- Delete Room Type ---------- */}
      <Dialog open={!!typeDeleteTarget} onClose={() => setTypeDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Room Type</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <strong>{typeDeleteTarget?.name}</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This cannot be undone. If rooms still use this type, deactivate it instead.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTypeDeleteTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDeleteType} disabled={formLoading}>
            {formLoading ? <CircularProgress size={20} /> : 'Delete'}
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
