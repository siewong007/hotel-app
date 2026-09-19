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
  DeleteOutlined as DeleteIcon,
  Check as CheckIcon,
  ChevronRight as ChevronRightIcon,
  Lock as LockIcon,
  Bolt as BoltIcon,
  People as PeopleIcon,
  ViewModule as ModulesIcon,
} from '@mui/icons-material';
import { LogoLoader } from '../../../../components';
import type { Permission, Role, User } from '../../../../types';
import { useRBACData } from './hooks/useRBACData';
import {
  useCreateRole,
  useDeleteRole,
  useReplaceRolePermissions,
  useUpdateRole,
} from './hooks/useRBACQueries';
import { UsersTab } from './UsersTab';
import { emitApiNotification } from '../../../../utils/apiNotifications';
import { errorMessage } from '../../../../utils/errorMessage';
import { useTranslation } from '../../../../i18n';

/* ---------- Design tokens — aliases onto the global --hotel-* vars ---------- */
const T = {
  surface: 'var(--hotel-surface)',
  surface2: 'var(--hotel-surface-raised)',
  surface3: 'var(--hotel-surface-sunken)',
  surface4: 'var(--hotel-hover)',
  border: 'var(--hotel-border)',
  borderHi: 'var(--hotel-border-strong)',
  ink: 'var(--hotel-text)',
  ink2: 'var(--hotel-text-secondary)',
  ink3: 'var(--hotel-text-muted)',
  ink4: 'var(--hotel-text-disabled)',
  emerald: 'var(--hotel-primary)',
  emeraldDeep: 'var(--hotel-primary-hover)',
  emeraldDarker: 'var(--hotel-primary-active)',
  emeraldSoft: 'var(--hotel-primary-subtle)',
  blue: 'var(--hotel-info)',
  blueSoft: 'var(--hotel-info-bg)',
  blueDeep: 'var(--hotel-info)',
  amber: 'var(--hotel-warning)',
  amberSoft: 'var(--hotel-warning-bg)',
  amberDeep: 'var(--hotel-warning)',
  rose: 'var(--hotel-danger)',
  roseSoft: 'var(--hotel-danger-bg)',
  roseDeep: 'var(--hotel-danger)',
  violet: 'var(--hotel-chart-4)',
  violetSoft: 'color-mix(in srgb, var(--hotel-chart-4) 14%, transparent)',
  violetDeep: 'var(--hotel-chart-4)',
  teal: 'var(--hotel-chart-3)',
  tealSoft: 'color-mix(in srgb, var(--hotel-chart-3) 14%, transparent)',
  tealDeep: 'var(--hotel-chart-3)',
  slateSoft: 'var(--hotel-neutral-bg)',
};

/** Border tint for a color that may be a `var(--hotel-*)` token. */
const tintBorder = (color: string, pct = 22) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

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
  const { t } = useTranslation('admin');
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

  const createRoleMutation = useCreateRole();
  const updateRoleMutation = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();
  const replaceRolePermissionsMutation = useReplaceRolePermissions();
  const roleDialogSaving = createRoleMutation.isPending || updateRoleMutation.isPending;

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
  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedId) || null,
    [roles, selectedId]
  );
  const visibleRoles = useMemo(() => {
    const q = roleSearch.trim().toLowerCase();
    return rolesWithStats.filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [roleSearch, rolesWithStats]);
  const draftSet = useMemo(
    () => (selectedId != null ? draft[selectedId] || new Set<number>() : new Set<number>()),
    [selectedId, draft]
  );
  const currentSet = useMemo(
    () =>
      selectedId != null && rolePermissionMap[selectedId]
        ? rolePermissionMap[selectedId]
        : new Set<number>(),
    [selectedId, rolePermissionMap]
  );

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

  const rolesByPermission = useMemo(() => {
    const m: Record<number, Role[]> = {};
    roles.forEach((role) => {
      rolePermissionMap[role.id]?.forEach((permissionId) => {
        (m[permissionId] ||= []).push(role);
      });
    });
    return m;
  }, [rolePermissionMap, roles]);

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
      await replaceRolePermissionsMutation.mutateAsync({
        roleId: String(selectedId),
        input: {
          permission_ids: [...draftSet],
        },
      });
      const nextPerms = permissions.filter((p) => draftSet.has(p.id));
      updateRolePermissions(selectedId, nextPerms);
      showSnackbar(
        t('rbac.toast.saved', { name: selectedRole.name, added: added.length, removed: removed.length })
      );
    } catch (e) {
      showSnackbar(errorMessage(e, t('rbac.errors.savePermissions')), 'error');
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
        const created = await createRoleMutation.mutateAsync({
          name: roleForm.name.trim(),
          description: roleForm.description || undefined,
        });
        setRoles((prev) => [...prev, created]);
        updateRolePermissions(created.id, []);
        setSelectedId(created.id);
        showSnackbar(t('rbac.toast.roleCreated', { name: created.name }));
      } else if (roleDialog === 'rename' && selectedRole) {
        const updated = await updateRoleMutation.mutateAsync({
          roleId: String(selectedRole.id),
          input: {
            name: roleForm.name.trim(),
            description: roleForm.description || undefined,
          },
        });
        setRoles((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showSnackbar(t('rbac.toast.roleUpdated', { name: updated.name }));
      }
      setRoleDialog(null);
    } catch (e) {
      showSnackbar(errorMessage(e, t('rbac.errors.saveRole')), 'error');
    }
  };
  const duplicateRole = async () => {
    if (!selectedRole) return;
    try {
      const created = await createRoleMutation.mutateAsync({
        name: t('rbac.copyName', { name: selectedRole.name }),
        description: selectedRole.description || undefined,
      });
      const perms = [...(rolePermissionMap[selectedRole.id] || [])];
      await replaceRolePermissionsMutation.mutateAsync({
        roleId: String(created.id),
        input: { permission_ids: perms },
      });
      setRoles((prev) => [...prev, created]);
      updateRolePermissions(
        created.id,
        permissions.filter((p) => perms.includes(p.id))
      );
      setSelectedId(created.id);
      showSnackbar(t('rbac.toast.roleDuplicated', { name: created.name }));
    } catch (e) {
      showSnackbar(errorMessage(e, t('rbac.errors.duplicateRole')), 'error');
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteRoleMutation.mutateAsync(String(deleteTarget.id));
      setRoles((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        const remaining = roles.filter((r) => r.id !== deleteTarget.id);
        setSelectedId(remaining.length ? remaining[0].id : null);
      }
      showSnackbar(t('rbac.toast.roleDeleted', { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (e) {
      showSnackbar(errorMessage(e, t('rbac.errors.deleteRole')), 'error');
    }
  };

  // Users tab handlers (reuse existing UsersTab functionality)
  const handleUserCreated = (user: User) => {
    setUsers((prev) => [...prev, { ...user, roles: [] }]);
    showSnackbar(t('rbac.toast.userCreated', { name: user.username }));
  };
  const handleUserUpdated = (user: User) => {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, ...user } : u)));
    showSnackbar(t('rbac.toast.userUpdated', { name: user.username }));
  };
  const handleUserDeleted = (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    showSnackbar(t('rbac.toast.userDeleted'));
  };
  const handleRolesAssigned = (userId: string, roleIds: number[]) => {
    updateUserRoles(userId, roleIds);
    showSnackbar(t('rbac.toast.userRolesUpdated'));
  };

  if (error && !loading) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert
          severity="error"
          action={
            <IconButton color="inherit" size="small" onClick={reload} aria-label={t('common:actions.retry')}>
              <RefreshIcon />
            </IconButton>
          }
        >
          {error}
        </Alert>
      </Box>
    );
  }

  const PtabBtn = ({ id, label, count }: { id: 'roles' | 'users'; label: string; count: string }) => {
    const on = tab === id;
    return (
      <Box
        component="button"
        onClick={() => setTab(id)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.75, py: 1,
          borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
          color: on ? 'var(--hotel-bg)' : T.ink3, bgcolor: on ? T.ink : 'transparent',
          '&:hover': { color: on ? 'var(--hotel-bg)' : T.ink },
        }}
      >
        {id === 'roles' ? <SecurityIcon sx={{ fontSize: 18 }} /> : <PeopleIcon sx={{ fontSize: 18 }} />}
        {label}
        <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, px: 0.875, borderRadius: 999, bgcolor: on ? 'color-mix(in srgb, var(--hotel-bg) 18%, transparent)' : T.surface3, color: on ? 'var(--hotel-bg)' : T.ink3, fontWeight: 700 }}>
          {count}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1480, mx: 'auto', bgcolor: 'var(--hotel-bg)', minHeight: '100%' }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 3, flexWrap: 'wrap', mb: 2.25 }}>
        <Box>
          <Box sx={{ fontSize: 11.5, color: T.ink3, fontWeight: 500, display: 'flex', gap: 0.75, mb: 0.75 }}>
            <span>{t('audit.crumbs.settings')}</span><span style={{ color: T.ink4 }}>/</span>
            <span>{t('rbac.crumbs.accessControl')}</span><span style={{ color: T.ink4 }}>/</span>
            <span style={{ color: T.ink2, fontWeight: 600 }}>{t('rbac.title')}</span>
          </Box>
          <Typography component="h1" sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.6px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: T.emeraldSoft, color: T.emeraldDarker, display: 'grid', placeItems: 'center', border: `1px solid color-mix(in srgb, ${T.emerald} 16%, transparent)` }}>
              <SecurityIcon sx={{ fontSize: 20 }} />
            </Box>
            {t('rbac.title')}
          </Typography>
          <Typography sx={{ fontSize: 13, color: T.ink3, mt: 0.5 }}>
            {t('rbac.subtitle')}
          </Typography>
        </Box>
        <Tooltip title={t('common:actions.refresh')}>
          <span>
            <IconButton onClick={reload} disabled={loading} aria-label={t('rbac.refresh')} sx={{ border: `1px solid ${T.border}`, borderRadius: '9px' }}>
              {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {/* Page tabs */}
      {/* The two labels plus their counts need ~350px; on a 320px viewport the
          pill overflowed the page. Scroll inside the pill instead — same
          pattern as the filter chip rows elsewhere. */}
      <Box sx={{
        display: 'inline-flex',
        maxWidth: '100%',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        '& > *': { flexShrink: 0 },
        bgcolor: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: '11px',
        p: '4px',
        mb: 2,
      }}>
        <PtabBtn id="roles" label={t('rbac.title')} count={`${roles.length} / ${totalPerms}`} />
        <PtabBtn id="users" label={t('rbac.usersTab')} count={`${users.length}`} />
      </Box>
      {loading && (
        <LogoLoader variant="page" />
      )}
      {!loading && tab === 'roles' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px 1fr' }, gap: 2, alignItems: 'start' }}>
          {/* Sidebar */}
          <Box sx={{ bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px', overflow: 'hidden', position: { md: 'sticky' }, top: 16 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', p: '12px 14px', borderBottom: `1px solid ${T.border}`, background: `linear-gradient(180deg,${T.surface},${T.surface2})` }}>
              <Box sx={{ fontSize: 11, fontWeight: 700, color: T.ink3, letterSpacing: '0.6px', textTransform: 'uppercase' }}>{t('rbac.rolesHeading')}</Box>
              <Box sx={{ ml: 'auto', fontSize: 11, fontWeight: 700, color: T.ink3 }}>{t('rbac.configuredCount', { count: roles.length })}</Box>
            </Box>
            <Box sx={{ p: '8px 12px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
              <SearchIcon sx={{ fontSize: 16, color: T.ink3 }} />
              <Box component="input" placeholder={t('rbac.searchRoles')} value={roleSearch}
                onChange={(e) => setRoleSearch((e.target as HTMLInputElement).value)}
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
                    <Box sx={{ width: 32, height: 32, borderRadius: '9px', display: 'grid', placeItems: 'center', bgcolor: acc.soft, color: acc.deep, fontWeight: 800, fontSize: 12, border: `1px solid color-mix(in srgb, ${acc.deep} 12%, transparent)` }}>
                      {initials(r.name)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ fontSize: 13.5, fontWeight: 700, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</Box>
                      <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 500, mt: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t('rbac.roleCardMeta', { users: uCount, cnt, total: totalPerms })}
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
                {t('rbac.newRole')}
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
                    <Box sx={{ width: 56, height: 56, borderRadius: '14px', bgcolor: acc.soft, color: acc.deep, border: `1px solid color-mix(in srgb, ${acc.deep} 14%, transparent)`, display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800 }}>
                      {initials(selectedRole.name)}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ fontSize: 10.5, color: T.ink3, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        {t('rbac.roleTag')}
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: acc.soft, color: acc.deep, px: 1, py: '2px', borderRadius: 999, textTransform: 'none', fontWeight: 700, fontSize: 11, border: `1px solid color-mix(in srgb, ${acc.deep} 14%, transparent)` }}>
                          {isBuiltin(selectedRole) ? <><LockIcon sx={{ fontSize: 12 }} /> {t('rbac.builtin')}</> : t('rbac.custom')}
                        </Box>
                        {locked && (
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, bgcolor: T.roseSoft, color: T.roseDeep, px: 1, py: '2px', borderRadius: 999, textTransform: 'none', fontWeight: 700, fontSize: 11, border: `1px solid color-mix(in srgb, ${T.rose} 22%, transparent)` }}>
                            <BoltIcon sx={{ fontSize: 12 }} /> {t('rbac.fullAccess')}
                          </Box>
                        )}
                      </Box>
                      <Typography component="h2" sx={{ m: '4px 0 0', fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        {selectedRole.name}
                        <Box component="span" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: T.ink3, bgcolor: T.surface3, px: 1, py: '4px', borderRadius: '7px', border: `1px solid ${T.border}` }}>
                          #{selectedRole.id}
                        </Box>
                      </Typography>
                      <Typography sx={{ mt: 0.75, fontSize: 13.5, color: T.ink2, maxWidth: '60ch' }}>
                        {selectedRole.description || t('rbac.noDescription')}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mt: 1.5, flexWrap: 'wrap', fontFamily: 'JetBrains Mono, monospace' }}>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Box sx={{ fontSize: 18, fontWeight: 800 }}>{enabledCount}</Box>
                          <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 600, fontFamily: 'Inter' }}>{t('rbac.ofPermissions', { total: totalPerms })}</Box>
                        </Box>
                        <Box sx={{ color: T.ink4 }}>·</Box>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Box sx={{ fontSize: 18, fontWeight: 800 }}>{heroUsers.length}</Box>
                          <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 600, fontFamily: 'Inter' }}>{t('rbac.usersAssigned', { count: heroUsers.length })}</Box>
                        </Box>
                        <Box sx={{ color: T.ink4 }}>·</Box>
                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
                          <Box sx={{ fontSize: 18, fontWeight: 800 }}>{pct}%</Box>
                          <Box sx={{ fontSize: 11, color: T.ink3, fontWeight: 600, fontFamily: 'Inter' }}>{t('rbac.coverage')}</Box>
                        </Box>
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'flex-end' }}>
                      <Box sx={{ display: 'flex' }}>
                        {heroUsers.slice(0, 5).map((u, i) => (
                          <Box key={u.id} title={u.full_name || u.username}
                            sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: acc.soft, color: acc.deep, fontSize: 10.5, fontWeight: 700, display: 'grid', placeItems: 'center', border: '2px solid var(--hotel-surface)', ml: i === 0 ? 0 : '-6px' }}>
                            {initials(u.full_name || u.username)}
                          </Box>
                        ))}
                        {heroUsers.length > 5 && (
                          <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: T.surface3, color: T.ink2, fontSize: 10, fontWeight: 700, display: 'grid', placeItems: 'center', border: '2px solid var(--hotel-surface)', ml: '-6px' }}>
                            +{heroUsers.length - 5}
                          </Box>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title={t('rbac.rename')}><span><IconButton size="small" onClick={openRename} disabled={locked} aria-label={t('rbac.rename')}><EditIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                        <Tooltip title={t('rbac.duplicate')}><IconButton size="small" onClick={duplicateRole} aria-label={t('rbac.duplicate')}><CopyIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                        <Tooltip title={isBuiltin(selectedRole) ? t('rbac.builtinNoDelete') : t('common:actions.delete')}>
                          <span><IconButton size="small" onClick={() => setDeleteTarget(selectedRole)} disabled={isBuiltin(selectedRole)} aria-label={isBuiltin(selectedRole) ? t('rbac.builtinNoDelete') : t('common:actions.delete')}><DeleteIcon sx={{ fontSize: 16, color: isBuiltin(selectedRole) ? undefined : T.rose }} /></IconButton></span>
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
                  placeholder={t('rbac.searchPermissionsDetail')}
                  sx={{ flex: 1, minWidth: 240, bgcolor: T.surface, '& .MuiOutlinedInput-root': { borderRadius: '9px' } }}
                  slotProps={{
                    input: { startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: T.ink3 }} /></InputAdornment>) }
                  }}
                />
                <Box sx={{ display: 'inline-flex', bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '9px', p: '3px' }}>
                  {([
                    ['all', t('rbac.filterAll', { count: totalPerms })],
                    ['on', t('rbac.filterEnabled', { count: enabledCount })],
                    ['off', t('rbac.filterDisabled', { count: totalPerms - enabledCount })],
                  ] as const).map(([k, lb]) => (
                    <Box key={k} component="button" onClick={() => setFilter(k)}
                      sx={{ px: 1.25, py: 0.75, fontSize: 12, fontWeight: 600, borderRadius: '6px', cursor: 'pointer', border: 'none', color: filter === k ? 'var(--hotel-bg)' : T.ink3, bgcolor: filter === k ? T.ink : 'transparent' }}>
                      {lb}
                    </Box>
                  ))}
                </Box>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '9px', fontSize: 12, fontWeight: 600, color: T.ink2 }}>
                  <span>{t('rbac.coverage')}</span>
                  <Box sx={{ width: 80, height: 6, borderRadius: 4, bgcolor: T.surface4, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${pct}%`, background: T.emerald }} />
                  </Box>
                  <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: T.ink }}>{pct}%</Box>
                </Box>
                <Button size="small" onClick={() => setHideEmpty((v) => !v)} startIcon={hideEmpty ? <CheckIcon /> : <ModulesIcon />}
                  sx={{ textTransform: 'none', color: T.ink2, border: `1px solid ${T.border}` }}>
                  {hideEmpty ? t('rbac.hideEmpty') : t('rbac.showAll')}
                </Button>
                <Button size="small" onClick={() => setOpenCats(new Set(permissionCategories.map((c) => c.name)))} sx={{ textTransform: 'none', color: T.ink3 }}>{t('rbac.expandAll')}</Button>
                <Button size="small" onClick={() => setOpenCats(new Set())} sx={{ textTransform: 'none', color: T.ink3 }}>{t('rbac.collapseAll')}</Button>
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
                      <Box key={cat.name} sx={{ border: `1px solid ${open ? T.borderHi : T.border}`, borderRadius: '12px', mt: 1.25, bgcolor: T.surface, overflow: 'hidden' }}>
                        <Box onClick={() => setOpenCats((prev) => { const n = new Set(prev); n.has(cat.name) ? n.delete(cat.name) : n.add(cat.name); return n; })}
                          sx={{ display: 'grid', gridTemplateColumns: '36px 1fr auto auto auto', alignItems: 'center', gap: 1.5, p: '11px 14px', cursor: 'pointer', background: T.surface, borderBottom: open ? `1px solid ${T.border}` : 'none' }}>
                          <Box sx={{ width: 36, height: 36, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: `color-mix(in srgb, ${cat.color} 10%, transparent)`, color: cat.color, border: `1px solid color-mix(in srgb, ${cat.color} 16%, transparent)` }}>
                            <SecurityIcon sx={{ fontSize: 18 }} />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.2px' }}>{cat.displayName}</Box>
                            <Box sx={{ fontSize: 11.5, color: T.ink3, fontWeight: 500, mt: '1px' }}>{t('rbac.catPermCount', { count: cat.permissions.length })}</Box>
                          </Box>
                          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 12, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: T.ink2, bgcolor: T.surface2, border: `1px solid ${T.border}`, borderRadius: '7px', px: 1, py: '3px' }}>
                            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: cat.color }} />
                            {onInCat}/{cat.permissions.length}
                          </Box>
                          <Button size="small" disabled={locked}
                            onClick={(e) => { e.stopPropagation(); setCatPerms(cat.permissions, !allOn); }}
                            sx={{ textTransform: 'none', color: T.ink3, minWidth: 0 }}>
                            {allOn ? t('rbac.disableAll') : t('rbac.enableAll')}
                          </Button>
                          <ChevronRightIcon sx={{ color: T.ink3, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 180ms' }} />
                        </Box>
                        <Collapse in={open} unmountOnExit>
                          <Box>
                            {rows.map((p, i) => {
                              const on = isOn(p.id);
                              const others = (rolesByPermission[p.id] || []).filter(
                                (r) => r.id !== selectedRole!.id
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
                                      '&::after': { content: '""', position: 'absolute', top: 2, left: 2, width: 16, height: 16, borderRadius: '50%', bgcolor: T.surface, boxShadow: 'var(--hotel-shadow-sm)', transform: (on || locked) ? 'translateX(16px)' : 'none', transition: 'transform 160ms' },
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
                                      <Box sx={{ fontSize: 11, color: T.ink4, fontWeight: 600 }}>{t('rbac.onlyThisRole')}</Box>
                                    ) : others.slice(0, 5).map((r) => {
                                      const a = roleAccent(r);
                                      return (
                                        <Box key={r.id} title={r.name} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontSize: 11, fontWeight: 700, px: 0.875, py: '3px', borderRadius: 999, bgcolor: a.soft, color: a.deep, border: `1px solid color-mix(in srgb, ${a.deep} 16%, transparent)` }}>
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
                        <Box sx={{ mt: 1.5, display: 'grid', gridTemplateColumns: '36px 1fr auto', alignItems: 'center', gap: 1.75, p: '12px 14px', border: `1px dashed ${T.borderHi}`, borderRadius: '12px', background: "var(--hotel-surface-sunken)" }}>
                          <Box sx={{ width: 36, height: 36, borderRadius: '10px', bgcolor: T.slateSoft, color: T.ink2, display: 'grid', placeItems: 'center', border: `1px solid ${T.border}` }}>
                            <LockIcon sx={{ fontSize: 16 }} />
                          </Box>
                          <Box sx={{ fontSize: 12.5, color: T.ink2 }}>
                            <strong style={{ color: T.ink }}>{t('rbac.modulesHidden', { count: hiddenCats.length })}</strong> — {t('rbac.modulesHiddenNote')}
                            <Box sx={{ display: 'flex', gap: 0.625, flexWrap: 'wrap', mt: 0.75 }}>
                              {hiddenCats.map((c) => (
                                <Box key={c.name} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625, fontSize: 11, fontWeight: 700, color: c.color, bgcolor: `color-mix(in srgb, ${c.color} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${c.color} 18%, transparent)`, px: 1, py: '3px', borderRadius: 999 }}>
                                  {c.displayName}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                          <Button size="small" onClick={() => setHideEmpty(false)} startIcon={<AddIcon />} sx={{ textTransform: 'none', border: `1px solid ${T.border}`, color: T.ink2 }}>
                            {t('rbac.grantAccess')}
                          </Button>
                        </Box>
                      )}
                      {blocks.length === 0 && hiddenCats.length === 0 && (
                        <Box sx={{ p: 6, textAlign: 'center', color: T.ink3, fontSize: 13 }}>{t('rbac.noPermsMatch')}</Box>
                      )}
                    </>
                  );
                })()}
              </Box>

              {/* Save bar */}
              {dirty && !locked && (
                <Box sx={{ position: 'sticky', bottom: 16, m: '14px 14px 0', bgcolor: T.ink, color: 'var(--hotel-bg)', borderRadius: '12px', p: '10px 14px 10px 18px', display: 'flex', alignItems: 'center', gap: 1.5, boxShadow: 'var(--hotel-shadow-lg)' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: T.amber, boxShadow: `0 0 0 4px color-mix(in srgb, ${T.amber} 22%, transparent)` }} />
                  <Box sx={{ fontSize: 13, fontWeight: 600 }}>
                    <Box component="em" sx={{ fontStyle: 'normal', color: T.amber }}>{t('rbac.unsavedChanges')}</Box> —{' '}
                    {[...draftSet].filter((id) => !currentSet.has(id)).length +
                      [...currentSet].filter((id) => !draftSet.has(id)).length}{' '}
                    {t('rbac.permsModified')}
                  </Box>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" onClick={discard} disabled={saving} sx={{ textTransform: 'none', color: 'var(--hotel-bg)', border: '1px solid color-mix(in srgb, var(--hotel-bg) 18%, transparent)', bgcolor: 'color-mix(in srgb, var(--hotel-bg) 8%, transparent)' }}>
                    {t('common:actions.discard')}
                  </Button>
                  <Button size="small" variant="contained" onClick={save} disabled={saving} startIcon={saving ? <CircularProgress size={14} /> : <CheckIcon />}
                    sx={{ textTransform: 'none', bgcolor: T.emerald, '&:hover': { bgcolor: T.emeraldDeep } }}>
                    {t('rbac.saveChanges')}
                  </Button>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ p: 6, textAlign: 'center', color: T.ink3, bgcolor: T.surface, border: `1px solid ${T.border}`, borderRadius: '14px' }}>
              {t('rbac.selectRole')}
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
        <DialogTitle>{roleDialog === 'create' ? t('rbac.newRole') : t('rbac.renameRoleTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField autoFocus label={t('rbac.roleName')} required value={roleForm.name}
              onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))} />
            <TextField label={t('common:field.description')} multiline rows={2} value={roleForm.description}
              onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRoleDialog(null)} disabled={roleDialogSaving}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            onClick={submitRole}
            disabled={roleDialogSaving || !roleForm.name.trim()}
            startIcon={roleDialogSaving ? <CircularProgress size={16} /> : null}
            sx={{ bgcolor: T.emerald, '&:hover': { bgcolor: T.emeraldDeep } }}>
            {roleDialog === 'create' ? t('common:actions.create') : t('common:actions.save')}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Delete role */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('rbac.deleteRoleTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('rbac.deleteDialogStart')}{' '}
            <strong>{deleteTarget?.name}</strong>{t('rbac.deleteDialogEnd')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteRoleMutation.isPending}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirmDelete}
            disabled={deleteRoleMutation.isPending}
            startIcon={deleteRoleMutation.isPending ? <CircularProgress size={16} /> : null}
          >
            {t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RBACManagementPage;
