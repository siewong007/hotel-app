import React from 'react';
import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import { helpInteractiveCardSx } from '../constants';
import { estimateReadingMinutes } from '../utils';
import type { HelpArticle } from '../types';

interface ArticleCardProps {
  article: HelpArticle;
}

/** Article summary card — used for popular articles, category listings and
 * related-article rails. Whole card is the link target. */
const ArticleCard: React.FC<ArticleCardProps> = ({ article }) => {
  const { t } = useTranslation('help');
  return (
    <Card variant="outlined" sx={{ height: '100%', ...helpInteractiveCardSx }}>
      <CardActionArea
        component={Link}
        to={`/help/${article.slug}`}
        sx={{ height: '100%', alignItems: 'flex-start' }}
      >
        <CardContent sx={{ p: 2.5, height: '100%' }}>
          <Stack spacing={0.75} sx={{ height: '100%' }}>
            <Typography variant="overline" color="primary" sx={{ lineHeight: 1.6, letterSpacing: '0.08em' }}>
              {t(`categories.${article.category}.name`)}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {article.title}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                lineHeight: 1.6,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {article.summary}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 'auto', pt: 1 }}>
              {t('article.readingTime', { count: estimateReadingMinutes(article) })}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default ArticleCard;
