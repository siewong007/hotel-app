import { ArrowBack, Home, Lock, LockPerson, SearchOff } from '@mui/icons-material';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import { Link } from '@tanstack/react-router';
import { useTranslation } from '../../i18n';

type StatusPageProps = {
  statusCode: 403 | 404 | 423;
};

/** Icon + `errors.page.*` translation keys per status code. */
const STATUS_CONTENT = {
  403: {
    titleKey: 'page.forbiddenTitle',
    messageKey: 'page.forbiddenMessage',
    icon: LockPerson,
  },
  404: {
    titleKey: 'page.notFoundTitle',
    messageKey: 'page.notFoundMessage',
    icon: SearchOff,
  },
  423: {
    titleKey: 'page.lockedTitle',
    messageKey: 'page.lockedMessage',
    icon: Lock,
  },
} as const;

export function StatusPage({ statusCode }: StatusPageProps) {
  const { t } = useTranslation('errors');
  const { titleKey, messageKey, icon: Icon } = STATUS_CONTENT[statusCode];
  const title = t(titleKey);
  const message = t(messageKey);

  return (
    <Box
      sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center', py: 4 }}
      role="main"
      aria-labelledby="status-page-title"
    >
      <Paper elevation={0} sx={{ maxWidth: 520, width: '100%', p: { xs: 3, sm: 5 }, textAlign: 'center' }}>
        <Stack spacing={2.5} sx={{
          alignItems: "center"
        }}>
          <Icon color="primary" sx={{ fontSize: 56 }} aria-hidden="true" />
          <Typography variant="overline" sx={{
            color: "text.secondary"
          }}>{t('page.errorLabel', { code: statusCode })}</Typography>
          <Typography id="status-page-title" variant="h4" component="h1">{title}</Typography>
          <Typography sx={{
            color: "text.secondary"
          }}>{message}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{
            justifyContent: "center"
          }}>
            <Button component={Link} to="/" variant="contained" startIcon={<Home />}>
              {t('common:actions.goHome')}
            </Button>
            <Button variant="outlined" startIcon={<ArrowBack />} onClick={() => window.history.back()}>
              {t('common:actions.goBack')}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
