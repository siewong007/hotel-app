import React, { useState } from 'react';
import {
  Box,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useTranslation } from '../../i18n';
import { useIsPhone } from '../../hooks/useIsPhone';
import { BottomSheet } from './BottomSheet';

export interface ActionMenuItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** Group key — renders overline section headers in the phone sheet. */
  section?: string;
}

export interface ActionsMenuProps {
  actions: ActionMenuItem[];
  /** Default: MoreVert IconButton with aria-label t('common:actions.moreActions'). */
  trigger?: React.ReactNode;
  /** Title of the BottomSheet on phone. Defaults to t('common:actions.actions'). */
  title?: React.ReactNode;
  /** aria-label for the trigger when the default is used. */
  triggerLabel?: string;
}

interface ActionGroup {
  /** `undefined` marks the unsectioned group: renders first, without a header. */
  section?: string;
  items: ActionMenuItem[];
}

/** Declared order, except destructive items trail non-destructive ones. */
const sortDestructiveLast = (items: ActionMenuItem[]): ActionMenuItem[] => [
  ...items.filter((item) => !item.destructive),
  ...items.filter((item) => item.destructive),
];

/**
 * Drops `hidden` items and groups the rest: unsectioned items first (no
 * header), then each `section` in first-appearance order under one overline
 * header. Within every group, destructive items sort after the rest.
 */
const groupActions = (actions: ActionMenuItem[]): ActionGroup[] => {
  const unsectioned: ActionMenuItem[] = [];
  const sections = new Map<string, ActionMenuItem[]>();
  for (const action of actions) {
    if (action.hidden) continue;
    if (action.section === undefined) {
      unsectioned.push(action);
    } else {
      const list = sections.get(action.section);
      if (list) {
        list.push(action);
      } else {
        sections.set(action.section, [action]);
      }
    }
  }
  const groups: ActionGroup[] = [];
  if (unsectioned.length > 0) {
    groups.push({ items: sortDestructiveLast(unsectioned) });
  }
  for (const [section, items] of sections) {
    groups.push({ section, items: sortDestructiveLast(items) });
  }
  return groups;
};

/**
 * The shared overflow menu: a `MoreVert` trigger that opens a MUI `Menu` on
 * desktop and a `BottomSheet` action list on phone. Item clicks close the
 * surface first, then run the action. When every action is `hidden` nothing
 * renders — callers don't need to gate the trigger themselves.
 */
export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  actions,
  trigger,
  title,
  triggerLabel,
}) => {
  const isPhone = useIsPhone();
  const { t } = useTranslation('common');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const groups = groupActions(actions);
  const open = isPhone ? sheetOpen : Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    if (isPhone) {
      setSheetOpen(true);
    } else {
      setAnchorEl(event.currentTarget);
    }
  };

  const handleClose = () => {
    setSheetOpen(false);
    setAnchorEl(null);
  };

  const handleActionClick = (action: ActionMenuItem) => {
    handleClose();
    action.onClick();
  };

  if (groups.length === 0) return null;

  return (
    <>
      {trigger ? (
        <Box component="span" onClick={handleOpen} sx={{ display: 'inline-flex' }}>
          {trigger}
        </Box>
      ) : (
        <IconButton
          aria-label={triggerLabel ?? t('actions.moreActions')}
          aria-haspopup={isPhone ? 'dialog' : 'menu'}
          aria-expanded={open}
          onClick={handleOpen}
        >
          <MoreVertIcon />
        </IconButton>
      )}

      {isPhone ? (
        <BottomSheet open={sheetOpen} onClose={handleClose} title={title ?? t('actions.actions')}>
          <List disablePadding sx={{ mx: -2 }}>
            {groups.flatMap((group) => {
              const items = group.items.map((action) => (
                <ListItemButton
                  key={action.id}
                  disabled={action.disabled}
                  onClick={() => handleActionClick(action)}
                  sx={action.destructive ? { color: 'error.main' } : undefined}
                >
                  {action.icon ? (
                    <ListItemIcon sx={{ color: 'inherit' }}>{action.icon}</ListItemIcon>
                  ) : null}
                  <ListItemText primary={action.label} />
                </ListItemButton>
              ));
              if (group.section !== undefined) {
                items.unshift(
                  <ListSubheader
                    key={`section-${group.section}`}
                    sx={{
                      typography: 'overline',
                      color: 'text.secondary',
                      bgcolor: 'background.paper',
                    }}
                  >
                    {group.section}
                  </ListSubheader>,
                );
              }
              return items;
            })}
          </List>
        </BottomSheet>
      ) : (
        <Menu
          anchorEl={anchorEl}
          open={Boolean(anchorEl)}
          onClose={handleClose}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {groups.flatMap((group, groupIndex) => {
            const items = group.items.map((action) => (
              <MenuItem
                key={action.id}
                disabled={action.disabled}
                onClick={() => handleActionClick(action)}
                sx={action.destructive ? { color: 'error.main' } : undefined}
              >
                {action.icon ? (
                  <ListItemIcon sx={{ color: 'inherit' }}>{action.icon}</ListItemIcon>
                ) : null}
                <ListItemText>{action.label}</ListItemText>
              </MenuItem>
            ));
            if (groupIndex > 0) {
              items.unshift(<Divider key={`divider-${group.section ?? groupIndex}`} />);
            }
            return items;
          })}
        </Menu>
      )}
    </>
  );
};

export default ActionsMenu;
