import React from 'react';
import { Box, Card, CardActionArea, Grid, Stack, Typography } from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import { HELP_QUICK_TASKS, helpIconWellSx, helpInteractiveCardSx } from '../constants';

/** The six most common admin jobs, pinned as large touch targets at the top of
 * the hub. Slugs live in HELP_QUICK_TASKS; labels come from i18n. */
const QuickTaskGrid: React.FC = () => {
  const { t } = useTranslation('help');
  return (
    <Grid container spacing={2}>
      {HELP_QUICK_TASKS.map(({ slug, icon: Icon }) => (
        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={slug}>
          <Card variant="outlined" sx={{ height: '100%', ...helpInteractiveCardSx }}>
            <CardActionArea
              component={Link}
              to={`/help/${slug}`}
              sx={{ height: '100%' }}
              aria-label={t(`quickTasks.${slug}.label`)}
            >
              <Stack direction="row" spacing={1.75} sx={{ p: 2, alignItems: 'center' }}>
                <Box sx={{ ...helpIconWellSx, width: 36, height: 36 }}>
                  <Icon sx={{ fontSize: 19 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t(`quickTasks.${slug}.label`)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t(`quickTasks.${slug}.desc`)}
                  </Typography>
                </Box>
                <ArrowForwardIcon
                  sx={{
                    fontSize: 17,
                    color: 'text.disabled',
                    transition: (theme) => theme.transitions.create(['transform', 'color'], { duration: 'shortest' }),
                    '.MuiCardActionArea-root:hover &': { transform: 'translateX(2px)', color: 'primary.main' },
                  }}
                />
              </Stack>
            </CardActionArea>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default QuickTaskGrid;
