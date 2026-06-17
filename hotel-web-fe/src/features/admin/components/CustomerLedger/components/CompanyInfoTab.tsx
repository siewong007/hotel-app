// "Company info" tab body of the ledger detail pane: contact + billing terms.

import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import type { Company } from '../../../../../types';
import { InfoField } from '../StatusPill';

interface CompanyInfoTabProps {
  company: Company;
  dueAmount: number;
  formatCurrency: (value: number) => string;
  onEdit: () => void;
}

const CompanyInfoTab: React.FC<CompanyInfoTabProps> = ({
  company,
  dueAmount,
  formatCurrency,
  onEdit,
}) => {
  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon fontSize="small" />}
          onClick={onEdit}
        >
          Edit company
        </Button>
      </Box>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontWeight: 700,
          color: 'text.secondary',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          mb: 1.5,
        }}
      >
        Contact
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: '14px 22px',
          mb: 3,
        }}
      >
        <InfoField label="Phone" value={company.contact_phone || '-'} />
        <InfoField label="Contact person" value={company.contact_person || '-'} />
        <InfoField label="Email" value={company.contact_email || '-'} />
        <InfoField
          label="Registration no."
          value={company.registration_number || '-'}
        />
        <InfoField
          label="Address"
          value={
            [
              company.billing_address,
              company.billing_city,
              company.billing_state,
              company.billing_postal_code,
            ]
              .filter(Boolean)
              .join(', ') || '-'
          }
          span={2}
        />
      </Box>

      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontWeight: 700,
          color: 'text.secondary',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          mb: 1.5,
        }}
      >
        Billing terms
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: '14px 22px',
        }}
      >
        <InfoField
          label="Credit limit"
          value={
            company.credit_limit != null
              ? formatCurrency(parseFloat(String(company.credit_limit)))
              : '-'
          }
        />
        <InfoField
          label="Payment terms"
          value={`Net ${company.payment_terms_days || 30} days`}
        />
        <InfoField
          label="Available credit"
          value={
            company.credit_limit != null
              ? formatCurrency(
                  Math.max(parseFloat(String(company.credit_limit)) - dueAmount, 0),
                )
              : '-'
          }
        />
      </Box>
    </Box>
  );
};

export default CompanyInfoTab;
