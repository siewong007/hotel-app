import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Accordion, AccordionDetails, AccordionSummary, Box, Link, Typography } from '@mui/material';
import { useTranslation } from '../../../i18n';
import { SALIM_INN_MAPS_URL } from '../salimInnPlace';

const FAQ_KEYS = [
  'checkIn',
  'confirmed',
  'cancel',
  'wifi',
  'location',
  'contact',
  'change',
  'late',
  'identity',
] as const;

/** The same answers as the public landing FAQ, for signed-in guests. */
export function GuestFaq() {
  const { t } = useTranslation('guestPortal');
  return (
    <Box component="section" aria-labelledby="guest-faq-title" sx={{ mb: 3 }}>
      <Typography id="guest-faq-title" variant="h6" sx={{ fontWeight: 700, color: 'var(--hotel-text)' }}>
        {t('faq.title')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 1.5 }}>
        {t('faq.intro')}
      </Typography>
      {FAQ_KEYS.map((key) => (
        <Accordion key={key} disableGutters elevation={0} sx={{ bgcolor: 'transparent', '&:before': { display: 'none' }, borderBottom: '1px solid var(--hotel-border)' }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls={`guest-faq-${key}-panel`} id={`guest-faq-${key}`}>
            <Typography sx={{ fontWeight: 600 }}>{t(`faq.${key}.q`)}</Typography>
          </AccordionSummary>
          <AccordionDetails id={`guest-faq-${key}-panel`}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t(`faq.${key}.a`)}</Typography>
            {key === 'location' ? (
              <Link href={SALIM_INN_MAPS_URL} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-block', mt: 1 }}>
                {t('faq.maps')}
              </Link>
            ) : null}
            {key === 'identity' ? (
              <Link href="/guest-portal?section=identity" sx={{ display: 'inline-block', mt: 1 }}>
                {t('faq.identityLink')}
              </Link>
            ) : null}
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  );
}
