import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  Autocomplete,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  PersonAdd as PersonAddIcon,
  Hotel as HotelIcon,
} from '@mui/icons-material';
import type { CustomerLedgerCreateRequest, Room } from '../../../../../types';
import type { CompanyOption } from '../types';
import { EXPENSE_TYPES } from '../constants';
import { isPositiveMoney, toMoneyNumber } from '../../../../../utils/money';

interface CreateLedgerDialogProps {
  // Dialog state
  open: boolean;
  onClose: () => void;
  // Form values and setters
  createFormData: CustomerLedgerCreateRequest;
  setCreateFormData: React.Dispatch<React.SetStateAction<CustomerLedgerCreateRequest>>;
  selectedCompany: CompanyOption | null;
  onCompanyChange: (newValue: CompanyOption | null) => void;
  selectedCreateRoom: Room | null;
  // Lookup data and loading states
  companyOptions: CompanyOption[];
  ledgerRooms: Room[];
  loadingLedgerRooms: boolean;
  loadLedgerRooms: () => Promise<void>;
  // Submission callback and submitting state
  creating: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  // Derived display values
  currencySymbol: string;
}

const CreateLedgerDialog: React.FC<CreateLedgerDialogProps> = ({
  open,
  onClose,
  createFormData,
  setCreateFormData,
  selectedCompany,
  onCompanyChange,
  selectedCreateRoom,
  companyOptions,
  ledgerRooms,
  loadingLedgerRooms,
  loadLedgerRooms,
  creating,
  onSubmit,
  onCancel,
  currencySymbol,
}) => (
  <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
    <DialogTitle>Create New Ledger Entry</DialogTitle>
    <DialogContent>
      <Grid container spacing={2} sx={{ mt: 1 }}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Autocomplete
            value={selectedCompany}
            onChange={(event, newValue) => onCompanyChange(newValue)}
            filterOptions={(options, state) => {
              const inputValue = state.inputValue.toLowerCase();
              const filtered = options.filter(option =>
                option.company_name.toLowerCase().includes(inputValue)
              );
              // Suggest creating a new company if no exact match
              const isExisting = options.some(option =>
                option.company_name.toLowerCase() === inputValue
              );
              if (inputValue !== '' && !isExisting) {
                filtered.push({
                  inputValue: state.inputValue,
                  company_name: `Add "${state.inputValue}" as new company`,
                  isNew: true,
                });
              }
              return filtered;
            }}
            selectOnFocus
            clearOnBlur
            handleHomeEndKeys
            options={companyOptions}
            getOptionLabel={(option) => option.isNew ? option.inputValue || '' : option.company_name}
            isOptionEqualToValue={(option, value) => option.company_name === value.company_name}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <li key={key} {...otherProps}>
                  {option.isNew ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PersonAddIcon color="primary" fontSize="small" />
                      <Typography color="primary">{option.company_name}</Typography>
                    </Box>
                  ) : (
                    <Box>
                      <Typography>{option.company_name}</Typography>
                      {option.contact_person && (
                        <Typography variant="caption" sx={{
                          color: "text.secondary"
                        }}>
                          Contact: {option.contact_person}
                        </Typography>
                      )}
                    </Box>
                  )}
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                required
                label="Company Name"
                placeholder="Type to search or add new company"
                helperText="Select existing company or type new name"
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Registration Number"
            value={createFormData.company_registration_number || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, company_registration_number: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Contact Person"
            value={createFormData.contact_person || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, contact_person: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Contact Email"
            type="email"
            value={createFormData.contact_email || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, contact_email: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Contact Phone"
            value={createFormData.contact_phone || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, contact_phone: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Billing Address"
            value={createFormData.billing_address_line1 || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, billing_address_line1: e.target.value })}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            required
            label="Description"
            multiline
            rows={2}
            value={createFormData.description}
            onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth required>
            <InputLabel>Expense Type</InputLabel>
            <Select
              value={createFormData.expense_type}
              label="Expense Type"
              onChange={(e) => setCreateFormData({ ...createFormData, expense_type: e.target.value })}
            >
              {EXPENSE_TYPES.map((type) => (
                <MenuItem key={type.value} value={type.value}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            required
            label="Amount"
            type="number"
            value={createFormData.amount}
            onChange={(e) => setCreateFormData({ ...createFormData, amount: toMoneyNumber(e.target.value) })}
            slotProps={{
              input: {
                startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
              }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Autocomplete
            value={selectedCreateRoom}
            onOpen={() => { void loadLedgerRooms(); }}
            onChange={(event, newValue) => setCreateFormData({
              ...createFormData,
              room_number: newValue?.room_number || undefined,
            })}
            options={ledgerRooms}
            loading={loadingLedgerRooms}
            getOptionLabel={(option) => `Room ${option.room_number} - ${option.room_type}`}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <li key={key} {...otherProps}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      width: "100%",
                      gap: 2
                    }}>
                    <Box>
                      <Typography sx={{
                        fontWeight: "medium"
                      }}>Room {option.room_number}</Typography>
                      <Typography variant="caption" sx={{
                        color: "text.secondary"
                      }}>
                        {option.room_type} {option.floor != null ? `| Floor ${option.floor}` : ''}
                      </Typography>
                    </Box>
                    {option.status && (
                      <Chip label={option.status} size="small" variant="outlined" />
                    )}
                  </Box>
                </li>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Room"
                placeholder="Choose a room"
                helperText="Used to detect possible duplicate stay charges"
                slotProps={{
                  ...params.slotProps,

                  input: {
                    ...params.slotProps.input,
                    startAdornment: (
                      <>
                        <HotelIcon color="action" sx={{ ml: 1, mr: 0.5 }} />
                        {params.slotProps.input.startAdornment}
                      </>
                    ),
                    endAdornment: (
                      <>
                        {loadingLedgerRooms ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.slotProps.input.endAdornment}
                      </>
                    ),
                  }
                }}
              />
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Stay / Ledger Date"
            type="date"
            value={createFormData.posting_date || ''}
            onChange={(e) => setCreateFormData({
              ...createFormData,
              posting_date: e.target.value,
              transaction_date: e.target.value,
            })}
            helperText="Company + room + date + amount is checked for duplicates"
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Invoice Date"
            type="date"
            value={createFormData.invoice_date || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, invoice_date: e.target.value })}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            fullWidth
            label="Due Date"
            type="date"
            value={createFormData.due_date || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, due_date: e.target.value })}
            slotProps={{
              inputLabel: { shrink: true }
            }}
          />
        </Grid>
        <Grid size={12}>
          <TextField
            fullWidth
            label="Notes"
            multiline
            rows={2}
            value={createFormData.notes || ''}
            onChange={(e) => setCreateFormData({ ...createFormData, notes: e.target.value })}
          />
        </Grid>
      </Grid>
    </DialogContent>
    <DialogActions>
      <Button onClick={onCancel}>Cancel</Button>
      <Button
        onClick={onSubmit}
        variant="contained"
        disabled={creating || !createFormData.company_name || !createFormData.description || !isPositiveMoney(createFormData.amount)}
      >
        {creating ? 'Creating...' : 'Create Entry'}
      </Button>
    </DialogActions>
  </Dialog>
);

export default CreateLedgerDialog;
