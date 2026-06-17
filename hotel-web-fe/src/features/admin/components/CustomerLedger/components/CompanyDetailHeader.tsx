// Header row of the ledger detail pane: company avatar/name/contact + the
// print-statement and delete-company actions.

import React from 'react';
import { Box, Typography, Chip, IconButton, Tooltip } from '@mui/material';
import {
  Print as PrintIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import type { Company } from '../../../../../types';
import { companyInitials } from '../helpers';

interface CompanyDetailHeaderProps {
  company: Company;
  entryCount: number;
  hasActiveBookings: boolean;
  formatCurrency: (value: number) => string;
  onPrintStatement: () => void;
  onDelete: () => void;
}

const CompanyDetailHeader: React.FC<CompanyDetailHeaderProps> = ({
  company,
  entryCount,
  hasActiveBookings,
  formatCurrency,
  onPrintStatement,
  onDelete,
}) => {
  return (
    <Box
      sx={{
        px: 2.5,
        py: 2,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr auto' },
        gap: 2,
        alignItems: 'start',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 1.5,
            bgcolor: 'success.main',
            color: 'success.contrastText',
            display: 'grid',
            placeItems: 'center',
            fontSize: 15,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {companyInitials(company.company_name)}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            variant="h6"
            sx={{ fontWeight: 700, letterSpacing: '-0.3px', lineHeight: 1.2 }}
            noWrap
          >
            {company.company_name}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              mt: 0.5,
              flexWrap: 'wrap',
              color: 'text.secondary',
              fontSize: 12,
            }}
          >
            <span>{company.contact_phone || '-'}</span>
            <Box component="span" sx={{ color: 'text.disabled' }}>/</Box>
            <span>{company.contact_person || '-'}</span>
            <Box component="span" sx={{ color: 'text.disabled' }}>/</Box>
            <Chip
              size="small"
              label={`Net ${company.payment_terms_days || 30}d`}
              sx={{ height: 20, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3 }}
            />
            {company.credit_limit != null && (
              <Chip
                size="small"
                label={`Limit ${formatCurrency(parseFloat(String(company.credit_limit)))}`}
                sx={{ height: 20, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3 }}
              />
            )}
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Tooltip title="Print statement">
          <span>
            <IconButton
              size="small"
              onClick={onPrintStatement}
              disabled={entryCount === 0}
            >
              <PrintIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete company">
          <span>
            <IconButton
              size="small"
              color="error"
              onClick={onDelete}
              disabled={hasActiveBookings}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default CompanyDetailHeader;
