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
import { validateEmail, validatePhone } from '../../../utils/validation';
import ModernDatePicker from '../../../components/common/ModernDatePicker';
import { formatLocalDate } from '../../../utils/date';
import { errorMessage } from '../../../utils/errorMessage';
import { ConsentBlock } from '../../legal/components/ConsentBlock';
import { EKYC_CONSENTS, EKYC_KEY_POINTS } from '../../legal/content';
import { useLegalLocale } from '../../legal/LegalLocaleContext';
import { useConsent } from '../../legal/useConsent';
import { useTranslation } from '../../../i18n';
import { formatStatusLabel } from '../../../utils/formatters';

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

const STEP_KEYS = ['personalInfo', 'documentDetails', 'uploadDocuments', 'verification'] as const;

const ID_TYPES = ['passport', 'drivers_license', 'national_id'];

// Country names double as the value stored on the verification and echoed
// back by the review screens, so they stay as data rather than being
// translated in the picker only.
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

  // Localized ID-type label; an unmapped value humanizes instead of leaking
  // the raw enum (same fallback policy as statusLabel).
  const idTypeLabel = (value: string): string => {
    if (!value) return '-';
    const translated = t(`idTypes.${value}`);
    return translated === value ? formatStatusLabel(value) : translated;
  };
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
      setError(t('registration.errors.imageOnly'));
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError(t('registration.errors.fileTooLarge'));
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
      setError(t('registration.errors.readFailed'));
    };
    reader.readAsDataURL(file);
  };

  const handleNext = () => {
    // Validate current step
    if (activeStep === 0) {
      if (!personalInfo.fullName || !personalInfo.dateOfBirth || !personalInfo.nationality ||
          !personalInfo.phone || !personalInfo.email || !personalInfo.currentAddress) {
        setError(t('registration.errors.requiredFields'));
        return;
      }

      // Validate email
      const emailValidation = validateEmail(personalInfo.email);
      if (emailValidation) {
        setEmailError(emailValidation);
        setError(emailValidation);
        return;
      }

    } else if (activeStep === 1) {
      if (!documentInfo.idType || !documentInfo.idNumber || !documentInfo.idIssuingCountry ||
          !documentInfo.idExpiryDate) {
        setError(t('registration.errors.requiredDocumentDetails'));
        return;
      }
      // Validate expiry date is in the future
      if (new Date(documentInfo.idExpiryDate) <= new Date()) {
        setError(t('registration.errors.expiryFuture'));
        return;
      }
    } else if (activeStep === 2) {
      if (!uploads.idFront || !uploads.selfie) {
        setError(t('registration.errors.uploadsRequired'));
        return;
      }
      if (documentInfo.idType !== 'passport' && !uploads.idBack) {
        setError(t('registration.errors.idBackRequired'));
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
      setError(t('registration.errors.consentRequired'));
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
      setError(errorMessage(err, t('registration.errors.submitFailed')));
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
                {t('registration.personalInfoHeading')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  marginBottom: "16px"
                }}>
                {t('registration.personalInfoHint')}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('registration.fields.fullName')}
                required
                value={personalInfo.fullName}
                onChange={(e) => setPersonalInfo({ ...personalInfo, fullName: e.target.value })}
                placeholder={t('registration.fields.fullNamePlaceholder')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <ModernDatePicker
                label={t('registration.fields.dateOfBirth')}
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
                label={t('registration.fields.nationality')}
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
                label={t('registration.fields.phone')}
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
                label={t('registration.fields.email')}
                type="email"
                required
                value={personalInfo.email}
                onChange={(e) => {
                  setPersonalInfo({ ...personalInfo, email: e.target.value });
                  setEmailError('');
                }}
                onBlur={() => setEmailError(validateEmail(personalInfo.email))}
                error={!!emailError}
                helperText={emailError}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label={t('registration.fields.currentAddress')}
                required
                multiline
                rows={3}
                value={personalInfo.currentAddress}
                onChange={(e) => setPersonalInfo({ ...personalInfo, currentAddress: e.target.value })}
                placeholder={t('registration.fields.currentAddressPlaceholder')}
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid size={12}>
              <Typography variant="h6" gutterBottom>
                {t('registration.documentHeading')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  marginBottom: "16px"
                }}>
                {t('registration.documentHint')}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label={t('registration.document.idType')}
                required
                value={documentInfo.idType}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idType: e.target.value })}
              >
                {ID_TYPES.map((idType) => (
                  <MenuItem key={idType} value={idType}>
                    {idTypeLabel(idType)}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label={t('registration.document.idNumber')}
                required
                value={documentInfo.idNumber}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                select
                label={t('registration.document.issuingCountry')}
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
                label={t('registration.document.issueDateOptional')}
                value={documentInfo.idIssueDate}
                onChange={(value) => setDocumentInfo({ ...documentInfo, idIssueDate: value })}
                maxDate={formatLocalDate()}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <ModernDatePicker
                label={t('registration.document.expiryDate')}
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
                {t('registration.uploadsHeading')}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: "text.secondary",
                  marginBottom: "16px"
                }}>
                {t('registration.uploadsHint')}
              </Typography>
            </Grid>
            {/* ID Front */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    {t('registration.uploads.idFront')} <Chip label={t('registration.uploads.required')} color="error" size="small" />
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.idFront ? (
                      <>
                        <img
                          src={uploads.idFront}
                          alt={t('registration.uploads.idFront')}
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, idFront: null }))}
                        >
                          {t('registration.uploads.remove')}
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
                          {t('registration.uploads.uploadIdFront')}
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
                      {t('registration.uploads.idBack')} <Chip label={t('registration.uploads.required')} color="error" size="small" />
                    </Typography>
                    <Box sx={{ mt: 2 }}>
                      {uploads.idBack ? (
                        <>
                          <img
                            src={uploads.idBack}
                            alt={t('registration.uploads.idBack')}
                            style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                          />
                          <Button
                            fullWidth
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => setUploads(prev => ({ ...prev, idBack: null }))}
                          >
                            {t('registration.uploads.remove')}
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
                            {t('registration.uploads.uploadIdBack')}
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
                    {t('registration.uploads.selfie')} <Chip label={t('registration.uploads.required')} color="error" size="small" />
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block",
                      mb: 2
                    }}>
                    {t('registration.uploads.selfieHint')}
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.selfie ? (
                      <>
                        <img
                          src={uploads.selfie}
                          alt={t('registration.uploads.selfie')}
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, selfie: null }))}
                        >
                          {t('registration.uploads.remove')}
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
                          {t('registration.uploads.takeSelfie')}
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
                    {t('registration.uploads.proofOfAddress')} <Chip label={t('registration.uploads.optional')} size="small" />
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                      display: "block",
                      mb: 2
                    }}>
                    {t('registration.uploads.proofHint')}
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.proofOfAddress ? (
                      <>
                        <img
                          src={uploads.proofOfAddress}
                          alt={t('registration.uploads.proofOfAddress')}
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, proofOfAddress: null }))}
                        >
                          {t('registration.uploads.remove')}
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
                          {t('registration.uploads.uploadDocument')}
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
              {t('registration.reviewHeading')}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                marginBottom: "16px"
              }}>
              {t('registration.reviewHint')}
            </Typography>
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  {t('registration.review.personalInfo')}
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.fullName')}</Typography>
                    <Typography variant="body1">{personalInfo.fullName}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.dateOfBirth')}</Typography>
                    <Typography variant="body1">{personalInfo.dateOfBirth}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.nationality')}</Typography>
                    <Typography variant="body1">{personalInfo.nationality}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.phone')}</Typography>
                    <Typography variant="body1">{personalInfo.phone}</Typography>
                  </Grid>
                  <Grid size={12}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.email')}</Typography>
                    <Typography variant="body1">{personalInfo.email}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  {t('registration.review.documentInfo')}
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.idType')}</Typography>
                    <Typography variant="body1">
                      {idTypeLabel(documentInfo.idType)}
                    </Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.idNumber')}</Typography>
                    <Typography variant="body1">{documentInfo.idNumber}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.issuingCountry')}</Typography>
                    <Typography variant="body1">{documentInfo.idIssuingCountry}</Typography>
                  </Grid>
                  <Grid size={6}>
                    <Typography variant="body2" sx={{
                      color: "text.secondary"
                    }}>{t('registration.review.expiryDate')}</Typography>
                    <Typography variant="body1">{documentInfo.idExpiryDate}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  {t('registration.review.uploadedDocuments')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {uploads.idFront && (
                    <Chip icon={<CheckIcon />} label={t('registration.uploads.idFront')} color="success" />
                  )}
                  {uploads.idBack && (
                    <Chip icon={<CheckIcon />} label={t('registration.uploads.idBack')} color="success" />
                  )}
                  {uploads.selfie && (
                    <Chip icon={<CheckIcon />} label={t('registration.uploads.selfie')} color="success" />
                  )}
                  {uploads.proofOfAddress && (
                    <Chip icon={<CheckIcon />} label={t('registration.uploads.proofOfAddress')} color="success" />
                  )}
                </Box>
              </CardContent>
            </Card>
            <Alert severity="info" sx={{ mt: 3 }}>
              <Typography variant="body2">
                {t('registration.secureNotice')}
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
              {t('registration.backToProfile')}
            </Button>
          }
        >
          {t('registration.guestOnly')}
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
            {t('registration.successTitle')}
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: "text.secondary",
              marginBottom: "16px"
            }}>
            {t('registration.successBody')}
          </Typography>
          <Typography variant="body2" sx={{
            color: "text.secondary"
          }}>
            {t('registration.redirecting')}
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
            {t('registration.title')}
          </Typography>
          <Typography variant="body1" sx={{
            color: "text.secondary"
          }}>
            {t('registration.subtitle')}
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {STEP_KEYS.map((stepKey) => (
            <Step key={stepKey}>
              <StepLabel>{t(`steps.${stepKey}`)}</StepLabel>
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
                {loading ? t('registration.submitting') : t('registration.submit')}
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
