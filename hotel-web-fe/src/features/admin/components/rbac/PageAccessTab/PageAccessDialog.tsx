import React, { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import type { Permission, Role, RouteAccessPolicy } from '../../../../../types';
import { useAuth } from '../../../../../auth/AuthContext';
import { useIsPhone } from '../../../../../hooks/useIsPhone';
import { useTranslation } from '../../../../../i18n';
import { policyAdmits } from '../../../../../navigation/routeAccess';
import { errorMessage } from '../../../../../utils/errorMessage';
import { useUpdateRouteAccessPolicy } from '../hooks/useRBACQueries';
import {
  ACCESS_CONTROL_ROUTE_ID,
  draftChanged,
  draftFrom,
  inputFrom,
  ruleOutcome,
  type PageAccessRow,
  type RoleCheck,
  type RuleDraft,
  type RuleField,
} from './pageAccessModel';

interface NameFieldProps {
  label: string;
  value: string[];
  /** Names that exist today; anything else in `value` is flagged. */
  options: string[];
  descriptions?: ReadonlyMap<string, string | undefined>;
  unknownLabel: string;
  onChange: (next: string[]) => void;
}

/**
 * Multi-select over existing permission or role names. A name a stored rule
 * kept after it stopped existing still shows (flagged) so it can be removed,
 * but it can't be picked again.
 */
const NameField: React.FC<NameFieldProps> = ({
  label,
  value,
  options,
  descriptions,
  unknownLabel,
  onChange,
}) => {
  const known = useMemo(() => new Set(options), [options]);
  const allOptions = useMemo(
    () => [...options, ...value.filter((name) => !known.has(name))],
    [known, options, value]
  );

  return (
    <Autocomplete
      multiple
      size="small"
      options={allOptions}
      value={value}
      filterSelectedOptions
      getOptionDisabled={(option) => !known.has(option)}
      onChange={(_event, next) => onChange(next)}
      renderOption={(props, option) => {
        const { key, ...optionProps } = props;
        const description = descriptions?.get(option);
        return (
          <li key={key} {...optionProps}>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, fontWeight: 600 }}>
                {option}
              </Box>
              {description && (
                <Box sx={{ fontSize: 12, color: 'var(--hotel-text-secondary)' }}>{description}</Box>
              )}
            </Box>
          </li>
        );
      }}
      renderValue={(selected, getItemProps) =>
        selected.map((name, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          const missing = !known.has(name);
          return (
            <Chip
              key={key}
              size="small"
              label={name}
              color={missing ? 'warning' : 'default'}
              title={missing ? unknownLabel : undefined}
              {...itemProps}
            />
          );
        })
      }
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
};

interface PageAccessDialogProps {
  row: PageAccessRow;
  pageLabel: string;
  roles: Role[];
  permissions: Permission[];
  roleChecks: RoleCheck[];
  onClose: () => void;
  onSaved: (policy: RouteAccessPolicy) => void;
}

const PageAccessDialog: React.FC<PageAccessDialogProps> = ({
  row,
  pageLabel,
  roles,
  permissions,
  roleChecks,
  onClose,
  onSaved,
}) => {
  const { t, locale } = useTranslation('admin');
  const { hasPermission, hasRole } = useAuth();
  const isPhone = useIsPhone();
  const updatePolicy = useUpdateRouteAccessPolicy();
  const [draft, setDraft] = useState<RuleDraft>(() => draftFrom(row.policy));
  const [error, setError] = useState<string | null>(null);

  const permissionNames = useMemo(
    () => permissions.map((permission) => permission.name).sort((a, b) => a.localeCompare(b)),
    [permissions]
  );
  const permissionDescriptions = useMemo(
    () => new Map(permissions.map((permission) => [permission.name, permission.description])),
    [permissions]
  );
  const roleNames = useMemo(() => roles.map((role) => role.name), [roles]);
  const listFormat = useMemo(
    () => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }),
    [locale]
  );

  const outcome = useMemo(() => ruleOutcome(row, draft, roleChecks), [row, draft, roleChecks]);
  const roleList = (list: Role[]) =>
    list.length > 0 ? listFormat.format(list.map((role) => role.name)) : t('rbac.pageAccess.nobody');

  const hasMenu = row.menuRoutes.length > 0;
  const canOpenIds = new Set(outcome.canOpen.map((role) => role.id));
  const menuWithoutAccess = outcome.inMenu.filter((role) => !canOpenIds.has(role.id));
  const openToAll = draft.required_permissions.length === 0 && draft.required_roles.length === 0;

  // The person editing, judged by the same check the page itself runs.
  const self = { hasPermission, hasRole };
  const lockout = row.policy.route_id === ACCESS_CONTROL_ROUTE_ID && !policyAdmits(draft, self);
  const selfLosesAccess = !lockout && policyAdmits(row.policy, self) && !policyAdmits(draft, self);

  const changed = draftChanged(row.policy, draft);
  const saving = updatePolicy.isPending;

  const setField = (field: RuleField) => (next: string[]) => {
    setDraft((current) => ({ ...current, [field]: next }));
    setError(null);
  };

  const save = async () => {
    try {
      const saved = await updatePolicy.mutateAsync({
        routeId: row.policy.route_id,
        input: inputFrom(row.policy, draft),
      });
      onSaved(saved);
    } catch (caught) {
      setError(errorMessage(caught, t('rbac.pageAccess.saveFailed')));
    }
  };

  const unknownLabel = t('rbac.pageAccess.unknownName');
  const sectionSx = { display: 'grid', gap: 1.5 } as const;

  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="md" fullWidth fullScreen={isPhone}>
      <DialogTitle sx={{ pb: 0.5 }}>
        {t('rbac.pageAccess.editTitle', { page: pageLabel })}
        <Box
          component="span"
          sx={{ display: 'block', fontFamily: 'JetBrains Mono, monospace', fontSize: 12.5, color: 'var(--hotel-text-muted)', mt: 0.5 }}
        >
          {row.policy.path}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2.5, pt: '12px !important' }}>
        <Box sx={sectionSx}>
          <Box>
            <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700 }}>
              {t('rbac.pageAccess.openSection')}
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: 'var(--hotel-text-secondary)', mt: 0.25 }}>
              {t('rbac.pageAccess.openHelp')}
            </Typography>
          </Box>
          <NameField
            label={t('rbac.pageAccess.permissionsField')}
            value={draft.required_permissions}
            options={permissionNames}
            descriptions={permissionDescriptions}
            unknownLabel={unknownLabel}
            onChange={setField('required_permissions')}
          />
          <NameField
            label={t('rbac.pageAccess.rolesField')}
            value={draft.required_roles}
            options={roleNames}
            unknownLabel={unknownLabel}
            onChange={setField('required_roles')}
          />
          <NameField
            label={t('rbac.pageAccess.excludedField')}
            value={draft.excluded_roles}
            options={roleNames}
            unknownLabel={unknownLabel}
            onChange={setField('excluded_roles')}
          />
        </Box>

        {hasMenu && (
          <Box sx={sectionSx}>
            <Box>
              <Typography component="h3" sx={{ fontSize: 14, fontWeight: 700 }}>
                {t('rbac.pageAccess.menuSection')}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: 'var(--hotel-text-secondary)', mt: 0.25 }}>
                {t('rbac.pageAccess.menuHelp')}
              </Typography>
            </Box>
            <NameField
              label={t('rbac.pageAccess.permissionsField')}
              value={draft.nav_permissions}
              options={permissionNames}
              descriptions={permissionDescriptions}
              unknownLabel={unknownLabel}
              onChange={setField('nav_permissions')}
            />
            <NameField
              label={t('rbac.pageAccess.rolesField')}
              value={draft.nav_roles}
              options={roleNames}
              unknownLabel={unknownLabel}
              onChange={setField('nav_roles')}
            />
            <NameField
              label={t('rbac.pageAccess.menuHiddenField')}
              value={draft.nav_excluded_roles}
              options={roleNames}
              unknownLabel={unknownLabel}
              onChange={setField('nav_excluded_roles')}
            />
          </Box>
        )}

        <Box
          aria-live="polite"
          sx={{
            display: 'grid',
            gap: 0.75,
            p: 1.5,
            borderRadius: '10px',
            border: '1px solid var(--hotel-border)',
            bgcolor: 'var(--hotel-surface-sunken)',
          }}
        >
          <Typography component="h3" sx={{ fontSize: 13, fontWeight: 700 }}>
            {t('rbac.pageAccess.preview')}
          </Typography>
          <Typography sx={{ fontSize: 13 }} data-testid="page-access-can-open">
            {t('rbac.pageAccess.previewCanOpen', { roles: roleList(outcome.canOpen) })}
          </Typography>
          {hasMenu && (
            <Typography sx={{ fontSize: 13 }} data-testid="page-access-in-menu">
              {t('rbac.pageAccess.previewInMenu', { roles: roleList(outcome.inMenu) })}
            </Typography>
          )}
          <Typography sx={{ fontSize: 12, color: 'var(--hotel-text-secondary)' }}>
            {t('rbac.pageAccess.combinedNote')}
          </Typography>
        </Box>

        {(openToAll || (hasMenu && outcome.inMenu.length === 0) || menuWithoutAccess.length > 0 || lockout || selfLosesAccess || error) && (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {lockout && <Alert severity="error">{t('rbac.pageAccess.selfLockout')}</Alert>}
            {selfLosesAccess && <Alert severity="warning">{t('rbac.pageAccess.selfLoses')}</Alert>}
            {menuWithoutAccess.length > 0 && (
              <Alert severity="warning">
                {t('rbac.pageAccess.menuWithoutAccess', { roles: roleList(menuWithoutAccess) })}
              </Alert>
            )}
            {openToAll && <Alert severity="info">{t('rbac.pageAccess.openToAll')}</Alert>}
            {hasMenu && outcome.inMenu.length === 0 && (
              <Alert severity="info">{t('rbac.pageAccess.hiddenForAll')}</Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={save}
          disabled={!changed || lockout || saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PageAccessDialog;
