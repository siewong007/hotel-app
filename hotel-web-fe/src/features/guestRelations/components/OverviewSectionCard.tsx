import React from 'react';
import {
  Box,
  Card,
  CardContent,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import { ChevronRightOutlined as ChevronRightIcon } from '@mui/icons-material';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n/useTranslation';

/** One linkable preview row inside an overview section card. */
export interface OverviewPreviewRow {
  key: React.Key;
  /** Destination — usually the guest 360 path, or the owning module's. */
  to: string;
  primary: React.ReactNode;
  secondary?: React.ReactNode;
}

export interface OverviewSectionCardProps {
  title: string;
  icon: React.ReactNode;
  /** GUEST_DESIGN token (a `var(--hotel-*)` CSS var) for the icon tint + count. */
  accent: string;
  /** Total matching records — the preview list only shows up to 5. */
  count: number;
  /** Optional second line under the title, e.g. "2 waiting for staff". */
  subtitle?: React.ReactNode;
  rows: OverviewPreviewRow[];
  /** "View all" destination; omit when the section has no owning page. */
  viewAllTo?: string;
  viewAllLabel?: string;
  /** Friendly copy shown instead of the list when there is nothing to preview. */
  emptyText: string;
}

/**
 * One work-queue card on the guest-relations dashboard: an accented
 * title/count header, up to five linkable preview rows, and an optional
 * "View all" link into the owning module.
 */
const OverviewSectionCard: React.FC<OverviewSectionCardProps> = ({
  title,
  icon,
  accent,
  count,
  subtitle,
  rows,
  viewAllTo,
  viewAllLabel,
  emptyText,
}) => {
  const { t } = useTranslation('guests');
  return (
  <Card sx={{ height: '100%' }}>
    <CardContent
      sx={{
        p: 2,
        '&:last-child': { pb: 2 },
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1 }}>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            // CSS vars can't go through MUI alpha() — color-mix is the
            // master-branch convention for tinting --hotel-* tokens.
            bgcolor: `color-mix(in srgb, ${accent} 12%, transparent)`,
            color: accent,
            '& svg': { fontSize: 18 },
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Typography
          variant="h5"
          sx={{ fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums' }}
        >
          {count}
        </Typography>
      </Box>

      {rows.length > 0 ? (
        <List dense disablePadding sx={{ mx: -1 }}>
          {rows.map((row) => (
            <ListItemButton
              key={row.key}
              component={Link}
              to={row.to}
              sx={{ borderRadius: 1.5, py: 0.5 }}
            >
              <ListItemText
                primary={row.primary}
                secondary={row.secondary}
                slotProps={{
                  primary: { noWrap: true, sx: { fontSize: '0.84rem', fontWeight: 600 } },
                  secondary: { noWrap: true, sx: { fontSize: '0.72rem' } },
                }}
              />
            </ListItemButton>
          ))}
        </List>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
          {emptyText}
        </Typography>
      )}

      {viewAllTo && (
        <Typography
          component={Link}
          to={viewAllTo}
          sx={{
            mt: 'auto',
            pt: 1,
            display: 'inline-flex',
            alignItems: 'center',
            alignSelf: 'flex-start',
            gap: 0.25,
            fontSize: '0.78rem',
            fontWeight: 700,
            color: 'primary.main',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {viewAllLabel ?? t('common:actions.viewAll')}
          <ChevronRightIcon sx={{ fontSize: 14 }} />
        </Typography>
      )}
    </CardContent>
  </Card>
  );
};

export default OverviewSectionCard;
