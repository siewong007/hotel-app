import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Alert,
  CircularProgress,
  Button,
  TextField,
  InputAdornment,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Security as SecurityIcon,
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Add as AddIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  DeleteOutline as DeleteIcon,
  Check as CheckIcon,
  ChevronRight as ChevronRightIcon,
  Lock as LockIcon,
  Bolt as BoltIcon,
  People as PeopleIcon,
  ViewModule as ModulesIcon,
} from '@mui/icons-material';
import type { Permission, Role, User } from '../../../../types';
import { useRBACData } from './hooks/useRBACData';
import { UsersTab } from './UsersTab';
import { HotelAPIService } from '../../../../api';
import { emitApiNotification } from '../../../../utils/apiNotifications';

/* ---------- Salim Inn design tokens ---------- */
const T = {
  surface: '#FFFFFF',
  surface2: '#F8FAFB',
  surface3: '#EFF2F5',
  surface4: '#E6EBF0',
  border: '#E2E6EC',
  borderHi: '#CBD2DA',
  ink: '#0F172A',
  ink2: '#475569',
  ink3: '#7B8794',
  ink4: '#B0B8C2',
  emerald: '#10A47C',
  emeraldDeep: '#0E8C6A',
  emeraldDarker: '#0B6A50',
  emeraldSoft: '#E7F5EF',
  blue: '#2F7DE1',
  blueSoft: '#E8F1FB',
  blueDeep: '#1F5FB8',
  amber: '#C8941D',
  amberSoft: '#FBF1DC',
  amberDeep: '#8A6210',
  rose: '#D14256',
  roseSoft: '#FCE8EC',
  roseDeep: '#9B2A3B',
  violet: '#7A56D6',
  violetSoft: '#EDE7FA',
  violetDeep: '#5436A8',
  teal: '#1A8FA0',
  tealSoft: '#DCF1F4',
  tealDeep: '#0F6470',
  slateSoft: '#F0F3F7',
};

type Accent = { deep: string; soft: string };

const ACCENTS: Accent[] = [
  { deep: T.blueDeep, soft: T.blueSoft },
  { deep: T.emeraldDeep, soft: T.emeraldSoft },
  { deep: T.amberDeep, soft: T.amberSoft },
  { deep: T.violetDeep, soft: T.violetSoft },
  { deep: T.tealDeep, soft: T.tealSoft },
  { deep: T.rose, soft: T.roseSoft },
];

function roleAccent(role: Role): Accent {
  const n = role.name.toLowerCase();
  if (/(super|owner)/.test(n)) return { deep: T.roseDeep, soft: T.roseSoft };
  if (/admin/.test(n)) return { deep: T.rose, soft: T.roseSoft };
  if (/manager/.test(n)) return { deep: T.blueDeep, soft: T.blueSoft };
  if (/(reception|front)/.test(n)) return { deep: T.emeraldDeep, soft: T.emeraldSoft };
  if (/house/.test(n)) return { deep: T.tealDeep, soft: T.tealSoft };
  if (/guest/.test(n)) return { deep: T.violetDeep, soft: T.violetSoft };
  if (/staff/.test(n)) return { deep: T.amberDeep, soft: T.amberSoft };
  return ACCENTS[role.id % ACCENTS.length];
}

const BUILTIN = /(super\s*admin|administrator|^admin$|manager|receptionist|front desk|housekeeping|guest|staff)/i;
const isBuiltin = (r: Role) => BUILTIN.test(r.name.trim());

const VERB_STYLE: Record<string, { bg: string; fg: string }> = {
  read: { bg: T.blueSoft, fg: T.blueDeep },
  create: { bg: T.emeraldSoft, fg: T.emeraldDarker },
  update: { bg: T.amberSoft, fg: T.amberDeep },
  delete: { bg: T.roseSoft, fg: T.roseDeep },
  manage: { bg: T.violetSoft, fg: T.violetDeep },
  run: { bg: T.tealSoft, fg: T.tealDeep },
  export: { bg: T.violetSoft, fg: T.violetDeep },
};
const verbStyle = (v: string) => VERB_STYLE[v] || { bg: T.slateSoft, fg: T.ink2 };

const permCode = (p: Permission) =>
  p.resource?.includes(':') ? p.resource : `${p.resource}:${p.action}`;

const initials = (s: string) =>
  s.split(/[\s._-]+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

const RBACManagementPage: React.FC = () => {
  const {
    roles,
    permissions,
    users,
    rolesWithStats,
    permissionCategories,
    rolePermissionMap,
    loading,
    error,
    reload,
    setRoles,
    setUsers,
    updateRolePermissions,
    updateUserRoles,
  } = useRBACData();

  const [tab, setTab] = useState<'roles' | 'users'>('roles');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [roleSearch, setRoleSearch] = useState('');

  // Detail toolbar state
  const [permSearch, setPermSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());

  // Draft permission ids per role
  const [draft, setDraft] = useState<Record<number, Set<number>>>({});
  const [saving, setSaving] = useState(false);

  // Role dialogs
  const [roleDialog, setRoleDialog] = useState<null | 'create' | 'rename'>(null);
  const [roleForm, setRoleForm] = useState({ name: '', description: '' });
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  const showSnackbar = (message: string, severity: 'success' | 'error' = 'success') =>
    emitApiNotification({ message, severity });

  // Default selection — prefer an admin-ish role
  useEffect(() => {
    if (selectedId == null && roles.length) {
      const admin = roles.find((r) => /admin/i.test(r.name));
      setSelectedId(admin ? admin.id : roles[0].id);
    }
  }, [roles, selectedId]);

  // Sync draft from canonical map whenever data changes
  useEffect(() => {
    const next: Record<number, Set<number>> = {};
    roles.forEach((r) => {
      next[r.id] = new Set(rolePermissionMap[r.id] ? Array.from(rolePermissionMap[r.id]) : []);
    });
    setDraft(next);
  }, [roles, rolePermissionMap]);

  // Open all categories by default
  useEffect(() => {
    setOpenCats(new Set(permissionCategories.map((c) => c.name)));
  }, [permissionCategories]);

  const totalPerms = permissions.length;
  const selectedRole = roles.find((r) => r.id === selectedId) || null;
  const draftSet = selectedId != null ? draft[selectedId] || new Set<number>() : new Set<number>();
  const currentSet =
    selectedId != null && rolePermissionMap[selectedId]
      ? rolePermissionMap[selectedId]
      : new Set<number>();

  const locked = !!selectedRole && totalPerms > 0 && currentSet.size === totalPerms && isBuiltin(selectedRole);
  const enabledCount = draftSet.size;
  const pct = totalPerms ? Math.round((enabledCount / totalPerms) * 100) : 0;

  const usersByRole = useMemo(() => {
    const m: Record<number, User[]> = {};
    (users as (User & { roles?: Role[] })[]).forEach((u) => {
      (u.roles || []).forEach((r) => {
        (m[r.id] ||= []).push(u);
      });
    });
    return m;
  }, [users]);

  const dirty = useMemo(() => {
    if (selectedId == null) return false;
    if (draftSet.size !== currentSet.size) return true;
    for (const id of draftSet) if (!currentSet.has(id)) return true;
    return false;
  }, [draftSet, currentSet, selectedId]);

  const isOn = (pid: number) => draftSet.has(pid);

  const setDraftFor = (mutate: (s: Set<number>) => void) => {
    if (selectedId == null || locked) return;
    setDraft((prev) => {
      const s = new Set(prev[selectedId] || []);
      mutate(s);
      return { ...prev, [selectedId]: s };
    });
  };
  const togglePerm = (pid: number) =>
    setDraftFor((s) => (s.has(pid) ? s.delete(pid) : s.add(pid)));
  const setCatPerms = (catPerms: Permission[], enable: boolean) =>
    setDraftFor((s) => catPerms.forEach((p) => (enable ? s.add(p.id) : s.delete(p.id))));

  const discard = () => {
    if (selectedId == null) return;
    setDraft((prev) => ({ ...prev, [selectedId]: new Set(Array.from(currentSet)) }));
  };

  const save = async () => {
    if (selectedId == null || !selectedRole) return;
    const added = [...draftSet].filter((id) => !currentSet.has(id));
    const removed = [...currentSet].filter((id) => !draftSet.has(id));
    setSaving(true);
    try {
      for (const pid of added) {
        await HotelAPIService.assignPermissionToRole({ role_id: selectedId, permission_id: pid });
      }
      for (const pid of removed) {
        await HotelAPIService.removePermissionFromRole(String(selectedId), String(pid));
      }
      const nextPerms = permissions.filter((p) => draftSet.has(p.id));
      updateRolePermissions(selectedId, nextPerms);
      showSnackbar(
        `Saved ${selectedRole.name} — ${added.length} added, ${removed.length} removed`
      );
    } catch (e: any) {
      showSnackbar(e?.message || 'Failed to save permissions', 'error');
      reload();
    } finally {
      setSaving(false);
    }
  };

  // Role CRUD
  const openCreate = () => {
    setRoleForm({ name: '', description: '' });
    setRoleDialog('create');
  };
  const openRename = () => {
    if (!selectedRole) return;
    setRoleForm({ name: selectedRole.name, description: selectedRole.description || '' });
    setRoleDialog('rename');
  };
  const submitRole = async () => {
    if (!roleForm.name.trim()) return;
    try {
      if (roleDialog === 'create') {
        const created = await HotelAPIService.createRole({
          name: roleForm.name.trim(),
          description: roleForm.description || undefined,
        });
        setRoles((prev) => [...prev, created]);
        updateRolePermissions(created.id, []);
        setSelectedId(created.id);
        showSnackbar(`Role "${created.name}" created`);
      } else if (roleDialog === 'rename' && selectedRole) {
        const updated = await HotelAPIService.updateRole(String(selectedRole.id), {
          name: roleForm.name.trim(),
          description: roleForm.description || undefined,
        });
        setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showSnackbar(`Role "${updated.name}" updated`);
      }
      setRoleDialog(null);
    } catch (e: any) {
      showSnackbar(e?.message || 'Failed to save role', 'error');
    }
  };
  const duplicateRole = async () => {
    if (!selectedRole) return;
    try {
      const created = await HotelAPIService.createRole({
        name: `${selectedRole.name} (Copy)`,
        description: selectedRole.description || undefined,
      });
      const perms = [...(rolePermissionMap[selectedRole.id] || [])];
      for (const pid of perms) {
        await HotelAPIService.assignPermissionToRole({ role_id: created.id, permission_id: pid });
      }
      setRoles((prev) => [...prev, created]);
      updateRolePermissions(
        created.id,
        permissions.filter((p) => perms.includes(p.id))
      );
      setSelectedId(created.id);
      showSnackbar(`Duplicated as "${created.name}"`);
    } catch (e: any) {
      showSnackbar(e?.message || 'Failed to duplicate role', 'error');
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await HotelAPIService.deleteRole(String(deleteTarget.id));
      setRoles((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        const remaining = roles.filter((r) => r.id !== deleteTarget.id);
        setSelectedId(remaining.length ? remaining[0].id : null);
      }
      showSnackbar(`Role "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
    } catch (e: any) {
      showSnackbar(e?.message || 'Failed to delete role', 'error');
    }
  };

  // Users tab handlers (reuse existing UsersTab functionality)
  const handleUserCreated = (user: User) => {
    setUsers((prev) => [...prev, { ...user, roles: [] }]);
    showSnackbar(`User "${user.username}" created`);
  };
  const handleUserUpdated = (user: User) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...user } : u)));
    showSnackbar(`User "${user.username}" updated`);
  };
  const handleUserDeleted = (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    showSnackbar('User deleted');
  };
  const handleRolesAssigned = (userId: string, roleIds: number[]) => {
    updateUserRoles(userId, roleIds);
    showSnackbar('User roles updated');
  };

  if (error && !loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <IconButton color="inherit" size="small" onClick={reload}>
              <RefreshIcon />
            </IconButton>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  const visibleRoles = rolesWithStats.filter(
    (r) => !roleSearch || r.name.toLowerCase().includes(roleSearch.toLowerCase())
  );

  const PtabBtn = ({ id, label, count }: { id: 'roles' | 'users'; label: string; count: string }) => {
    const on = tab === id;
    return (
      <Box
        component="button"
        onClick={() => setTab(id)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.75, py: 1,
          borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          color: on ? '#fff' : T.ink3, bgcolor: on ? T.ink : 'transparent',
          '&:hover': { color: on ? '#fff' : T.ink },
        }}
      >
        {id === 'roles' ? <SecurityIcon sx={{ fontSize: 18 }} /> : <PeopleIcon sx={{ fontSize: 18 }} />}
        {label}
        <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, px: 0.875, borderRadius: 999, bgcolor: on ? 'rgba(255,255,255,0.18)' : T.surface3, color: on ? '#fff' : T.ink3, fontWeight: 700 }}>
          {count}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1480, mx: 'auto', bgcolor: '#F4F6F8', minHeight: '100%' }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 2.25 }}>
        <Box>
          <Box sx={{ fontSize: 11.5, color: T.ink3, fontWeight: 500, display: 'flex', gap: 0.75, mb: 0.75 }}>
            <span>Settings</span><span style={{ color: T.ink4 }}>/</span>
            <span>Access Control</span><span style={{ color: T.ink4 }}>/</span>
            <span style={{ color: T.ink2, fontWeight: 600 }}>Roles &amp; Permissions</span>
          </Box>
          <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: T.emeraldSoft, color: T.emeraldDarker, display: 'grid', placeItems: 'center', border: `1px solid ${T.emerald}29` }}>
              <SecurityIcon sx={{ fontSize: 20 }} />
            </Box>
            Roles &amp; Permissions
          </Typography>
          <Typography sx={{ fontSize: 13, color: T.ink3, mt: 0.5 }}>
            Manage access policies, assign roles, and audit who can do what across the property.
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={reload} disabled={loading} sx={{ border: `1px solid ${T.border}`, borderRadius: '9px' }}>
              {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Page tabs */}
      <Box sx={{ display: 'inline-flex', bgcolor: '#fff', border: `1px solid ${T.border}`, borderRadius: '11px', p: '4px', mb: 2 }}>
        <PtabBtn id="roles" label="Roles & Permissions" count={`${roles.length} / ${totalPerms}`} />
        <PtabBtn id="users" label="Users" count={`${users.length}`} />
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && tab === 'roles' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px 1fr' }, gap: 2, alignItems: 'start' }}>
          {/* Sidebar */}
          <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', overflow: 'hidden', position: { md: 'sticky' }, top: 16 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', p: '12px 14px', borderBottom: `1px solid ${T.border}`, background: `linear-gradient(180deg,${T.surface},${T.surface2})` }}>
              <Box sx={{ fontSize: 11, fontWeight: 700, color: T.ink3, letterSpacing: '0.6px', textTransform: 'uppercase' }}>Roles</Box>
              <Box sx={{ ml: 'auto', fontSize: 11, fontWeight: 700, color: T.ink3 }}>{roles.length} configured</Box>
            </Box>
            <Box sx={{ p: '8px 12px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
              <SearchIcon sx={{ fontSize: 16, color: T.ink3 }} />
              <Box component="input" placeholder="Search roles…" value={roleSearch}
                onChange={(e: any) => setRoleSearch(e.target.value)}
                sx={{ flex: 1, border: 'none', outline: 'none', bgcolor: 'transparent', fontSize: 13, fontFamily: 'inherit' }} />
            </Box>
            <Box sx={{ p: '6px' }}>
              {visibleRoles.map((r) => {
                const acc = roleAccent(r);
                const cnt = (draft[r.id]?.size ?? r.permissionCount) || 0;
                const on = r.id === selectedId;
                const uCount = (usersByRole[r.id] || []).length;
                return (
                  <Box key={r.id} component="button" onClick={() => setSelectedId(r.id)}
                    sx={{
                      display: 'grid', gridTemplateColumns: '32px 1fr auto', alignItems: 'center', gap: 1.25,
                      width: '100%', p: '9px 10px', borderRadius: '9px', textAlign: 'left', cursor: 'pointer',
                      border: `1px solid ${on ? T.ink : 'transparent'}`, mb: '2px',
                      bgcolor: on ? T.surface2 : 'transparent', '&:hover': { bgcolor: T.surface2 },
                    }}>
                    <Box sx={{ width: 32, height: 32, borderRadius: '9px', display: 'grid', placeItems: 'center', bgcolor: acc.soft, color: acc.deep, fontWeight: 800, fontSize: 12, border: `1px solid ${acc.deep}1F` }}>
                      {initials(r.name)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ fontSize: 13.5, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</Box>
                      <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 500, mt: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {uCount} {uCount === 1 ? 'user' : 'users'} · {cnt}/{totalPerms} perms
                      </Box>
                    </Box>
                    <Box sx={{ width: 28, height: 4, borderRadius: 4, bgcolor: T.surface3, overflow: 'hidden' }}>
                      <Box sx={{ height: '100%', width: `${totalPerms ? (cnt / totalPerms) * 100 : 0}%`, bgcolor: acc.deep }} />
                    </Box>
                  </Box>
                );
              })}
            </Box>
            <Box sx={{ p: '10px', borderTop: `1px solid ${T.border}`, bgcolor: T.surface2 }}>
              <Button fullWidth variant="contained" startIcon={<AddIcon />} onClick={openCreate}
                sx={{ textTransform: 'none', bgcolor: T.emerald, '&:hover': { bgcolor: T.emeraldDeep } }}>
                New role
              </Button>
            </Box>
          </Box>

          {/* Detail */}
          {selectedRole ? (
            <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', overflow: 'hidden' }}>
              {(() => {
                const acc = roleAccent(selectedRole);
                const heroUsers = usersByRole[selectedRole.id] || [];
                return (
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 2.25, p: '18px 22px', background: `linear-gradient(180deg,${T.surface},${T.surface2})`, borderBottom: `1px solid ${T.border}`, alignItems: 'start' }}>
                    <Box sx={{ width: 56, height: 56, borderRadius: '14px', bgcolor: acc.soft, color: acc.deep, border: `1px solid ${acc.deep}24`, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800 }}>
                      {initials(selectedRole.name)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        ROLE
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: acc.soft, color: acc.deep, px: 1, py: '2px', borderRadius: 999, textTransform: 'none', fontWeight: 700, fontSize: 11, border: `1px solid ${acc.deep}24` }}>
                          {isBuiltin(selectedRole) ? <><LockIcon sx={{ fontSize: 12 }} /> Built-in</> : 'Custom'}
                        </Box>
                        {locked && (
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: T.roseSoft, color: T.roseDeep, px: 1, py: '2px', borderRadius: 999, textTransform: 'none', fontWeight: 700, fontSize: 11, border: `1px solid ${T.rose}38` }}>
                            <BoltIcon sx={{ fontSize: 12 }} /> Full access
                          </Box>
                        )}
                      </Box>
                      <Typography sx={{ m: '4px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        {selectedRole.name}
                        <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: T.ink3, bgcolor: T.surface3, px: 1, py: '4px', borderRadius: '7px', border: `1px solid ${T.border}` }}>
                          #{selectedRole.id}
                        </Box>
                      </Typography>
                      <Typography sx={{ mt: 0.75, fontSize: 13.5, color: T.ink2, maxWidth: '60ch' }}>
                        {selectedRole.description || 'No description provided for this role.'}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mt: 1.5, flexWrap: 'wrap', fontFamily: 'JetBrains Mono, monospace' }}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Box sx={{ fontSize: 18, fontWeight: 800 }}>{enabledCount}</Box>
                          <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 600, fontFamily: 'Inter' }}>/ {totalPerms} permissions</Box>
                        </Box>
                        <Box sx={{ color: T.ink4 }}>·</Box>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Box sx={{ fontSize: 18, fontWeight: 800 }}>{heroUsers.length}</Box>
                          <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 600, fontFamily: 'Inter' }}>{heroUsers.length === 1 ? 'user' : 'users'} assigned</Box>
                        </Box>
                        <Box sx={{ color: T.ink4 }}>·</Box>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Box sx={{ fontSize: 18, fontWeight: 800 }}>{pct}%</Box>
                          <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 600, fontFamily: 'Inter' }}>coverage</Box>
                        </Box>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'flex-end' }}>
                      <Box sx={{ display: 'flex' }}>
                        {heroUsers.slice(0, 5).map((u, i) => (
                          <Box key={u.id} title={u.full_name || u.username}
                            sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: acc.soft, color: acc.deep, fontSize: 10.5, fontWeight: 700, display: 'grid', placeItems: 'center', border: '2px solid #fff', ml: i === 0 ? 0 : '-6px' }}>
                            {initials(u.full_name || u.username)}
                          </Box>
                        ))}
                        {heroUsers.length > 5 && (
                          <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: T.surface3, color: T.ink2, fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', border: '2px solid #fff', ml: '-6px' }}>
                            +{heroUsers.length - 5}
                          </Box>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Rename"><span><IconButton size="small" onClick={openRename} disabled={locked}><EditIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                        <Tooltip title="Duplicate"><IconButton size="small" onClick={duplicateRole}><CopyIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                        <Tooltip title={isBuiltin(selectedRole) ? 'Built-in roles cannot be deleted' : 'Delete'}>
                          <span><IconButton size="small" onClick={() => setDeleteTarget(selectedRole)} disabled={isBuiltin(selectedRole)}><DeleteIcon sx={{ fontSize: 16, color: isBuiltin(selectedRole) ? undefined : T.rose }} /></IconButton></span>
                        </Tooltip>
                      </Box>
                    </Box>
                  </Box>
                );
              })()}

              {/* Toolbar */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: '12px 22px', borderBottom: `1px solid ${T.border}`, flexWrap: 'wrap' }}>
                <TextField
                  size="small" value={permSearch} onChange={(e) => setPermSearch(e.target.value)}
                  placeholder="Search permissions by name, code or description…"
                  InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: T.ink3 }} /></InputAdornment>) }}
                  sx={{ flex: 1, minWidth: 240, bgcolor: '#fff', '& .MuiOutlinedInput-root': { borderRadius: '9px' } }}
                />
                <Box sx={{ display: 'inline-flex', bgcolor: '#fff', border: `1px solid ${T.border}`, borderRadius: '9px', p: '3px' }}>
                  {([
                    ['all', `All ${totalPerms}`],
                    ['on', `Enabled ${enabledCount}`],
                    ['off', `Disabled ${totalPerms - enabledCount}`],
                  ] as const).map(([k, lb]) => (
                    <Box key={k} component="button" onClick={() => setFilter(k)}
                      sx={{ px: 1.25, py: 0.75, fontSize: 12, fontWeight: 600, borderRadius: '6px', cursor: 'pointer', border: 'none', color: filter === k ? '#fff' : T.ink3, bgcolor: filter === k ? T.ink : 'transparent' }}>
                      {lb}
                    </Box>
                  ))}
                </Box>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '9px', fontSize: 12, fontWeight: 600, color: T.ink2 }}>
                  <span>Coverage</span>
                  <Box sx={{ width: 80, height: 6, borderRadius: 4, bgcolor: T.surface4, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,${T.emerald},${T.emeraldDeep})` }} />
                  </Box>
                  <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: T.ink }}>{pct}%</Box>
                </Box>
                <Button size="small" onClick={() => setHideEmpty((v) => !v)} startIcon={hideEmpty ? <CheckIcon /> : <ModulesIcon />}
                  sx={{ textTransform: 'none', color: T.ink2, border: `1px solid ${T.border}` }}>
                  {hideEmpty ? 'Hide empty modules' : 'Show all modules'}
                </Button>
                <Button size="small" onClick={() => setOpenCats(new Set(permissionCategories.map((c) => c.name)))} sx={{ textTransform: 'none', color: T.ink3 }}>Expand all</Button>
                <Button size="small" onClick={() => setOpenCats(new Set())} sx={{ textTransform: 'none', color: T.ink3 }}>Collapse all</Button>
              </Box>

              {/* Groups */}
              <Box sx={{ p: '8px 14px 18px' }}>
                {(() => {
                  const q = permSearch.trim().toLowerCase();
                  const filtering = !!q || filter !== 'all';
                  const hiddenCats: typeof permissionCategories = [];
                  const blocks: React.ReactNode[] = [];

                  permissionCategories.forEach((cat) => {
                    const onInCat = cat.permissions.filter((p) => isOn(p.id)).length;
                    if (hideEmpty && onInCat === 0 && !filtering) {
                      hiddenCats.push(cat);
                      return;
                    }
                    const rows = cat.permissions.filter((p) => {
                      if (q && !(`${permCode(p)} ${p.name} ${p.description || ''}`.toLowerCase().includes(q))) return false;
                      if (filter === 'on' && !isOn(p.id)) return false;
                      if (filter === 'off' && isOn(p.id)) return false;
                      return true;
                    });
                    if (rows.length === 0 && filtering) return;
                    const open = openCats.has(cat.name);
                    const allOn = onInCat === cat.permissions.length;

                    blocks.push(
                      <Box key={cat.name} sx={{ border: `1px solid ${open ? T.borderHi : T.border}`, borderRadius: '12px', mt: 1.25, bgcolor: '#fff', overflow: 'hidden' }}>
                        <Box onClick={() => setOpenCats((prev) => { const n = new Set(prev); n.has(cat.name) ? n.delete(cat.name) : n.add(cat.name); return n; })}
                          sx={{ display: 'grid', gridTemplateColumns: '36px 1fr auto auto auto', alignItems: 'center', gap: 1.5, p: '11px 14px', cursor: 'pointer', background: `linear-gradient(180deg,#fff,${T.surface2})`, borderBottom: open ? `1px solid ${T.border}` : 'none' }}>
                          <Box sx={{ width: 36, height: 36, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: `${cat.color}1A`, color: cat.color, border: `1px solid ${cat.color}29` }}>
                            <SecurityIcon sx={{ fontSize: 18 }} />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.2px' }}>{cat.displayName}</Box>
                            <Box sx={{ fontSize: 11.5, color: T.ink3, fontWeight: 500, mt: '1px' }}>{cat.permissions.length} permissions</Box>
                          </Box>
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: T.ink2, bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '7px', px: 1, py: '3px' }}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: cat.color }} />
                            {onInCat}/{cat.permissions.length}
                          </Box>
                          <Button size="small" disabled={locked}
                            onClick={(e) => { e.stopPropagation(); setCatPerms(cat.permissions, !allOn); }}
                            sx={{ textTransform: 'none', color: T.ink3, minWidth: 0 }}>
                            {allOn ? 'Disable all' : 'Enable all'}
                          </Button>
                          <ChevronRightIcon sx={{ color: T.ink3, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 180ms' }} />
                        </Box>
                        <Collapse in={open} unmountOnExit>
                          <Box>
                            {rows.map((p, i) => {
                              const on = isOn(p.id);
                              const others = roles.filter(
                                (r) => r.id !== selectedRole!.id && rolePermissionMap[r.id]?.has(p.id)
                              );
                              const vs = verbStyle(p.action);
                              return (
                                <Box key={p.id}
                                  sx={{ display: 'grid', gridTemplateColumns: { xs: '48px 1fr', md: '48px 200px minmax(220px,1fr) minmax(0,1fr)' }, alignItems: 'center', gap: 1.75, p: '10px 14px 10px 18px', borderTop: i === 0 ? 'none' : `1px solid ${T.border}`, '&:hover': { bgcolor: T.surface2 } }}>
                                  <Box onClick={() => togglePerm(p.id)} role="switch" aria-checked={on}
                                    sx={{
                                      position: 'relative', width: 38, height: 22, borderRadius: 999, flexShrink: 0,
                                      cursor: locked ? 'not-allowed' : 'pointer',
                                      bgcolor: locked ? T.rose : on ? T.emerald : T.surface4,
                                      border: `1px solid ${locked ? T.roseDeep : on ? T.emeraldDeep : T.borderHi}`,
                                      transition: 'background 160ms',
                                      '&::after': { content: '""', position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: '50%', bgcolor: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.18)', transform: (on || locked) ? 'translateX(16px)' : 'none', transition: 'transform 160ms' },
                                    }} />
                                  <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                                    <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{permCode(p)}</Box>
                                    <Box sx={{ mt: '4px', display: 'inline-flex', width: 'fit-content', fontSize: 10.5, fontWeight: 700, px: 0.75, py: '1px', borderRadius: '5px', textTransform: 'uppercase', bgcolor: vs.bg, color: vs.fg }}>{p.action}</Box>
                                  </Box>
                                  <Box sx={{ display: { xs: 'none', md: 'block' }, fontSize: 13, color: T.ink, lineHeight: 1.4 }}>
                                    {p.name}
                                    <Box sx={{ display: 'block', fontSize: 11.5, color: T.ink3, mt: '2px', fontWeight: 500 }}>{p.description || '—'}</Box>
                                  </Box>
                                  <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                    {others.length === 0 ? (
                                      <Box sx={{ fontSize: 11, color: T.ink4, fontWeight: 600 }}>Only this role</Box>
                                    ) : others.slice(0, 5).map((r) => {
                                      const a = roleAccent(r);
                                      return (
                                        <Box key={r.id} title={r.name} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 11, fontWeight: 700, px: 0.875, py: '3px', borderRadius: 999, bgcolor: a.soft, color: a.deep, border: `1px solid ${a.deep}29` }}>
                                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: a.deep }} />
                                          {r.name}
                                        </Box>
                                      );
                                    })}
                                  </Box>
                                </Box>
                              );
                            })}
                          </Box>
                        </Collapse>
                      </Box>
                    );
                  });

                  return (
                    <>
                      {blocks}
                      {hiddenCats.length > 0 && (
                        <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: '36px 1fr auto', alignItems: 'center', gap: 1.75, p: '12px 14px', border: `1px dashed ${T.borderHi}`, borderRadius: '12px', background: `repeating-linear-gradient(135deg,${T.surface2} 0 12px,#fff 12px 24px)` }}>
                          <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: T.slateSoft, color: T.ink2, display: 'grid', placeItems: 'center', border: `1px solid ${T.border}` }}>
                            <LockIcon sx={{ fontSize: 16 }} />
                          </Box>
                          <Box sx={{ fontSize: 12.5, color: T.ink2 }}>
                            <strong style={{ color: T.ink }}>{hiddenCats.length} module{hiddenCats.length === 1 ? '' : 's'} hidden</strong> — this role has no permissions in:
                            <Box sx={{ display: 'flex', gap: 0.625, flexWrap: 'wrap', mt: 0.75 }}>
                              {hiddenCats.map((c) => (
                                <Box key={c.name} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, fontSize: 11, fontWeight: 700, color: c.color, bgcolor: `${c.color}14`, border: `1px solid ${c.color}2E`, px: 1, py: '3px', borderRadius: 999 }}>
                                  {c.displayName}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                          <Button size="small" onClick={() => setHideEmpty(false)} startIcon={<AddIcon />} sx={{ textTransform: 'none', border: `1px solid ${T.border}`, color: T.ink2 }}>
                            Grant access
                          </Button>
                        </Box>
                      )}
                      {blocks.length === 0 && hiddenCats.length === 0 && (
                        <Box sx={{ p: 6, textAlign: 'center', color: T.ink3, fontSize: 13 }}>No permissions match these filters.</Box>
                      )}
                    </>
                  );
                })()}
              </Box>

              {/* Save bar */}
              {dirty && !locked && (
                <Box sx={{ position: 'sticky', bottom: 16, m: '14px 14px 0', bgcolor: T.ink, color: '#fff', borderRadius: '12px', p: '10px 14px 10px 18px', display: 'flex', alignItems: 'center', gap: 1.5, boxShadow: '0 10px 30px rgba(15,23,42,0.18)' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: T.amber, boxShadow: `0 0 0 4px ${T.amber}38` }} />
                  <Box sx={{ fontSize: 13, fontWeight: 600 }}>
                    <Box component="em" sx={{ fontStyle: 'normal', color: T.amber }}>Unsaved changes</Box> —{' '}
                    {[...draftSet].filter((id) => !currentSet.has(id)).length +
                      [...currentSet].filter((id) => !draftSet.has(id)).length}{' '}
                    permission(s) modified
                  </Box>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" onClick={discard} disabled={saving} sx={{ textTransform: 'none', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', bgcolor: 'rgba(255,255,255,0.08)' }}>
                    Discard
                  </Button>
                  <Button size="small" variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={14} /> : <CheckIcon />}
                    sx={{ textTransform: 'none', bgcolor: T.emerald, '&:hover': { bgcolor: T.emeraldDeep } }}>
                    Save changes
                  </Button>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ p: 6, textAlign: 'center', color: T.ink3, bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px' }}>
              Select a role to view and edit its permissions.
            </Box>
          )}
        </Box>
      )}

      {!loading && tab === 'users' && (
        <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', p: 2 }}>
          <UsersTab
            users={users}
            roles={roles}
            loading={loading}
            onUserCreated={handleUserCreated}
            onUserUpdated={handleUserUpdated}
            onUserDeleted={handleUserDeleted}
            onRolesAssigned={handleRolesAssigned}
          />
        </Box>
      )}

      {/* Create / Rename role dialog */}
      <Dialog open={!!roleDialog} onClose={() => setRoleDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{roleDialog === 'create' ? 'New role' : 'Rename role'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField autoFocus label="Role name" required value={roleForm.name}
              onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))} />
            <TextField label="Description" multiline rows={2} value={roleForm.description}
              onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoleDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitRole} disabled={!roleForm.name.trim()}
            sx={{ bgcolor: T.emerald, '&:hover': { bgcolor: T.emeraldDeep } }}>
            {roleDialog === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete role */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete role</DialogTitle>
        <DialogContent>
          <Typography>
            Delete <strong>{deleteTarget?.name}</strong>? Users assigned to this role will lose its access.
            This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={confirmDelete}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RBACManagementPage;
