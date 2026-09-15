import React from 'react';
import {
  Box,
  Typography,
  Grid,
  TextField,
  MenuItem,
  Paper,
  Chip,
  Divider,
  Alert,
  Autocomplete,
  FormControl,
  InputLabel,
  Select,
  InputAdornment,
  IconButton,
  Switch,
  CircularProgress,
  Card,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { Visibility as VisibilityIcon, VisibilityOff as VisibilityOffIcon, Add as AddIcon, Payment as PaymentIcon, MoneyOff as MoneyOffIcon, PersonAdd as PersonAddIcon, Business as BusinessIcon } from '@mui/icons-material';
import { toMoneyNumber } from '../../../../utils/money';
import type { Booking, BookingUpdateRequest, BookingWithDetails, Guest } from '../../../../types';
import type { CompanyOption, ValidationErrors } from './checkInTypes';
import { useTranslation } from '../../../../i18n';

export interface PaymentInfoTabProps {
  amountPaid: number;
  booking: Booking | BookingWithDetails;
  isOnlineReservation: boolean;
  onlinePlatformName: string;
  paymentMethods: string[];
  cardExpiry: string;
  cardName: string;
  cardNumber: string;
  companyOptions: CompanyOption[];
  currencySymbol: string;
  depositAmount: number;
  depositChoice: 'receive' | 'waive';
  depositMethod: string;
  error: string | null;
  formatCurrency: (amount: number) => string;
  guest: Guest | null;
  handleBlur: (field: string, value: string) => void;
  handleBookingChange: (field: keyof BookingUpdateRequest, value: string | number) => void;
  loading: boolean;
  loadingCompanies: boolean;
  newCompanyData: CompanyOption;
  paymentChoice: 'pay_now' | 'pay_later';
  paymentType: string;
  selectedCompany: CompanyOption | null;
  setAmountPaid: React.Dispatch<React.SetStateAction<number>>;
  setCardExpiry: React.Dispatch<React.SetStateAction<string>>;
  setCardName: React.Dispatch<React.SetStateAction<string>>;
  setCardNumber: React.Dispatch<React.SetStateAction<string>>;
  setDepositAmount: React.Dispatch<React.SetStateAction<number>>;
  setDepositChoice: React.Dispatch<React.SetStateAction<'receive' | 'waive'>>;
  setDepositMethod: React.Dispatch<React.SetStateAction<string>>;
  setDirectBillCompany: React.Dispatch<React.SetStateAction<string>>;
  setNewCompanyData: React.Dispatch<React.SetStateAction<CompanyOption>>;
  setNewCompanyDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPaymentChoice: React.Dispatch<React.SetStateAction<'pay_now' | 'pay_later'>>;
  setPaymentType: React.Dispatch<React.SetStateAction<string>>;
  setSelectedCompany: React.Dispatch<React.SetStateAction<CompanyOption | null>>;
  setShowCardNumber: React.Dispatch<React.SetStateAction<boolean>>;
  setValidationErrors: React.Dispatch<React.SetStateAction<ValidationErrors>>;
  setWaiveReason: React.Dispatch<React.SetStateAction<string>>;
  showCardNumber: boolean;
  touched: Record<string, boolean>;
  validateField: (field: string, value: string) => string | undefined;
  validationErrors: ValidationErrors;
  waiveReason: string;
}

export function PaymentInfoTab({
  amountPaid,
  booking,
  isOnlineReservation,
  onlinePlatformName,
  paymentMethods,
  cardExpiry,
  cardName,
  cardNumber,
  companyOptions,
  currencySymbol,
  depositAmount,
  depositChoice,
  depositMethod,
  error,
  formatCurrency,
  guest,
  handleBlur,
  handleBookingChange,
  loading,
  loadingCompanies,
  newCompanyData,
  paymentChoice,
  paymentType,
  selectedCompany,
  setAmountPaid,
  setCardExpiry,
  setCardName,
  setCardNumber,
  setDepositAmount,
  setDepositChoice,
  setDepositMethod,
  setDirectBillCompany,
  setNewCompanyData,
  setNewCompanyDialogOpen,
  setPaymentChoice,
  setPaymentType,
  setSelectedCompany,
  setShowCardNumber,
  setValidationErrors,
  setWaiveReason,
  showCardNumber,
  touched,
  validateField,
  validationErrors,
  waiveReason,
}: PaymentInfoTabProps) {
  const { t } = useTranslation('bookings');
  return (
      <Grid container spacing={2}>
        {/* Payment Section */}
        <Grid size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            {t('checkIn.paymentSection')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        {isOnlineReservation && (
          <Grid size={12}>
            <Alert severity="success" sx={{ mb: 1 }}>
              {t('checkIn.settledOnlineNotice', { platform: onlinePlatformName, amount: formatCurrency(toMoneyNumber(booking.total_amount)) })}
            </Alert>
          </Grid>
        )}
        <Grid size={12}>
          <ToggleButtonGroup
            value={paymentChoice}
            exclusive
            onChange={(_, val) => { if (val) setPaymentChoice(val); }}
            fullWidth
            size="large"
            sx={{ mb: 1 }}
          >
            <ToggleButton value="pay_now" color="success" sx={{ py: 1.5, fontWeight: 600 }}>
              <PaymentIcon sx={{ mr: 1 }} />
              {t('checkIn.makePaymentNow')}
            </ToggleButton>
            <ToggleButton value="pay_later" color="warning" sx={{ py: 1.5, fontWeight: 600 }}>
              <MoneyOffIcon sx={{ mr: 1 }} />
              {isOnlineReservation ? t('checkIn.settledOnline') : t('checkIn.payLater')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Grid>

        {paymentChoice === 'pay_now' && (
          <>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('checkIn.paymentMethod')}</InputLabel>
                <Select
                  value={paymentType}
                  onChange={(e) => {
                    setPaymentType(e.target.value);
                    handleBookingChange('payment_method', e.target.value);
                  }}
                  label={t('checkIn.paymentMethod')}
                >
                  {paymentMethods.map(method => (
                    <MenuItem key={method} value={method}>{method}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('checkIn.amountPaid')}
                type="number"
                value={amountPaid}
                onChange={(e) => setAmountPaid(toMoneyNumber(e.target.value))}
                slotProps={{
                  input: {
                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                    inputProps: { min: 0, step: 0.01 },
                  }
                }}
              />
            </Grid>

            {(paymentType === 'Visa Card' || paymentType === 'Master Card' || paymentType === 'Debit Card' || paymentType === 'American Express' || paymentType === 'Credit Card') && (
              <>
                <Grid size={12}>
                  <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 1 }}>
                    {t('checkInForm.payment.cardInformation')}
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('checkInForm.payment.cardNumber')}
                    type={showCardNumber ? 'text' : 'password'}
                    value={cardNumber}
                    onChange={(e) => {
                      setCardNumber(e.target.value);
                      if (touched.cardNumber) {
                        const error = validateField('cardNumber', e.target.value);
                        setValidationErrors(prev => ({ ...prev, cardNumber: error }));
                      }
                    }}
                    onBlur={(e) => handleBlur('cardNumber', e.target.value)}
                    error={touched.cardNumber && !!validationErrors.cardNumber}
                    helperText={touched.cardNumber && validationErrors.cardNumber}
                    placeholder="•••••"
                    slotProps={{
                      input: {
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowCardNumber(!showCardNumber)}
                              edge="end"
                              aria-label={showCardNumber ? t('checkInForm.payment.hideCardNumber') : t('checkInForm.payment.showCardNumber')}
                            >
                              {showCardNumber ? <VisibilityOffIcon /> : <VisibilityIcon />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }
                    }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('checkInForm.payment.expireDate')}
                    placeholder={t('checkInForm.payment.expirePlaceholder')}
                    value={cardExpiry}
                    onChange={(e) => {
                      setCardExpiry(e.target.value);
                      if (touched.cardExpiry) {
                        const error = validateField('cardExpiry', e.target.value);
                        setValidationErrors(prev => ({ ...prev, cardExpiry: error }));
                      }
                    }}
                    onBlur={(e) => handleBlur('cardExpiry', e.target.value)}
                    error={touched.cardExpiry && !!validationErrors.cardExpiry}
                    helperText={(touched.cardExpiry && validationErrors.cardExpiry) || t('checkInForm.payment.expireFormat')}
                  />
                </Grid>
                <Grid size={12}>
                  <TextField
                    fullWidth
                    label={t('checkInForm.payment.nameOnCard')}
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                  />
                </Grid>
              </>
            )}

            {paymentType === 'Direct Billing' && (
              <>
                <Grid size={12}>
                  <Typography variant="subtitle2" color="primary" gutterBottom sx={{ mt: 1 }}>
                    {t('checkInForm.payment.directBillingInfo')}
                  </Typography>
                  <Divider sx={{ mb: 2 }} />
                </Grid>
                <Grid size={12}>
                  <Autocomplete
                    value={selectedCompany}
                    onChange={(event, newValue) => {
                      if (newValue) {
                        if (newValue.isNew) {
                          setNewCompanyData({ ...newCompanyData, company_name: newValue.inputValue || '' });
                          setNewCompanyDialogOpen(true);
                        } else {
                          setSelectedCompany(newValue);
                          setDirectBillCompany(newValue.company_name);
                        }
                      } else {
                        setSelectedCompany(null);
                        setDirectBillCompany('');
                      }
                    }}
                    filterOptions={(options, state) => {
                      const inputValue = state.inputValue.toLowerCase();
                      const filtered = options.filter(option =>
                        option.company_name.toLowerCase().includes(inputValue)
                      );
                      const isExisting = options.some(option =>
                        option.company_name.toLowerCase() === inputValue
                      );
                      if (inputValue !== '' && !isExisting) {
                        filtered.push({
                          inputValue: state.inputValue,
                          company_name: t('enhancedCheckIn.company.addNew', { name: state.inputValue }),
                          isNew: true,
                        });
                      }
                      return filtered;
                    }}
                    selectOnFocus
                    clearOnBlur
                    handleHomeEndKeys
                    options={companyOptions}
                    loading={loadingCompanies}
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
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <BusinessIcon color="action" fontSize="small" />
                                <Typography>{option.company_name}</Typography>
                              </Box>
                              {option.contact_person && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: "text.secondary",
                                    ml: 3.5
                                  }}>
                                  {t('checkInForm.payment.contact')} {option.contact_person}
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
                        label={t('checkInForm.payment.companyLabel')}
                        placeholder={t('checkInForm.payment.companyPlaceholder')}
                        helperText={t('checkInForm.payment.companyHelper')}
                        slotProps={{
                          ...params.slotProps,

                          input: {
                            ...params.slotProps.input,
                            endAdornment: (
                              <>
                                {loadingCompanies ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.slotProps.input.endAdornment}
                              </>
                            ),
                          }
                        }}
                      />
                    )}
                  />
                </Grid>
                {selectedCompany && !selectedCompany.isNew && (
                  <Grid size={12}>
                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)' }}>
                      <Typography variant="subtitle2" gutterBottom>
                        {t('checkInForm.payment.companyDetails')}
                      </Typography>
                      <Grid container spacing={1}>
                        {selectedCompany.company_registration_number && (
                          <>
                            <Grid size={4}>
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>{t('checkInForm.payment.regNo')}</Typography>
                            </Grid>
                            <Grid size={8}>
                              <Typography variant="body2">{selectedCompany.company_registration_number}</Typography>
                            </Grid>
                          </>
                        )}
                        {selectedCompany.contact_person && (
                          <>
                            <Grid size={4}>
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>{t('checkInForm.payment.contact')}</Typography>
                            </Grid>
                            <Grid size={8}>
                              <Typography variant="body2">{selectedCompany.contact_person}</Typography>
                            </Grid>
                          </>
                        )}
                        {selectedCompany.contact_email && (
                          <>
                            <Grid size={4}>
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>{t('checkInForm.payment.emailLabel')}</Typography>
                            </Grid>
                            <Grid size={8}>
                              <Typography variant="body2">{selectedCompany.contact_email}</Typography>
                            </Grid>
                          </>
                        )}
                        {selectedCompany.contact_phone && (
                          <>
                            <Grid size={4}>
                              <Typography variant="caption" sx={{
                                color: "text.secondary"
                              }}>{t('checkInForm.payment.phoneLabel')}</Typography>
                            </Grid>
                            <Grid size={8}>
                              <Typography variant="body2">{selectedCompany.contact_phone}</Typography>
                            </Grid>
                          </>
                        )}
                      </Grid>
                    </Paper>
                  </Grid>
                )}
              </>
            )}
          </>
        )}

        {paymentChoice === 'pay_later' && !isOnlineReservation && (
          <Grid size={12}>
            <Alert severity="info">
              {t('checkIn.payLaterUnpaid')}
            </Alert>
          </Grid>
        )}

        {/* Deposit Section */}
        <Grid sx={{ mt: 2 }} size={12}>
          <Typography variant="subtitle2" color="primary" gutterBottom>
            {t('checkIn.depositSection')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
        </Grid>
        <Grid size={12}>
          <ToggleButtonGroup
            value={depositChoice}
            exclusive
            onChange={(_, val) => { if (val) setDepositChoice(val); }}
            fullWidth
            size="large"
            sx={{ mb: 1 }}
          >
            <ToggleButton value="receive" color="success" sx={{ py: 1.5, fontWeight: 600 }}>
              <PaymentIcon sx={{ mr: 1 }} />
              {t('checkIn.receiveDeposit')}
            </ToggleButton>
            <ToggleButton value="waive" color="error" sx={{ py: 1.5, fontWeight: 600 }}>
              <MoneyOffIcon sx={{ mr: 1 }} />
              {t('checkIn.waiveDeposit')}
            </ToggleButton>
          </ToggleButtonGroup>
        </Grid>

        {depositChoice === 'receive' && (
          <>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth>
                <InputLabel>{t('checkIn.depositMethod')}</InputLabel>
                <Select
                  value={depositMethod}
                  onChange={(e) => setDepositMethod(e.target.value)}
                  label={t('checkIn.depositMethod')}
                >
                  {paymentMethods.map(method => (
                    <MenuItem key={method} value={method}>{method}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label={t('checkIn.depositAmount')}
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(toMoneyNumber(e.target.value))}
                slotProps={{
                  input: {
                    startAdornment: <InputAdornment position="start">{currencySymbol}</InputAdornment>,
                    inputProps: { min: 0, step: 0.01 },
                  }
                }}
              />
            </Grid>
          </>
        )}

        {depositChoice === 'waive' && (
          <Grid size={12}>
            <TextField
              fullWidth
              label={t('checkIn.waiveReasonLabel')}
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              multiline
              rows={2}
              placeholder={t('checkIn.waiveReasonPlaceholder')}
              helperText={t('checkIn.waiveReasonHelper')}
            />
          </Grid>
        )}

        {/* Payment Summary */}
        <Grid sx={{ mt: 1 }} size={12}>
          <Paper sx={{ p: 2, bgcolor: 'var(--hotel-surface-sunken)', border: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" gutterBottom>{t('checkInForm.payment.paymentSummary')}</Typography>
            <Grid container spacing={1}>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('checkInForm.payment.totalAmount')}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  fontWeight: 600
                }}>{formatCurrency(toMoneyNumber(booking.total_amount))}</Typography>
              </Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('checkInForm.payment.paymentStatus')}</Typography>
              </Grid>
              <Grid size={6}>
                <Chip
                  label={paymentChoice === 'pay_now' ? t('checkInForm.payment.paid') : isOnlineReservation ? t('checkIn.settledOnline') : t('checkInForm.payment.unpaid')}
                  size="small"
                  color={paymentChoice === 'pay_now' || isOnlineReservation ? 'success' : 'warning'}
                  sx={{ fontWeight: 600 }}
                />
              </Grid>
              {paymentChoice === 'pay_now' && (
                <>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('checkInForm.payment.amountPaid')}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "success.main",
                        fontWeight: 600
                      }}>{formatCurrency(amountPaid)}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('checkInForm.payment.paymentMethod')}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2">{paymentType}</Typography>
                  </Grid>
                </>
              )}
              <Grid size={12}><Divider sx={{ my: 0.5 }} /></Grid>
              <Grid size={6}>
                <Typography variant="body2" sx={{
                  color: "text.secondary"
                }}>{t('checkInForm.payment.deposit')}</Typography>
              </Grid>
              <Grid size={6}>
                {depositChoice === 'receive' ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: "success.main",
                      fontWeight: 600
                    }}>
                    {formatCurrency(depositAmount)} ({depositMethod})
                  </Typography>
                ) : (
                  <Chip label={t('checkInForm.payment.waived')} size="small" color="error" variant="outlined" sx={{ fontWeight: 600 }} />
                )}
              </Grid>
              {depositChoice === 'waive' && waiveReason && (
                <>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('checkInForm.payment.waiveReason')}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        fontStyle: "italic"
                      }}>{waiveReason}</Typography>
                  </Grid>
                </>
              )}
            </Grid>
          </Paper>
        </Grid>
      </Grid>
  );
}
