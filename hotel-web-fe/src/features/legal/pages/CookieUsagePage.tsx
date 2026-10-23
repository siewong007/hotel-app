import React from 'react';
import { Box, Button, Container, Paper, Stack, Typography } from '@mui/material';
import { cookieUsage, localize } from '../content';
import { useLegalLocale } from '../LegalLocaleContext';

const CookieUsagePage: React.FC = () => {
  const { locale } = useLegalLocale();

  return (
    <Box lang={locale} sx={{ minHeight: '100vh', py: { xs: 4, sm: 8 }, bgcolor: 'background.default' }}>
      <Container maxWidth="md">
        <Paper component="article" elevation={0} sx={{ p: { xs: 3, sm: 6 }, border: 1, borderColor: 'divider', borderRadius: 3 }}>
          <Stack spacing={4}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <Button href="/salim-inn/">Salim Inn</Button>
            </Box>
            <Box>
              <Typography component="h1" variant="h3" sx={{ mb: 3 }}>
                {localize(cookieUsage.title, locale)}
              </Typography>
              <Stack spacing={2}>
                {cookieUsage.paragraphs.map((paragraph) => (
                  <Typography key={paragraph.en} color="text.secondary" sx={{ lineHeight: 1.8 }}>
                    {localize(paragraph, locale)}
                  </Typography>
                ))}
              </Stack>
            </Box>
            <Button href="/legal/privacy" sx={{ alignSelf: 'flex-start' }}>
              {localize(cookieUsage.privacyLink, locale)}
            </Button>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
};

export default CookieUsagePage;
