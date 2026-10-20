import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, InputAdornment, TextField, Typography } from '@mui/material';
import { Edit as EditIcon, Search as SearchIcon } from '@mui/icons-material';
import type { Permission, Role, RouteAccessPolicy } from '../../../../../types';
import { useAuth } from '../../../../../auth/AuthContext';
import { useIsPhone } from '../../../../../hooks/useIsPhone';
import { useTranslation } from '../../../../../i18n';
import { useRouteLabels } from '../../../../../navigation/routeLabels';
import { emitApiNotification } from '../../../../../utils/apiNotifications';
import type { RolePermissionMap } from '../types';
import PageAccessDialog from './PageAccessDialog';
import {
  buildPageAccessRows,
  draftFrom,
  roleChecksFor,
  ruleOutcome,
  type PageAccessRow,
} from './pageAccessModel';

/** Role chips shown per cell before collapsing the rest into "+N". */
const MAX_ROLE_CHIPS = 4;

interface PageAccessTabProps {
  routePolicies: RouteAccessPolicy[];
  roles: Role[];
  permissions: Permission[];
  rolePermissionMap: RolePermissionMap;
  onPolicySaved: (policy: RouteAccessPolicy) => void;
}

const PageAccessTab: React.FC<PageAccessTabProps> = ({
  routePolicies,
  roles,
  permissions,
  rolePermissionMap,
  onPolicySaved,
}) => {
  const { t, tOr, locale } = useTranslation('admin');
  const { navLabel, groupLabel } = useRouteLabels();
  const { hasPermission } = useAuth();
  const isPhone = useIsPhone();
  const listFormat = useMemo(
    () => new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }),
    [locale]
  );
  // The API takes changes from permissions:manage only.
  const canEdit = hasPermission('permissions:manage');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const rows = useMemo(() => buildPageAccessRows(routePolicies), [routePolicies]);
  const roleChecks = useMemo(
    () => roleChecksFor(roles, permissions, rolePermissionMap),
    [roles, permissions, rolePermissionMap]
  );

  const pageLabel = useCallback(
    (row: PageAccessRow) =>
      row.route
        ? navLabel(row.route)
        : // intentional: dynamic key — the policy id is data; the stored label is the fallback
          tOr(`rbac.pageAccess.pages.${row.policy.route_id}`, row.policy.nav_label || row.policy.route_id),
    [navLabel, tOr]
  );

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const grouped = new Map<PageAccessRow['group'], PageAccessRow[]>();
    rows
      .filter((row) => !q || `${pageLabel(row)} ${row.policy.path}`.toLowerCase().includes(q))
      .forEach((row) => {
        const list = grouped.get(row.group) ?? [];
        list.push(row);
        grouped.set(row.group, list);
      });
    return Array.from(grouped, ([group, groupRows]) => ({ group, rows: groupRows }));
  }, [pageLabel, query, rows]);

  const editingRow = rows.find((row) => row.policy.route_id === editingId) ?? null;

  const roleChips = (list: Role[], everyoneLabel: string) => {
    if (list.length === 0) {
      return (
        <Box component="span" sx={{ fontSize: 12.5, color: 'var(--hotel-text-muted)' }}>
          {t('rbac.pageAccess.nobody')}
        </Box>
      );
    }
    if (list.length === roles.length) {
      return <Chip size="small" color="success" variant="outlined" label={everyoneLabel} />;
    }
    if (isPhone) {
      // Half-width cells fit one chip per line; a sentence keeps the row short.
      return (
        <Box component="span" sx={{ fontSize: 12.5, lineHeight: 1.45 }}>
          {listFormat.format(list.map((role) => role.name))}
        </Box>
      );
    }
    return (
      <>
        {list.slice(0, MAX_ROLE_CHIPS).map((role) => (
          <Chip key={role.id} size="small" label={role.name} />
        ))}
        {list.length > MAX_ROLE_CHIPS && (
          <Chip size="small" variant="outlined" label={t('rbac.pageAccess.moreRoles', { count: list.length - MAX_ROLE_CHIPS })} />
        )}
      </>
    );
  };

  const handleSaved = (policy: RouteAccessPolicy) => {
    onPolicySaved(policy);
    const row = rows.find((candidate) => candidate.policy.route_id === policy.route_id);
    emitApiNotification({
      message: t('rbac.pageAccess.saved', { page: row ? pageLabel(row) : policy.route_id }),
      severity: 'success',
    });
    setEditingId(null);
  };

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Typography sx={{ fontSize: 13, color: 'var(--hotel-text-secondary)', maxWidth: '75ch' }}>
        {t('rbac.pageAccess.intro')}
      </Typography>
      {!canEdit && <Alert severity="info">{t('rbac.pageAccess.readOnly')}</Alert>}
      <TextField
        size="small"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('rbac.pageAccess.search')}
        sx={{ maxWidth: { sm: 360 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: 'var(--hotel-text-muted)' }} />
              </InputAdornment>
            ),
          },
          htmlInput: { 'aria-label': t('rbac.pageAccess.search') },
        }}
      />

      {sections.length === 0 && (
        <Box sx={{ p: 4, textAlign: 'center', color: 'var(--hotel-text-muted)', fontSize: 13 }}>
          {t('rbac.pageAccess.noMatch')}
        </Box>
      )}

      {sections.map(({ group, rows: groupRows }) => (
        <Box key={group} component="section" sx={{ display: 'grid', gap: 1 }}>
          <Box>
            <Typography component="h3" sx={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--hotel-text-muted)' }}>
              {group === 'other' ? t('rbac.pageAccess.otherPages') : groupLabel(group)}
            </Typography>
            {group === 'other' && (
              <Typography sx={{ fontSize: 12, color: 'var(--hotel-text-muted)' }}>
                {t('rbac.pageAccess.otherPagesNote')}
              </Typography>
            )}
          </Box>
          {groupRows.map((row) => {
            const outcome = ruleOutcome(row, draftFrom(row.policy), roleChecks);
            const label = pageLabel(row);
            return (
              <Box
                key={row.policy.route_id}
                data-testid={`page-access-row-${row.policy.route_id}`}
                sx={{
                  display: 'grid',
                  // Phones: name and Edit share the first line, and the two
                  // role lists sit side by side, so 30-odd pages stay a
                  // scannable list rather than a wall of stacked cells.
                  gridTemplateColumns: { xs: 'minmax(0, 1fr) minmax(0, 1fr)', md: 'minmax(180px, 1.1fr) 2fr 2fr auto' },
                  gridTemplateAreas: { xs: '"page edit" "open menu"', md: '"page open menu edit"' },
                  columnGap: { xs: 1.5, md: 2 },
                  rowGap: 1,
                  alignItems: { xs: 'start', md: 'center' },
                  p: '12px 14px',
                  border: '1px solid var(--hotel-border)',
                  borderRadius: '12px',
                  bgcolor: 'var(--hotel-surface)',
                }}
              >
                <Box sx={{ gridArea: 'page', minWidth: 0 }}>
                  <Box sx={{ fontSize: 14, fontWeight: 700 }}>{label}</Box>
                  <Box sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11.5, color: 'var(--hotel-text-muted)', overflowWrap: 'anywhere' }}>
                    {row.policy.path}
                  </Box>
                </Box>
                <Box sx={{ gridArea: 'open', minWidth: 0 }}>
                  <Box sx={{ fontSize: 11, fontWeight: 700, color: 'var(--hotel-text-muted)', mb: 0.5 }}>
                    {t('rbac.pageAccess.canOpen')}
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {roleChips(outcome.canOpen, t('rbac.pageAccess.allRoles'))}
                  </Box>
                </Box>
                <Box sx={{ gridArea: 'menu', minWidth: 0 }}>
                  <Box sx={{ fontSize: 11, fontWeight: 700, color: 'var(--hotel-text-muted)', mb: 0.5 }}>
                    {t('rbac.pageAccess.inMenu')}
                  </Box>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {row.menuRoutes.length > 0 ? (
                      roleChips(outcome.inMenu, t('rbac.pageAccess.allRoles'))
                    ) : (
                      <Box component="span" sx={{ fontSize: 12.5, color: 'var(--hotel-text-muted)' }}>
                        {t('rbac.pageAccess.notInMenu')}
                      </Box>
                    )}
                  </Box>
                </Box>
                {canEdit && (
                  <Box sx={{ gridArea: 'edit', justifySelf: 'end', alignSelf: { xs: 'start', md: 'center' } }}>
                    <Button
                      size="small"
                      startIcon={<EditIcon sx={{ fontSize: 16 }} />}
                      onClick={() => setEditingId(row.policy.route_id)}
                      aria-label={t('rbac.pageAccess.editPage', { page: label })}
                      sx={{ textTransform: 'none', minHeight: { xs: 44, md: 'auto' } }}
                    >
                      {t('rbac.pageAccess.edit')}
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      ))}

      {editingRow && (
        <PageAccessDialog
          row={editingRow}
          pageLabel={pageLabel(editingRow)}
          roles={roles}
          permissions={permissions}
          roleChecks={roleChecks}
          onClose={() => setEditingId(null)}
          onSaved={handleSaved}
        />
      )}
    </Box>
  );
};

export default PageAccessTab;
