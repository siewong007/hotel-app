import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import ThumbDownOutlinedIcon from '@mui/icons-material/ThumbDownOutlined';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import { useTranslation } from '../../../i18n';
import { HELP_FEEDBACK_KEY } from '../constants';
import { emitApiNotification } from '../../../utils/apiNotifications';
import { storage } from '../../../utils/storage';

interface ArticleFeedbackProps {
  slug: string;
}

type FeedbackMap = Record<string, 'up' | 'down'>;

/** "Was this helpful?" — persisted locally per article (no backend endpoint
 * exists; a server-side analytics sink is a documented phase-2 option). */
const ArticleFeedback: React.FC<ArticleFeedbackProps> = ({ slug }) => {
  const { t } = useTranslation('help');
  const [vote, setVote] = React.useState<'up' | 'down' | null>(
    () => storage.getItem<FeedbackMap>(HELP_FEEDBACK_KEY)?.[slug] ?? null,
  );

  const submit = (choice: 'up' | 'down') => {
    const map = storage.getItem<FeedbackMap>(HELP_FEEDBACK_KEY) ?? {};
    storage.setItem(HELP_FEEDBACK_KEY, { ...map, [slug]: choice });
    setVote(choice);
    emitApiNotification({ message: t('article.feedbackThanks'), severity: 'success' });
  };

  return (
    <Box
      component="section"
      aria-labelledby="help-feedback-heading"
      sx={(theme) => ({
        mt: 5,
        p: 2.5,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: theme.palette.action.hover,
      })}
    >
      <Box>
        <Typography id="help-feedback-heading" variant="subtitle1" sx={{ fontWeight: 700 }}>
          {t('article.feedbackTitle')}
        </Typography>
        {vote && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {vote === 'up' ? t('article.feedbackVotedYes') : t('article.feedbackVotedNo')}
          </Typography>
        )}
      </Box>
      {!vote && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<ThumbUpOutlinedIcon />}
            onClick={() => submit('up')}
            sx={{ bgcolor: 'background.paper' }}
          >
            {t('article.feedbackYes')}
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="inherit"
            startIcon={<ThumbDownOutlinedIcon />}
            onClick={() => submit('down')}
            sx={{ bgcolor: 'background.paper' }}
          >
            {t('article.feedbackNo')}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default ArticleFeedback;
