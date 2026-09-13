import React from 'react';
import { Alert, AlertTitle } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import TipsAndUpdatesOutlinedIcon from '@mui/icons-material/TipsAndUpdatesOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import type { HelpCalloutTone } from '../types';

const TONE_PROPS: Record<
  HelpCalloutTone,
  { severity: 'success' | 'info' | 'warning' | 'error'; icon: React.ElementType }
> = {
  tip: { severity: 'success', icon: TipsAndUpdatesOutlinedIcon },
  info: { severity: 'info', icon: InfoOutlinedIcon },
  warning: { severity: 'warning', icon: WarningAmberOutlinedIcon },
  important: { severity: 'error', icon: ReportProblemOutlinedIcon },
};

interface HelpCalloutProps {
  tone: HelpCalloutTone;
  title?: string;
  body: string;
}

/** Article callout: icon + severity colour + optional title. The tone word in
 * the title/icon carries meaning alongside colour (non-colour cue). */
const HelpCallout: React.FC<HelpCalloutProps> = ({ tone, title, body }) => {
  const { severity, icon } = TONE_PROPS[tone];
  return (
    <Alert severity={severity} iconMapping={{ [severity]: React.createElement(icon) }}>
      {title && <AlertTitle>{title}</AlertTitle>}
      {body}
    </Alert>
  );
};

export default HelpCallout;
