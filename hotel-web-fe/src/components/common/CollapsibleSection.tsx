import React, { useId, useState } from 'react';
import { Box, ButtonBase, Collapse, IconButton, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useTranslation } from '../../i18n';
import { useIsPhone } from '../../hooks/useIsPhone';

export interface CollapsibleSectionProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-of-title element (e.g. count chip). */
  badge?: React.ReactNode;
  /** Further header-right controls rendered before the chevron. */
  actions?: React.ReactNode;
  /** Initial expanded state. Default true. */
  defaultExpanded?: boolean;
  /** When true the section STARTS collapsed only while useIsPhone() is true
      (evaluated once at mount). */
  collapseOnPhone?: boolean;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * A titled section whose body collapses behind a header tap. The header is a
 * real button carrying `aria-expanded`; the trailing chevron IconButton is a
 * second, labelled toggle so assistive tech announces "Expand"/"Collapse".
 * `collapseOnPhone` only chooses the *initial* state — the phone predicate is
 * read once inside the `useState` initializer, so rotating/resizing never
 * re-collapses a section the user already opened. The body unmounts while
 * collapsed (`unmountOnExit`), which keeps long mobile pages cheap.
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  subtitle,
  badge,
  actions,
  defaultExpanded = true,
  collapseOnPhone = false,
  children,
  sx,
}) => {
  const isPhone = useIsPhone();
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(() =>
    collapseOnPhone && isPhone ? false : defaultExpanded,
  );
  const contentId = useId();

  const handleToggle = () => setExpanded((prev) => !prev);
  const handleActionsClick = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <Box component="section" sx={sx}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <ButtonBase
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          sx={{
            flex: 1,
            minWidth: 0,
            justifyContent: 'flex-start',
            gap: 1,
            px: 1.5,
            py: 1,
            textAlign: 'left',
            borderRadius: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography
                variant="caption"
                sx={{ display: 'block', color: 'text.secondary' }}
              >
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {badge}
        </ButtonBase>
        {actions ? (
          <Box
            onClick={handleActionsClick}
            sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
          >
            {actions}
          </Box>
        ) : null}
        <IconButton
          size="small"
          onClick={handleToggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? t('actions.collapse') : t('actions.expand')}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: (theme) => theme.transitions.create('transform'),
            }}
          />
        </IconButton>
      </Box>
      <Collapse in={expanded} unmountOnExit id={contentId}>
        {children}
      </Collapse>
    </Box>
  );
};

export default CollapsibleSection;
