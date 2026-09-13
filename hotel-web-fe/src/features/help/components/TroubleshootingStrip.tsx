import React from 'react';
import { Card, CardContent, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import { Link } from '../../../router';
import { useTranslation } from '../../../i18n';
import { HELP_TROUBLESHOOTING_SLUGS } from '../constants';

/** "Something went wrong" rail — diagnostic articles for the failures staff
 * actually hit, framed as problems rather than feature docs. */
const TroubleshootingStrip: React.FC = () => {
  const { t } = useTranslation('help');
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
          {t('hub.troubleshootingTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('hub.troubleshootingSubtitle')}
        </Typography>
        <List dense disablePadding>
          {HELP_TROUBLESHOOTING_SLUGS.map((slug) => (
            <ListItem key={slug} disableGutters disablePadding>
              <ListItemButton component={Link} to={`/help/${slug}`} sx={{ borderRadius: 1.5 }}>
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <ReportProblemOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </ListItemIcon>
                <ListItemText
                  primary={t(`troubleshootingLinks.${slug}`)}
                  slotProps={{ primary: { variant: 'body2' } }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </CardContent>
    </Card>
  );
};

export default TroubleshootingStrip;
