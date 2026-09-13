import React from 'react';
import { Box, List, ListItemButton, ListItemText, Typography } from '@mui/material';
import { useTranslation } from '../../../i18n';

interface ArticleTocProps {
  entries: { id: string; text: string }[];
  /** 'rail' = sticky side column (wide layouts); 'inline' = bordered block above the article. */
  variant: 'rail' | 'inline';
}

/** In-page table of contents built from heading blocks. The page decides
 * placement per breakpoint; this component owns only the two visual variants.
 * Renders nothing for articles with fewer than two headings. */
const ArticleToc: React.FC<ArticleTocProps> = ({ entries, variant }) => {
  const { t } = useTranslation('help');

  if (entries.length < 2) return null;

  const list = (
    <List dense disablePadding>
      {entries.map((entry) => (
        <ListItemButton
          key={entry.id}
          component="a"
          href={`#${entry.id}`}
          sx={{ borderRadius: 1, py: 0.5 }}
        >
          <ListItemText
            primary={entry.text}
            slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }}
          />
        </ListItemButton>
      ))}
    </List>
  );

  if (variant === 'inline') {
    return (
      <Box component="nav" aria-label={t('aria.toc')} sx={{ my: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
          {t('article.onThisPage')}
        </Typography>
        {list}
      </Box>
    );
  }

  return (
    <Box
      component="nav"
      aria-label={t('aria.toc')}
      sx={{ position: 'sticky', top: 130, pl: 2.5, borderLeft: '1px solid', borderColor: 'divider' }}
    >
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '0.08em' }}>
        {t('article.onThisPage')}
      </Typography>
      {list}
    </Box>
  );
};

export default ArticleToc;
