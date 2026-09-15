// "Company info" tab body of the ledger detail pane: contact + billing terms.

import React from 'react';
import { Box, Typography, Button } from '@mui/material';
import { Edit as EditIcon } from '@mui/icons-material';
import type { Company } from '../../../../../types';
import { InfoField } from '../StatusPill';
import { subtractMoney, toMoneyNumber } from '../../../../../utils/money';
import { useTranslation } from '../../../../../i18n';

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
  const { t } = useTranslation('finance');
  return (
    <Box sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<EditIcon fontSize="small" />}
          onClick={onEdit}
        >
          {t('ledger.editCompany')}
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
        {t('ledger.sections.contact')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: '14px 22px',
          mb: 3,
        }}
      >
        <InfoField label={t('common:field.phone')} value={company.contact_phone || '-'} />
        <InfoField label={t('ledger.field.contactPerson')} value={company.contact_person || '-'} />
        <InfoField label={t('common:field.email')} value={company.contact_email || '-'} />
        <InfoField
          label={t('ledger.field.registrationNo')}
          value={company.registration_number || '-'}
        />
        <InfoField
          label={t('common:field.address')}
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
        {t('ledger.sections.billingTerms')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          gap: '14px 22px',
        }}
      >
        <InfoField
          label={t('ledger.field.creditLimit')}
          value={
            company.credit_limit != null
              ? formatCurrency(toMoneyNumber(company.credit_limit))
              : '-'
          }
        />
        <InfoField
          label={t('ledger.field.paymentTerms')}
          value={t('ledger.paymentTermsValue', { days: company.payment_terms_days || 30 })}
        />
        <InfoField
          label={t('ledger.field.availableCredit')}
          value={
            company.credit_limit != null
              ? formatCurrency(
                  Math.max(subtractMoney(company.credit_limit, dueAmount), 0),
                )
              : '-'
          }
        />
      </Box>
    </Box>
  );
};

export default CompanyInfoTab;
