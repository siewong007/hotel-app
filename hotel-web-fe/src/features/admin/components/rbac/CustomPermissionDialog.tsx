import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from '@mui/material';
import type { Permission } from '../../../../types';
import { useIsPhone } from '../../../../hooks/useIsPhone';
import { useTranslation } from '../../../../i18n';
import { errorMessage } from '../../../../utils/errorMessage';
import { useCreatePermission, useUpdatePermission } from './hooks/useRBACQueries';

/** The database's own rule for a permission's resource (and its 50-character column). */
const RESOURCE_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

/** Actions offered first; the rest follow alphabetically. */
const COMMON_ACTIONS = ['read', 'view', 'create', 'update', 'delete', 'manage', 'export', 'approve'];

/**
 * Actions to offer: the ones built-in permissions already use. The database
 * accepts only a fixed list of actions, and every existing permission passed
 * it, so this list can't offer one the save would reject.
 */
export function permissionActions(permissions: Permission[]): string[] {
  const actions = Array.from(new Set(permissions.map((permission) => permission.action)));
  const rank = (action: string) => {
    const index = COMMON_ACTIONS.indexOf(action);
    return index === -1 ? COMMON_ACTIONS.length : index;
  };
  return actions.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

interface CustomPermissionDialogProps {
  /** The permission being edited; omit to create one. */
  permission?: Permission;
  permissions: Permission[];
  onClose: () => void;
  onSaved: (permission: Permission, created: boolean) => void;
}

const CustomPermissionDialog: React.FC<CustomPermissionDialogProps> = ({
  permission,
  permissions,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation('admin');
  const isPhone = useIsPhone();
  const createPermission = useCreatePermission();
  const updatePermission = useUpdatePermission();
  const editing = Boolean(permission);
  const actions = useMemo(() => permissionActions(permissions), [permissions]);

  const [resource, setResource] = useState(permission?.resource ?? '');
  const [action, setAction] = useState(permission?.action ?? actions[0] ?? '');
  const [description, setDescription] = useState(permission?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const name = permission?.name ?? `${resource}:${action}`;
  const resourceValid = RESOURCE_PATTERN.test(resource);
  const duplicate = !editing && permissions.some((existing) => existing.name === name);
  const saving = createPermission.isPending || updatePermission.isPending;
  const canSave = editing
    ? description !== (permission?.description ?? '')
    : resourceValid && Boolean(action) && !duplicate;

  const save = async () => {
    setError(null);
    const input = {
      name,
      resource: permission?.resource ?? resource,
      action: permission?.action ?? action,
      description: description.trim() || undefined,
    };
    try {
      if (permission) {
        const saved = await updatePermission.mutateAsync({ permissionId: String(permission.id), input });
        onSaved(saved, false);
      } else {
        const saved = await createPermission.mutateAsync(input);
        onSaved(saved, true);
      }
    } catch (caught) {
      setError(errorMessage(caught, t('rbac.customPermission.saveFailed')));
    }
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={isPhone}>
      <DialogTitle>
        {editing
          ? t('rbac.customPermission.editTitle', { name })
          : t('rbac.customPermission.createTitle')}
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        <Alert severity="info">{t('rbac.customPermission.note')}</Alert>
        {!editing && (
          <>
            <TextField
              autoFocus
              required
              label={t('rbac.permResource')}
              value={resource}
              onChange={(event) => setResource(event.target.value.trim().toLowerCase())}
              error={resource.length > 0 && !resourceValid}
              helperText={
                resource.length > 0 && !resourceValid
                  ? t('rbac.customPermission.resourceInvalid')
                  : t('rbac.customPermission.resourceHelp')
              }
            />
            <TextField
              select
              required
              label={t('rbac.permAction')}
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              {actions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
          </>
        )}
        <Box
          data-testid="custom-permission-name"
          sx={{ fontSize: 13, color: duplicate ? 'var(--hotel-danger)' : 'var(--hotel-text-secondary)' }}
        >
          {duplicate
            ? t('rbac.customPermission.duplicate', { name })
            : t('rbac.customPermission.namePreview', { name: resourceValid || editing ? name : '…' })}
        </Box>
        <TextField
          label={t('rbac.customPermission.description')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('rbac.permDescPlaceholder')}
          multiline
          minRows={2}
          autoFocus={editing}
        />
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!canSave || saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {editing ? t('common:actions.save') : t('common:actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CustomPermissionDialog;
