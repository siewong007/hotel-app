import React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import PageHeader from '../../../components/common/PageHeader';
import EmptyState from '../../../components/common/EmptyState';
import { useSearchParams } from '../../../router';
import { useTranslation } from '../../../i18n';
import { HELP_CATEGORIES, HELP_CATEGORY_IDS } from '../constants';
import {
  getArticlesByCategory,
  getCategoryCounts,
  getFeaturedArticles,
} from '../utils';
import { useHelpArticles } from '../hooks/useHelpArticles';
import ArticleCard from '../components/ArticleCard';
import CategoryCard from '../components/CategoryCard';
import EscalationCard from '../components/EscalationCard';
import HelpBreadcrumbs from '../components/HelpBreadcrumbs';
import HelpSearchBar from '../components/HelpSearchBar';
import QuickTaskGrid from '../components/QuickTaskGrid';
import TroubleshootingStrip from '../components/TroubleshootingStrip';
import type { HelpCategoryId } from '../types';

const Section: React.FC<{
  id: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}> = ({ id, title, subtitle, children }) => (
  <Box component="section" aria-labelledby={id} sx={{ mt: 6 }}>
    <Typography id={id} variant="h6" component="h2" sx={{ fontWeight: 700 }}>
      {title}
    </Typography>
    {subtitle && (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
        {subtitle}
      </Typography>
    )}
    <Box sx={{ mt: 2 }}>{children}</Box>
  </Box>
);

/**
 * Help Centre hub. Two modes driven by the ?category= search param: the full
 * hub (search-first hero, quick tasks, categories, popular, troubleshooting,
 * escalation) or a single-category listing. The param keeps category browsing
 * inside the existing /help route id — no new route policy rows needed.
 */
const HelpCenterPage: React.FC = () => {
  const { t } = useTranslation('help');
  const articles = useHelpArticles();
  const [searchParams] = useSearchParams();

  const rawCategory = searchParams.get('category');
  const activeCategory: HelpCategoryId | null = HELP_CATEGORY_IDS.includes(
    rawCategory as HelpCategoryId,
  )
    ? (rawCategory as HelpCategoryId)
    : null;

  if (activeCategory) {
    const categoryArticles = getArticlesByCategory(articles, activeCategory);
    return (
      <Box component="section" aria-label={t('aria.helpNavigation')}>
        <HelpBreadcrumbs category={activeCategory} />
        <PageHeader
          title={t(`categories.${activeCategory}.name`)}
          subtitle={t(`categories.${activeCategory}.desc`)}
          sx={{ mt: 1.5 }}
        />
        <Box sx={{ maxWidth: 680, mb: 3 }}>
          <HelpSearchBar />
        </Box>
        {categoryArticles.length === 0 ? (
          <EmptyState
            icon={<MenuBookOutlinedIcon />}
            title={t('search.noResultsTitle')}
            description={t('search.noResultsBody')}
          />
        ) : (
          <Grid container spacing={2}>
            {categoryArticles.map((article) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={article.slug}>
                <ArticleCard article={article} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    );
  }

  const counts = getCategoryCounts(articles);
  const featured = getFeaturedArticles(articles);

  return (
    <Box component="section" aria-label={t('aria.helpNavigation')}>
      {/* Search-first hero: a calm, whisper-tinted surface — the only place
          the brand accent leads, which is what keeps it feeling restrained. */}
      <Box
        sx={(theme) => ({
          border: '1px solid',
          borderColor: alpha(theme.palette.primary.main, 0.1),
          bgcolor: alpha(theme.palette.primary.main, 0.035),
          borderRadius: 3,
          px: { xs: 2.5, sm: 4, md: 6 },
          py: { xs: 4, sm: 5, md: 6 },
        })}
      >
        <Box sx={{ maxWidth: 680 }}>
          <Typography
            variant="overline"
            sx={{ color: 'primary.main', letterSpacing: '0.12em', fontWeight: 700 }}
          >
            {t('hub.kicker')}
          </Typography>
          <Typography
            variant="h4"
            component="h1"
            sx={{ fontWeight: 800, lineHeight: 1.2, mt: 0.5 }}
          >
            {t('hub.title')}
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, mb: 3, lineHeight: 1.65 }}>
            {t('hub.subtitle')}
          </Typography>
          <HelpSearchBar />
        </Box>
      </Box>

      <Section id="help-quick-tasks" title={t('hub.quickTasksTitle')} subtitle={t('hub.quickTasksSubtitle')}>
        <QuickTaskGrid />
      </Section>

      <Section id="help-categories" title={t('hub.categoriesTitle')}>
        <Grid container spacing={2}>
          {HELP_CATEGORIES.map((category) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={category.id}>
              <CategoryCard category={category} articleCount={counts[category.id] ?? 0} />
            </Grid>
          ))}
        </Grid>
      </Section>

      {featured.length > 0 && (
        <Section id="help-popular" title={t('hub.popularTitle')}>
          <Grid container spacing={2}>
            {featured.map((article) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={article.slug}>
                <ArticleCard article={article} />
              </Grid>
            ))}
          </Grid>
        </Section>
      )}

      <Grid container spacing={2} sx={{ mt: 6 }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <TroubleshootingStrip />
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <EscalationCard />
        </Grid>
      </Grid>
    </Box>
  );
};

export default HelpCenterPage;
