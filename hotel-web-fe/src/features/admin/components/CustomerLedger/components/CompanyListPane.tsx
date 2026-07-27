// Left pane of the ledger workspace: searchable/filterable company list with
// per-company balance summary and collection meter.

import React from 'react';
import {
  Box,
  Typography,
  Card,
  Chip,
  Button,
  TextField,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Add as AddIcon,
  Business as BusinessIcon,
  Receipt as ReceiptIcon,
  Search as SearchIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import type { Company } from '../../../../../types';
import type {
  CompanyLedgerAggregate,
  CompanyListFilter,
} from '../hooks/useCustomerLedgerWorkspace';
import { companyInitials } from '../helpers';
import { isPositiveMoney } from '../../../../../utils/money';

interface CompanyListRow {
  c: Company;
  agg: CompanyLedgerAggregate;
}

interface CompanyListPaneProps {
  companies: Company[];
  companyListRows: CompanyListRow[];
  search: string;
  onSearchChange: (value: string) => void;
  filter: CompanyListFilter;
  onFilterChange: (value: CompanyListFilter) => void;
  dueCount: number;
  clearCount: number;
  selectedCompanyId: number | null;
  onSelect: (id: number) => void;
  onRegister: () => void;
  formatCurrency: (value: number) => string;
}

const CompanyListPane: React.FC<CompanyListPaneProps> = ({
  companies,
  companyListRows,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  dueCount,
  clearCount,
  selectedCompanyId,
  onSelect,
  onRegister,
  formatCurrency,
}) => {
  return (
    <Card variant="outlined" sx={{ overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <BusinessIcon fontSize="small" color="action" />
        <Typography sx={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>
          Companies
        </Typography>
        <Chip
          label={companies.length}
          size="small"
          sx={{ height: 20, fontSize: 11, fontWeight: 700, '& .MuiChip-label': { px: 1 } }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="text"
          startIcon={<AddIcon fontSize="small" />}
          onClick={onRegister}
          sx={{ minWidth: 0, px: 1, fontSize: 12 }}
        >
          Add
        </Button>
      </Box>
      <Box
        sx={{
          p: 1.25,
          bgcolor: 'action.hover',
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <TextField
          size="small"
          fullWidth
          placeholder="Search by name, contact, phone..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => onSearchChange('')}
                    sx={{ p: 0.25 }}
                  >
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </InputAdornment>
              ) : null,
              sx: { bgcolor: 'background.paper', fontSize: 13 },
            }
          }}
        />
        <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
          {([
            { key: 'all', label: 'All', count: companies.length },
            { key: 'due', label: 'Has balance', count: dueCount },
            { key: 'clear', label: 'Settled', count: clearCount },
          ] as const).map(f => (
            <Chip
              key={f.key}
              size="small"
              label={
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                  <span>{f.label}</span>
                  <Box
                    component="span"
                    sx={{
                      fontSize: 10,
                      fontWeight: 700,
                      px: 0.6,
                      py: 0.05,
                      borderRadius: '999px',
                      bgcolor: filter === f.key ? 'rgba(255,255,255,0.25)' : 'action.selected',
                    }}
                  >
                    {f.count}
                  </Box>
                </Box>
              }
              onClick={() => onFilterChange(f.key as CompanyListFilter)}
              variant={filter === f.key ? 'filled' : 'outlined'}
              color={filter === f.key ? 'default' : 'default'}
              sx={{
                fontSize: 11.5,
                fontWeight: 600,
                height: 24,
                bgcolor: filter === f.key ? 'text.primary' : 'background.paper',
                color: filter === f.key ? 'background.paper' : 'text.secondary',
                '&:hover': {
                  bgcolor: filter === f.key ? 'text.primary' : 'action.hover',
                },
              }}
            />
          ))}
        </Box>
      </Box>
      <Box
        sx={{
          maxHeight: { md: 'calc(100vh - 360px)' },
          overflowY: 'auto',
        }}
      >
        {companies.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                mb: 1.5
              }}>
              No companies registered yet.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={onRegister}
            >
              Register Company
            </Button>
          </Box>
        ) : companyListRows.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" sx={{
              color: "text.secondary"
            }}>
              No companies match.
            </Typography>
          </Box>
        ) : (
          companyListRows.map(({ c, agg }) => {
            const isOn = c.id === selectedCompanyId;
            const pct = isPositiveMoney(agg.total) ? (agg.paid / agg.total) * 100 : 0;
            return (
              <Box
                key={c.id}
                onClick={() => onSelect(c.id)}
                sx={{
                  p: 1.5,
                  cursor: 'pointer',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  position: 'relative',
                  transition: 'background 120ms',
                  bgcolor: isOn ? (theme) => alpha(theme.palette.success.main, 0.08) : 'transparent',
                  '&:hover': {
                    bgcolor: isOn
                      ? (theme) => alpha(theme.palette.success.main, 0.12)
                      : 'action.hover',
                  },
                  '&::before': isOn
                    ? {
                        content: '""',
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        bgcolor: 'success.main',
                      }
                    : undefined,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: 0.4,
                      flexShrink: 0,
                      bgcolor: isOn ? 'success.main' : 'action.selected',
                      color: isOn ? 'success.contrastText' : 'text.secondary',
                    }}
                  >
                    {companyInitials(c.company_name)}
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 13.5,
                        fontWeight: 700,
                        lineHeight: 1.2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c.company_name}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: 'text.secondary',
                        mt: 0.25,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {c.contact_phone || '-'}
                      {c.contact_person ? ` / ${c.contact_person}` : ''}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 5.25, mt: 0.75 }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.secondary' }}>
                    <ReceiptIcon sx={{ fontSize: 11 }} />
                    <Typography sx={{ fontSize: 11, fontWeight: 500 }}>{agg.count}</Typography>
                  </Box>
                  <Box
                    sx={{
                      width: 4,
                      height: 4,
                      borderRadius: '50%',
                      bgcolor: 'text.disabled',
                    }}
                  />
                  <Typography
                    sx={{
                      fontSize: 11,
                      color: 'text.secondary',
                      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatCurrency(agg.total)}
                  </Typography>
                  <Typography
                    sx={{
                      ml: 'auto',
                      fontSize: 12,
                      fontWeight: 700,
	                      color: isPositiveMoney(agg.due) ? 'error.main' : 'success.main',
                      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
	                    {isPositiveMoney(agg.due) ? formatCurrency(agg.due) : 'Settled'}
                  </Typography>
                </Box>
	                {isPositiveMoney(agg.total) && (
                  <Box
                    sx={{
                      height: 3,
                      borderRadius: '999px',
                      bgcolor: 'action.selected',
                      overflow: 'hidden',
                      mt: 0.75,
                      ml: 5.25,
                    }}
                  >
                    <Box
                      sx={{
                        height: '100%',
                        width: `${pct}%`,
                        bgcolor: 'success.main',
                        borderRadius: '999px',
                      }}
                    />
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Box>
    </Card>
  );
};

export default CompanyListPane;
