import React from 'react';
import {
  Box,
  Typography,
  Chip,
  Stack,
  alpha,
  Collapse,
  IconButton,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import type { Permission } from '../../../../../types';
import { PERMISSION_CATEGORIES, getCategoryColor } from '../constants';

interface PermissionSummarySectionProps {
  permissions: Permission[];
  allPermissions: Permission[];
}

interface CategoryGroup {
  name: string;
  displayName: string;
  color: string;
  permissions: Permission[];
  totalInCategory: number;
}

const PermissionSummarySection: React.FC<PermissionSummarySectionProps> = ({
  permissions,
  allPermissions,
}) => {
  const [expandedCategories, setExpandedCategories] = React.useState<Set<string>>(new Set());

  // Group assigned permissions by category
  const groupedPermissions = React.useMemo(() => {
    const groups: Record<string, Permission[]> = {};

    permissions.forEach((permission) => {
      let category = permission.resource;
      if (permission.resource.includes(':')) {
        category = permission.resource.split(':')[0];
      }

      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(permission);
    });

    // Count total permissions per category from all permissions
    const totalPerCategory: Record<string, number> = {};
    allPermissions.forEach((permission) => {
      let category = permission.resource;
      if (permission.resource.includes(':')) {
        category = permission.resource.split(':')[0];
      }
      totalPerCategory[category] = (totalPerCategory[category] || 0) + 1;
    });

    // Convert to array with metadata
    const result: CategoryGroup[] = Object.entries(groups)
      .map(([name, perms]) => ({
        name,
        displayName: PERMISSION_CATEGORIES[name]?.displayName || name.charAt(0).toUpperCase() + name.slice(1),
        color: getCategoryColor(name),
        permissions: perms.sort((a, b) => a.name.localeCompare(b.name)),
        totalInCategory: totalPerCategory[name] || perms.length,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    return result;
  }, [permissions, allPermissions]);

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  if (permissions.length === 0) {
    return (
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No permissions assigned yet
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
        Assigned permissions ({permissions.length} total)
      </Typography>

      <Stack spacing={1}>
        {groupedPermissions.map((group) => {
          const isExpanded = expandedCategories.has(group.name);

          return (
            <Box
              key={group.name}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              {/* Category header */}
              <Box
                onClick={() => toggleCategory(group.name)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  px: 1.5,
                  py: 1,
                  backgroundColor: alpha(group.color, 0.05),
                  cursor: 'pointer',
                  '&:hover': {
                    backgroundColor: alpha(group.color, 0.1),
                  },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    sx={{ color: group.color }}
                  >
                    {group.displayName}
                  </Typography>
                  <Chip
                    label={`${group.permissions.length}/${group.totalInCategory}`}
                    size="small"
                    sx={{
                      height: 20,
                      fontSize: '0.7rem',
                      backgroundColor: alpha(group.color, 0.15),
                      color: group.color,
                    }}
                  />
                </Box>
                <IconButton size="small" sx={{ p: 0 }}>
                  {isExpanded ? (
                    <ExpandLessIcon fontSize="small" />
                  ) : (
                    <ExpandMoreIcon fontSize="small" />
                  )}
                </IconButton>
              </Box>

              {/* Permissions list */}
              <Collapse in={isExpanded}>
                <Box sx={{ p: 1.5, pt: 1 }}>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {group.permissions.map((permission) => (
                      <Chip
                        key={permission.id}
                        label={permission.action}
                        size="small"
                        variant="outlined"
                        sx={{
                          borderColor: alpha(group.color, 0.3),
                          color: group.color,
                          fontSize: '0.75rem',
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
};

export default PermissionSummarySection;
