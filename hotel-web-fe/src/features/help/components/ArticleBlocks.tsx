import React from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Typography } from '@mui/material';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import type { HelpBlock } from '../types';
import FaqAccordion from './FaqAccordion';
import HelpCallout from './HelpCallout';
import StepsList from './StepsList';

interface ArticleBlocksProps {
  blocks: HelpBlock[];
}

/** Renders one HelpBlock list. Heading blocks carry `section-<index>` anchors
 * so the table of contents can deep-link into the page; scrollMarginTop keeps
 * them clear of the sticky app bar (64px + 46px rows). */
const ArticleBlocks: React.FC<ArticleBlocksProps> = ({ blocks }) => (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}>
    {blocks.map((block, index) => {
      switch (block.type) {
        case 'heading':
          return (
            <Typography
              key={index}
              id={`section-${index}`}
              variant="h6"
              component="h2"
              sx={{ fontWeight: 700, scrollMarginTop: '130px', mt: index === 0 ? 0 : 1 }}
            >
              {block.text}
            </Typography>
          );
        case 'paragraph':
          return (
            <Typography key={index} variant="body1" color="text.secondary" sx={{ lineHeight: 1.75 }}>
              {block.text}
            </Typography>
          );
        case 'list':
          return (
            <List key={index} component={block.ordered ? 'ol' : 'ul'} dense disablePadding sx={{ pl: 1.5, listStyle: block.ordered ? 'decimal' : 'disc', listStylePosition: 'outside' }}>
              {block.items.map((item, i) => (
                <ListItem key={i} disableGutters sx={{ display: 'list-item', py: 0.4, pl: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                    {item}
                  </Typography>
                </ListItem>
              ))}
            </List>
          );
        case 'checklist':
          return (
            <List key={index} dense disablePadding>
              {block.items.map((item, i) => (
                <ListItem key={i} disableGutters sx={{ alignItems: 'flex-start', py: 0.5 }}>
                  <ListItemIcon sx={{ minWidth: 32, mt: 0.2 }}>
                    <CheckCircleOutlinedIcon color="success" fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={item}
                    slotProps={{ primary: { variant: 'body2', color: 'text.secondary', sx: { lineHeight: 1.7 } } }}
                  />
                </ListItem>
              ))}
            </List>
          );
        case 'steps':
          return <StepsList key={index} steps={block.steps} />;
        case 'callout':
          return <HelpCallout key={index} tone={block.tone} title={block.title} body={block.body} />;
        case 'faq':
          return <FaqAccordion key={index} items={block.items} />;
        default:
          return null;
      }
    })}
  </Box>
);

export default ArticleBlocks;
