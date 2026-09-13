import React from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import { helpIconWellSx } from '../constants';

/** "Still stuck?" card. Escalation is process guidance (manager → system owner
 * → vendor), not an invented ticket system — the CTA opens the escalation
 * article, which describes the real path. */
const EscalationCard: React.FC = () => {
  const { t } = useTranslation('help');
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5 }}>
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <Box sx={helpIconWellSx}>
            <SupportAgentOutlinedIcon sx={{ fontSize: 21 }} />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {t('hub.escalationTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.65 }}>
            {t('hub.escalationBody')}
          </Typography>
          <Button
            component={Link}
            to="/help/escalation"
            variant="outlined"
            size="small"
          >
            {t('hub.escalationLink')}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {t('hub.supportInboxNote')}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default EscalationCard;
