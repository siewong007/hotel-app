import React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { useTranslation } from '../../../i18n';
import ArticleCard from './ArticleCard';
import type { HelpArticle } from '../types';

interface RelatedArticlesProps {
  articles: HelpArticle[];
}

const RelatedArticles: React.FC<RelatedArticlesProps> = ({ articles }) => {
  const { t } = useTranslation('help');
  if (articles.length === 0) return null;
  return (
    <Box component="section" aria-labelledby="help-related-heading" sx={{ mt: 5 }}>
      <Typography id="help-related-heading" variant="h6" component="h2" sx={{ fontWeight: 700, mb: 2 }}>
        {t('article.relatedTitle')}
      </Typography>
      <Grid container spacing={2}>
        {articles.map((article) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={article.slug}>
            <ArticleCard article={article} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default RelatedArticles;
