import React from 'react';
import { Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import { helpIconWellSx, helpInteractiveCardSx } from '../constants';
import type { HelpCategoryDef } from '../constants';

interface CategoryCardProps {
  category: HelpCategoryDef;
  articleCount: number;
}

/** Hub tile for one help category — the whole card is the link target. */
const CategoryCard: React.FC<CategoryCardProps> = ({ category, articleCount }) => {
  const { t } = useTranslation('help');
  const Icon = category.icon;
  return (
    <Card variant="outlined" sx={{ height: '100%', ...helpInteractiveCardSx }}>
      <CardActionArea
        component={Link}
        to="/help"
        // compat Link types `to` as any, so the search object can't be schema-checked — cast it.
        search={{ category: category.id } as never}
        sx={{ height: '100%', alignItems: 'flex-start' }}
        aria-label={t(`categories.${category.id}.name`)}
      >
        <CardContent sx={{ p: 2.5 }}>
          <Stack spacing={1.75}>
            <Box sx={helpIconWellSx}>
              <Icon sx={{ fontSize: 21 }} />
            </Box>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {t(`categories.${category.id}.name`)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, lineHeight: 1.55 }}>
                {t(`categories.${category.id}.desc`)}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
              {t('hub.articlesCount', { count: articleCount })}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default CategoryCard;
