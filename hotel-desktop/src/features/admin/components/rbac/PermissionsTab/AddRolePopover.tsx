import React, { useState } from 'react';
import {
  Popover,
  List,
  ListItemButton,
  ListItemText,
  Typography,
  Box,
  CircularProgress,
  Divider,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import type { Role } from '../../../../../types';
import { getRoleColor } from '../constants';

interface AddRolePopoverProps {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  availableRoles: Role[];
  onAddRole: (role: Role) => Promise<void>;
  loading?: boolean;
}

const AddRolePopover: React.FC<AddRolePopoverProps> = ({
  anchorEl,
  onClose,
  availableRoles,
  onAddRole,
  loading = false,
}) => {
  const [addingRoleId, setAddingRoleId] = useState<number | null>(null);

  const handleAddRole = async (role: Role) => {
    setAddingRoleId(role.id);
    try {
      await onAddRole(role);
      onClose();
    } catch (err) {
      // Error handled by parent
    } finally {
      setAddingRoleId(null);
    }
  };

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{
        vertical: 'bottom',
        horizontal: 'left',
      }}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
      PaperProps={{
        sx: { minWidth: 200, maxHeight: 300 },
      }}
    >
      <Box sx={{ p: 1.5, pb: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Add role to permission
        </Typography>
      </Box>
      <Divider />
      {availableRoles.length === 0 ? (
        <Box sx={{ p: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            All roles have this permission
          </Typography>
        </Box>
      ) : (
        <List dense sx={{ py: 0.5 }}>
          {availableRoles.map((role) => (
            <ListItemButton
              key={role.id}
              onClick={() => handleAddRole(role)}
              disabled={loading || addingRoleId === role.id}
              sx={{
                py: 1,
                '&:hover': {
                  backgroundColor: `${getRoleColor(role.name)}10`,
                },
              }}
            >
              <ListItemText
                primary={role.name}
                secondary={role.description}
                primaryTypographyProps={{
                  fontWeight: 500,
                  color: getRoleColor(role.name),
                }}
                secondaryTypographyProps={{
                  variant: 'caption',
                  noWrap: true,
                }}
              />
              {addingRoleId === role.id ? (
                <CircularProgress size={16} sx={{ ml: 1 }} />
              ) : (
                <AddIcon fontSize="small" sx={{ ml: 1, opacity: 0.5 }} />
              )}
            </ListItemButton>
          ))}
        </List>
      )}
    </Popover>
  );
};

export default AddRolePopover;
