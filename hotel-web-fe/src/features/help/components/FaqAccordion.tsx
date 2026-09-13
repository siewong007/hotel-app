import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { HelpFaqItem } from '../types';

interface FaqAccordionProps {
  items: HelpFaqItem[];
}

/** FAQ block: one question per accordion — MUI supplies keyboard support,
 * aria-expanded and focus management out of the box. */
const FaqAccordion: React.FC<FaqAccordionProps> = ({ items }) => (
  <>
    {items.map((item, index) => (
      <Accordion key={index} disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', '&:not(:last-child)': { mb: 1 } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls={`faq-panel-${index}`} id={`faq-header-${index}`}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {item.q}
          </Typography>
        </AccordionSummary>
        <AccordionDetails id={`faq-panel-${index}`}>
          <Typography variant="body2" color="text.secondary">
            {item.a}
          </Typography>
        </AccordionDetails>
      </Accordion>
    ))}
  </>
);

export default FaqAccordion;
