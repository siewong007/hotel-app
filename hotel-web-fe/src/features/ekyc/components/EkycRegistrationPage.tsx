import React, { useState, useRef } from 'react';
import {
  Box,
  Container,
  Paper,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  TextField,
  MenuItem,
  Grid,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  IconButton,
  Chip,
  Divider,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  CameraAlt as CameraIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  Delete as DeleteIcon,
  ArrowBack as BackIcon,
  ArrowForward as ForwardIcon,
} from '@mui/icons-material';
import { useNavigate } from '../../../router';
import { useAuth } from '../../../auth/AuthContext';
import { EkycService } from '../../../api';
import { validateEmailKey, validatePhoneKey } from '../../../utils/validation';
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { formatLocalDate } from '../../../utils/date';
import { errorMessage } from '../../../utils/errorMessage';
import { ConsentBlock } from '../../legal/components/ConsentBlock';
import { EKYC_CONSENTS, EKYC_KEY_POINTS } from '../../legal/content';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import { useConsent } from '../../legal/useConsent';
import { useTranslation } from '../../../i18n';

interface PersonalInfo {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  phone: string;
  email: string;
  currentAddress: string;
}

interface DocumentInfo {
  idType: string;
  idNumber: string;
  idIssuingCountry: string;
  idIssueDate: string;
  idExpiryDate: string;
}

interface DocumentUploads {
  idFront: string | null;
  idBack: string | null;
  selfie: string | null;
  proofOfAddress: string | null;
}

const STEP_KEYS = ['personal', 'document', 'upload', 'verification'] as const;

const idTypes = [
  { value: 'passport', labelKey: 'idTypes.passport' },
  { value: 'drivers_license', labelKey: 'idTypes.drivers_license' },
  { value: 'national_id', labelKey: 'idTypes.national_id' },
];

const countries = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Italy', 'Spain', 'Japan', 'China', 'India', 'Brazil',
  'Mexico', 'Singapore', 'Malaysia', 'Thailand', 'Indonesia', 'Philippines',
  'South Korea', 'Vietnam', 'Other'
];

const EkycRegistrationPage: React.FC = () => {
  const { t } = useTranslation('ekyc');
  const navigate = useNavigate();
  const { user } = useAuth();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  // Form data
  const [personalInfo, setPersonalInfo] = useState<PersonalInfo>({
    fullName: '',
    dateOfBirth: '',
    nationality: '',
    phone: '',
    email: '',
    currentAddress: '',
  });

  const consent = useConsent(EKYC_CONSENTS);
  const { locale: legalLocale } = useLegalLocale();
  const [documentInfo, setDocumentInfo] = useState<DocumentInfo>({
    idType: 'passport',
    idNumber: '',
    idIssuingCountry: '',
    idIssueDate: '',
    idExpiryDate: '',
  });

  const [uploads, setUploads] = useState<DocumentUploads>({
    idFront: null,
    idBack: null,
    selfie: null,
    proofOfAddress: null,
  });

  // File input refs
  const idFrontRef = useRef<HTMLInputElement>(null);
  const idBackRef = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (file: File, field: keyof DocumentUploads) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError(t('register.errors.imageOnly'));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError(t('register.errors.fileTooLarge'));
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setUploads(prev => ({ ...prev, [field]: base64 }));
      setError('');
    };
    reader.onerror = () => {
      setError(t('register.errors.readFile'));
    };
    reader.readAsDataURL(file);
  };

  const handleNext = () => {
    // Validate current step
    if (activeStep === 0) {
      if (!personalInfo.fullName || !personalInfo.dateOfBirth || !personalInfo.nationality ||
          !personalInfo.phone || !personalInfo.email || !personalInfo.currentAddress) {
        setError(t('register.errors.requiredPersonal'));
        return;
      }

      // Validate email
      const emailKey = validateEmailKey(personalInfo.email);
      if (emailKey) {
        const emailValidation = t(`auth:${emailKey}`);
        setEmailError(emailValidation);
        setError(emailValidation);
        return;
      }

    } else if (activeStep === 1) {
      if (!documentInfo.idType || !documentInfo.idNumber || !documentInfo.idIssuingCountry ||
          !documentInfo.idExpiryDate) {
        setError(t('register.errors.requiredDocument'));
        return;
      }
      // Validate expiry date is in the future
      if (new Date(documentInfo.idExpiryDate) <= new Date()) {
        setError(t('register.errors.expiryFuture'));
        return;
      }
    } else if (activeStep === 2) {
      if (!uploads.idFront || !uploads.selfie) {
        setError(t('register.errors.requiredUploads'));
        return;
      }
      if (documentInfo.idType !== 'passport' && !uploads.idBack) {
        setError(t('register.errors.requiredIdBack'));
        return;
      }
    }

    setError('');
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
    setError('');
  };

  // Helper to convert base64 to Blob
  const base64ToBlob = (base64: string, contentType: string = 'image/jpeg'): Blob => {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: contentType });
  };

  // Upload single document using centralized API service
  const uploadDocument = async (base64Data: string, documentType: string): Promise<string> => {
    const blob = base64ToBlob(base64Data);
    const file = new File([blob], `${documentType}.jpg`, { type: 'image/jpeg' });
    const result = await EkycService.uploadEkycDocument(file, documentType);
    return result.filename;
  };

  const handleSubmit = async () => {
    // Checked BEFORE the uploads below, not just before the submit call. The
    // uploads put the ID images and the selfie on the server, so running them
    // first and letting the API reject afterwards would mean processing
    // biometric data without consent — the exact thing this gate exists to
    // prevent.
    if (!consent.allRequiredGranted) {
      consent.setShowErrors(true);
      setError(t('register.errors.consentRequired'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Upload all documents first
      const idFrontPath = await uploadDocument(uploads.idFront!, 'id_front');
      const idBackPath = uploads.idBack ? await uploadDocument(uploads.idBack, 'id_back') : null;
      const selfiePath = await uploadDocument(uploads.selfie!, 'selfie');
      const proofPath = uploads.proofOfAddress ? await uploadDocument(uploads.proofOfAddress, 'proof') : null;

      const requestData = {
        // Personal info
        full_name: personalInfo.fullName,
        date_of_birth: personalInfo.dateOfBirth,
        nationality: personalInfo.nationality,
        phone: personalInfo.phone,
        email: personalInfo.email,
        current_address: personalInfo.currentAddress,

        // Document info
        id_type: documentInfo.idType,
        id_number: documentInfo.idNumber,
        id_issuing_country: documentInfo.idIssuingCountry,
        id_issue_date: documentInfo.idIssueDate || null,
        id_expiry_date: documentInfo.idExpiryDate,

        // File paths (not base64 anymore)
        id_front_image: idFrontPath,
        id_back_image: idBackPath,
        selfie_image: selfiePath,
        proof_of_address: proofPath,

        consents: consent.buildPayload(legalLocale).consents,
      };

      // Call API to submit eKYC using centralized service
      await EkycService.submitEkycVerification(requestData);

      setSuccess(true);
      setTimeout(() => {
        navigate('/profile?ekycSubmitted=true');
      }, 2000);
    } catch (err) {
      setError(errorMessage(err, t('errors.submit')));
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid size={12}>
              <Typography variant="h6" gutterBottom>
                {t('register.personalTitle')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  marginBottom: "16px"
                }}>
                {t('register.personalSubtitle')}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('register.fullName')}
                required
                value={personalInfo.fullName}
                onChange={(e) => setPersonalInfo({ ...personalInfo, fullName: e.target.value })}
                placeholder={t('register.fullNamePlaceholder')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <ModernDatePicker
                label={t('register.dob')}
                value={personalInfo.dateOfBirth}
                onChange={(value) => setPersonalInfo({ ...personalInfo, dateOfBirth: value })}
                maxDate={formatLocalDate()}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label={t('register.nationality')}
                required
                value={personalInfo.nationality}
                onChange={(e) => setPersonalInfo({ ...personalInfo, nationality: e.target.value })}
              >
                {countries.map((country) => (
                  <MenuItem key={country} value={country}>
                    {country}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                type="tel"
                label={t('register.phone')}
                required
                value={personalInfo.phone}
                onChange={(e) => {
                  setPersonalInfo({ ...personalInfo, phone: e.target.value });
                  setPhoneError('');
                }}
                onBlur={() => setPhoneError('')}
                error={!!phoneError}
                helperText={phoneError}
                placeholder="+1-234-567-8900"
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('register.email')}
                type="email"
                required
                value={personalInfo.email}
                onChange={(e) => {
                  setPersonalInfo({ ...personalInfo, email: e.target.value });
                  setEmailError('');
                }}
                onBlur={() => {
                  const key = validateEmailKey(personalInfo.email);
                  setEmailError(key ? t(`auth:${key}`) : '');
                }}
                error={!!emailError}
                helperText={emailError}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('register.currentAddress')}
                required
                multiline
                rows={3}
                value={personalInfo.currentAddress}
                onChange={(e) => setPersonalInfo({ ...personalInfo, currentAddress: e.target.value })}
                placeholder={t('register.addressPlaceholder')}
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid size={12}>
              <Typography variant="h6" gutterBottom>
                {t('register.documentTitle')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  marginBottom: "16px"
                }}>
                {t('register.documentSubtitle')}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label={t('register.idType')}
                required
                value={documentInfo.idType}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idType: e.target.value })}
              >
                {idTypes.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {t(type.labelKey)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('register.idNumber')}
                required
                value={documentInfo.idNumber}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label={t('register.issuingCountry')}
                required
                value={documentInfo.idIssuingCountry}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idIssuingCountry: e.target.value })}
              >
                {countries.map((country) => (
                  <MenuItem key={country} value={country}>
                    {country}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <ModernDatePicker
                label={t('register.issueDate')}
                value={documentInfo.idIssueDate}
                onChange={(value) => setDocumentInfo({ ...documentInfo, idIssueDate: value })}
                maxDate={formatLocalDate()}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <ModernDatePicker
                label={t('register.expiryDate')}
                value={documentInfo.idExpiryDate}
                onChange={(value) => setDocumentInfo({ ...documentInfo, idExpiryDate: value })}
                minDate={formatLocalDate()}
                required
              />
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid size={12}>
              <Typography variant="h6" gutterBottom>
                {t('register.uploadTitle')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  marginBottom: "16px"
                }}>
                {t('register.uploadSubtitle')}
              </Typography>
            </Grid>
            {/* ID Front */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('register.idFront')} <Chip label={t('common:form.required')} color="error" size="small" />
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.idFront ? (
                      <>
                        <img
                          src={uploads.idFront}
                          alt={t('register.idFront')}
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, idFront: null }))}
                        >
                          {t('common:actions.remove')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <input
                          ref={idFrontRef}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'idFront')}
                        />
                        <Button
                          fullWidth
                          variant="contained"
                          startIcon={<UploadIcon />}
                          onClick={() => idFrontRef.current?.click()}
                        >
                          {t('register.uploadIdFront')}
                        </Button>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            {/* ID Back */}
            {documentInfo.idType !== 'passport' && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom>
                      {t('register.idBack')} <Chip label={t('common:form.required')} color="error" size="small" />
                    </Typography>
                    <Box sx={{ mt: 2 }}>
                      {uploads.idBack ? (
                        <>
                          <img
                            src={uploads.idBack}
                            alt={t('register.idBack')}
                            style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                          />
                          <Button
                            fullWidth
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => setUploads(prev => ({ ...prev, idBack: null }))}
                          >
                            {t('common:actions.remove')}
                          </Button>
                        </>
                      ) : (
                        <>
                          <input
                            ref={idBackRef}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'idBack')}
                          />
                          <Button
                            fullWidth
                            variant="contained"
                            startIcon={<UploadIcon />}
                            onClick={() => idBackRef.current?.click()}
                          >
                            {t('register.uploadIdBack')}
                          </Button>
                        </>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            )}
            {/* Selfie */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('register.selfie')} <Chip label={t('common:form.required')} color="error" size="small" />
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block",
                      mb: 2
                    }}>
                    {t('register.selfieHelp')}
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.selfie ? (
                      <>
                        <img
                          src={uploads.selfie}
                          alt={t('register.selfie')}
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, selfie: null }))}
                        >
                          {t('common:actions.remove')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <input
                          ref={selfieRef}
                          type="file"
                          accept="image/*"
                          capture="user"
                          style={{ display: 'none' }}
                          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'selfie')}
                        />
                        <Button
                          fullWidth
                          variant="contained"
                          startIcon={<CameraIcon />}
                          onClick={() => selfieRef.current?.click()}
                        >
                          {t('register.takeSelfie')}
                        </Button>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
            {/* Proof of Address (Optional) */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('register.proofOfAddress')} <Chip label={t('common:form.optional')} size="small" />
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block",
                      mb: 2
                    }}>
                    {t('register.proofHelp')}
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.proofOfAddress ? (
                      <>
                        <img
                          src={uploads.proofOfAddress}
                          alt={t('register.proofOfAddress')}
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, proofOfAddress: null }))}
                        >
                          {t('common:actions.remove')}
                        </Button>
                      </>
                    ) : (
                      <>
                        <input
                          ref={proofRef}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'proofOfAddress')}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          startIcon={<UploadIcon />}
                          onClick={() => proofRef.current?.click()}
                        >
                          {t('register.uploadDocument')}
                        </Button>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        );

      case 3:
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              {t('register.reviewTitle')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                marginBottom: "16px"
              }}>
              {t('register.reviewSubtitle')}
            </Typography>
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  {t('register.personalTitle')}
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewFullName')}</Typography>
                    <Typography variant="body1">{personalInfo.fullName}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewDob')}</Typography>
                    <Typography variant="body1">{personalInfo.dateOfBirth}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewNationality')}</Typography>
                    <Typography variant="body1">{personalInfo.nationality}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewPhone')}</Typography>
                    <Typography variant="body1">{personalInfo.phone}</Typography>
                  </Grid>
                  <Grid size={12}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewEmail')}</Typography>
                    <Typography variant="body1">{personalInfo.email}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  {t('register.reviewDocTitle')}
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewIdType')}</Typography>
                    <Typography variant="body1">
                      {idTypes.find(d => d.value === documentInfo.idType)?.labelKey ? t(idTypes.find(d => d.value === documentInfo.idType)!.labelKey) : documentInfo.idType}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewIdNumber')}</Typography>
                    <Typography variant="body1">{documentInfo.idNumber}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewIssuingCountry')}</Typography>
                    <Typography variant="body1">{documentInfo.idIssuingCountry}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('register.reviewExpiryDate')}</Typography>
                    <Typography variant="body1">{documentInfo.idExpiryDate}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  {t('register.reviewUploadsTitle')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {uploads.idFront && (
                    <Chip icon={<CheckIcon />} label={t('register.idFront')} color="success" />
                  )}
                  {uploads.idBack && (
                    <Chip icon={<CheckIcon />} label={t('register.idBack')} color="success" />
                  )}
                  {uploads.selfie && (
                    <Chip icon={<CheckIcon />} label={t('register.selfie')} color="success" />
                  )}
                  {uploads.proofOfAddress && (
                    <Chip icon={<CheckIcon />} label={t('register.proofOfAddress')} color="success" />
                  )}
                </Box>
              </CardContent>
            </Card>
            <Alert severity="info" sx={{ mt: 3 }}>
              <Typography variant="body2">
                {t('register.reviewNotice')}
              </Typography>
            </Alert>

            {/* Explicit consent for sensitive personal data (PDPA s.40). Kept
                separate from every other agreement in the product and never
                pre-ticked: bundling it would invalidate it. */}
            <ConsentBlock
              prompts={EKYC_CONSENTS}
              state={consent}
              keyPoints={EKYC_KEY_POINTS}
              title={{
                en: 'Consent to identity verification',
                ms: 'Persetujuan pengesahan identiti',
              }}
            />
          </Box>
        );

      default:
        return null;
    }
  };

  // eKYC submission is guest-only — the API rejects staff accounts, so the
  // route (reachable by URL) shows a notice instead of a doomed form.
  if (user && user.user_type !== 'guest') {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/profile')}>
              {t('register.backToProfile')}
            </Button>
          }
        >
          {t('register.guestOnly')}
        </Alert>
      </Container>
    );
  }

  if (success) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CheckIcon sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            {t('register.successTitle')}
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              marginBottom: "16px"
            }}>
            {t('register.successBody')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('register.redirecting')}
          </Typography>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 4 }}>
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" gutterBottom>
            {t('register.title')}
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary"
          }}>
            {t('register.subtitle')}
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {STEP_KEYS.map((stepKey) => (
            <Step key={stepKey}>
              <StepLabel>{t(`register.steps.${stepKey}`)}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 4 }}>
          {renderStepContent(activeStep)}
        </Box>

        <Divider sx={{ my: 3 }} />

        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            disabled={activeStep === 0}
            onClick={handleBack}
            startIcon={<BackIcon />}
          >
            {t('common:actions.back')}
          </Button>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => navigate('/profile')}
            >
              {t('common:actions.cancel')}
            </Button>

            {activeStep === STEP_KEYS.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={loading}
                endIcon={loading ? <CircularProgress size={20} /> : <CheckIcon />}
              >
                {loading ? t('register.submitting') : t('register.submit')}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
                endIcon={<ForwardIcon />}
              >
                {t('common:actions.next')}
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Container>
  );
};

export default EkycRegistrationPage;
