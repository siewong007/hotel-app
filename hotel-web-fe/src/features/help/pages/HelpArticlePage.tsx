import React from 'react';
import { Box, Button, Chip, Grid, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import EmptyState from '../../../components/common/EmptyState';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import { useAuth } from '../../../auth/AuthContext';
import { formatHotelDate } from '../../../utils/date';
import { articleTocEntries, estimateReadingMinutes, getArticleBySlug, getRelatedArticles } from '../utils';
import { useHelpArticles } from '../hooks/useHelpArticles';
import ArticleBlocks from '../components/ArticleBlocks';
import ArticleFeedback from '../components/ArticleFeedback';
import ArticleToc from '../components/ArticleToc';
import HelpBreadcrumbs from '../components/HelpBreadcrumbs';
import RelatedArticles from '../components/RelatedArticles';

interface HelpArticlePageProps {
  slug: string;
}

/** Article detail view for /help/<slug>. Composes the block renderer, TOC,
 * related links and feedback around one locale-catalogue article. */
const HelpArticlePage: React.FC<HelpArticlePageProps> = ({ slug }) => {
  const { t } = useTranslation('help');
  const { hasPermission } = useAuth();
  const theme = useTheme();
  const isWide = useMediaQuery(theme.breakpoints.up('lg'));
  const articles = useHelpArticles();
  const article = getArticleBySlug(articles, slug);

  if (!article) {
    return (
      <Box sx={{ py: 4 }}>
        <EmptyState
          icon={<MenuBookOutlinedIcon />}
          title={t('article.notFoundTitle')}
          description={t('article.notFoundBody')}
          action={
            <Button component={Link} to="/help" variant="contained">
              {t('article.browseAll')}
            </Button>
          }
        />
      </Box>
    );
  }

  const toc = articleTocEntries(article);
  const related = getRelatedArticles(article, articles);
  const canOpenModule =
    article.routePath != null &&
    (article.requiredPermissions ?? []).every((perm) => hasPermission(perm));

  return (
    <Box>
      <HelpBreadcrumbs category={article.category} current={article.title} />

      <Grid container spacing={{ xs: 0, lg: 4 }} sx={{ mt: 1.5 }}>
        <Grid size={{ xs: 12, lg: isWide && toc.length >= 2 ? 9 : 12 }}>
          <Box sx={{ maxWidth: 760 }}>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 800, lineHeight: 1.22, letterSpacing: '-0.01em' }}>
            {article.title}
          </Typography>
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mt: 1.25, lineHeight: 1.7, fontSize: '1.05rem' }}
          >
            {article.summary}
          </Typography>

          <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip
              component={Link}
              to="/help"
              search={{ category: article.category } as never}
              size="small"
              variant="outlined"
              color="primary"
              label={t(`categories.${article.category}.name`)}
              clickable
            />
            <Typography variant="caption" color="text.secondary">
              {t('article.lastReviewed', { date: formatHotelDate(article.lastReviewed) })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('article.readingTime', { count: estimateReadingMinutes(article) })}
            </Typography>
          </Stack>

          {article.requiredPermissions && article.requiredPermissions.length > 0 && (
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {t('article.requiresLabel')}:
              </Typography>
              {article.requiredPermissions.map((perm) => (
                <Chip key={perm} size="small" variant="outlined" label={perm} />
              ))}
            </Stack>
          )}

          {article.routePath && canOpenModule && (
            <Button
              component={Link}
              to={article.routePath}
              variant="contained"
              size="small"
              endIcon={<OpenInNewIcon />}
              sx={{ mt: 2 }}
            >
              {t('article.openPage')}
            </Button>
          )}

          {!isWide && <ArticleToc entries={toc} variant="inline" />}

          <Box sx={{ mt: isWide ? 3.5 : 0 }}>
            <ArticleBlocks blocks={article.blocks} />
          </Box>

          <ArticleFeedback slug={article.slug} />
          <RelatedArticles articles={related} />

          <Button
            component={Link}
            to="/help"
            startIcon={<ArrowBackIcon />}
            sx={{ mt: 4 }}
          >
            {t('article.backToHelp')}
          </Button>
          </Box>
        </Grid>

        {isWide && toc.length >= 2 && (
          <Grid size={{ lg: 3 }}>
            <ArticleToc entries={toc} variant="rail" />
          </Grid>
        )}
      </Grid>
    </Box>
  );
};

export default HelpArticlePage;
