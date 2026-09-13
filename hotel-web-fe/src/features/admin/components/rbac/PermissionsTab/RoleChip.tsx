import React from 'react';
import { Chip } from '@mui/material';
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
        backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
        color: color,
        borderColor: `color-mix(in srgb, ${color} 50%, transparent)`,
        fontWeight: 500,
        '&:hover': {
          backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
          borderColor: color,
        },
        '& .MuiChip-deleteIcon': {
          color: `color-mix(in srgb, ${color} 70%, transparent)`,
          '&:hover': {
            color: color,
          },
        },
      }}
    />
  );
};

export default RoleChip;
