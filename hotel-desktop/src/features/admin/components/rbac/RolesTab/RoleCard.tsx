import React from 'react';
import {
  Card,
  CardContent,
  CardActionArea,
  Box,
  Typography,
  IconButton,
  Chip,
  Stack,
  alpha,
  Tooltip,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Navigation as NavigationIcon,
  VpnKey as PermissionIcon,
  AdminPanelSettings as AdminIcon,
  SupervisorAccount as ManagerIcon,
  Person as PersonIcon,
  PersonOutline as GuestIcon,
} from '@mui/icons-material';
import type { RoleWithStats } from '../types';
import { getRoleColor } from '../constants';

// Icon mapping for roles
const ROLE_ICON_MAP: Record<string, React.ElementType> = {
  admin: AdminIcon,
  manager: ManagerIcon,
  receptionist: PersonIcon,
  guest: GuestIcon,
};

interface RoleCardProps {
  role: RoleWithStats;
  onEdit: (role: RoleWithStats) => void;
  onDelete: (role: RoleWithStats) => void;
}

const RoleCard: React.FC<RoleCardProps> = ({ role, onEdit, onDelete }) => {
  const color = getRoleColor(role.name);
  const IconComponent = ROLE_ICON_MAP[role.name.toLowerCase()] || PersonIcon;

  return (
    <Card
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          borderColor: alpha(color, 0.5),
          boxShadow: `0 4px 12px ${alpha(color, 0.15)}`,
        },
      }}
    >
      <CardActionArea onClick={() => onEdit(role)} sx={{ p: 0 }}>
        <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            {/* Role Icon */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 48,
                height: 48,
                borderRadius: 2,
                backgroundColor: alpha(color, 0.1),
                color: color,
              }}
            >
              <IconComponent />
            </Box>

            {/* Role Info */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
                {role.name}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {role.description || 'No description'}
              </Typography>

              {/* Stats */}
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <Chip
                  icon={<NavigationIcon sx={{ fontSize: 16 }} />}
                  label={`${role.navigationCount} tabs`}
                  size="small"
                  sx={{
                    backgroundColor: alpha('#9c27b0', 0.1),
                    color: '#9c27b0',
                    fontWeight: 500,
                    '& .MuiChip-icon': { color: 'inherit' },
                  }}
                />
                <Chip
                  icon={<PermissionIcon sx={{ fontSize: 16 }} />}
                  label={`${role.permissionCount} permissions`}
                  size="small"
                  sx={{
                    backgroundColor: alpha('#1976d2', 0.1),
                    color: '#1976d2',
                    fontWeight: 500,
                    '& .MuiChip-icon': { color: 'inherit' },
                  }}
                />
              </Stack>
            </Box>

            {/* Actions */}
            <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
              <Tooltip title="Edit role">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(role);
                  }}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: 'primary.main' },
                  }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete role">
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(role);
                  }}
                  sx={{
                    color: 'text.secondary',
                    '&:hover': { color: 'error.main' },
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
};

export default RoleCard;
