import React from 'react';
import { Chip, alpha } from '@mui/material';
import type { Role } from '../../../../../types';
import { getRoleColor } from '../constants';

interface RoleChipProps {
  role: Role;
  onRemove?: () => void;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'small' | 'medium';
}

const RoleChip: React.FC<RoleChipProps> = ({
  role,
  onRemove,
  onClick,
  disabled = false,
  size = 'small',
}) => {
  const color = getRoleColor(role.name);

  return (
    <Chip
      label={role.name}
      size={size}
      onClick={onClick}
      onDelete={onRemove}
      disabled={disabled}
      variant="outlined"
      sx={{
        backgroundColor: alpha(color, 0.1),
        color: color,
        borderColor: alpha(color, 0.5),
        fontWeight: 500,
        '&:hover': {
          backgroundColor: alpha(color, 0.2),
          borderColor: color,
        },
        '& .MuiChip-deleteIcon': {
          color: alpha(color, 0.7),
          '&:hover': {
            color: color,
          },
        },
      }}
    />
  );
};

export default RoleChip;
