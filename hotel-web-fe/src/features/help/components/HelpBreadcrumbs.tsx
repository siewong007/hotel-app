import React from 'react';
import { Breadcrumbs, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import type { HelpCategoryId } from '../types';

interface HelpBreadcrumbsProps {
  category?: HelpCategoryId;
  /** Current-page label rendered as plain text (never a link). */
  current?: string;
}

/** Trail: Help Centre → [category] → [article]. The first real Breadcrumbs
 * usage in the app — the nav registry's breadcrumb metadata finally pays off. */
const HelpBreadcrumbs: React.FC<HelpBreadcrumbsProps> = ({ category, current }) => {
  const { t } = useTranslation('help');
  return (
    <Breadcrumbs
      aria-label={t('aria.breadcrumbs')}
      separator={<NavigateNextIcon fontSize="small" />}
      sx={{ '& a': { color: 'text.secondary', textDecoration: 'none', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }, fontSize: '0.85rem' }}
    >
      <Link to="/help">{t('hub.kicker')}</Link>
      {category && !current && (
        <Typography color="text.primary" sx={{ fontSize: 'inherit', fontWeight: 600 }}>
          {t(`categories.${category}.name`)}
        </Typography>
      )}
      {category && current && (
        <Link to="/help" search={{ category } as never}>{t(`categories.${category}.name`)}</Link>
      )}
      {current && (
        <Typography color="text.primary" sx={{ fontSize: 'inherit', fontWeight: 600, maxWidth: { xs: 220, sm: 'none' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current}
        </Typography>
      )}
    </Breadcrumbs>
  );
};

export default HelpBreadcrumbs;
