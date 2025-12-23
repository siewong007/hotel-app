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
import { useNavigate } from 'react-router-dom';
import { HotelAPIService } from '../../../api';
import { validateEmail, validatePhone } from '../../../utils/validation';
import ModernDatePicker from '../../../components/common/ModernDatePicker';

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

const steps = ['Personal Information', 'Document Details', 'Upload Documents', 'Verification'];

const idTypes = [
  { value: 'passport', label: 'Passport' },
  { value: 'drivers_license', label: 'Driver\'s License' },
  { value: 'national_id', label: 'National ID Card' },
];

const countries = [
  'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
  'France', 'Italy', 'Spain', 'Japan', 'China', 'India', 'Brazil',
  'Mexico', 'Singapore', 'Malaysia', 'Thailand', 'Indonesia', 'Philippines',
  'South Korea', 'Vietnam', 'Other'
];

const EkycRegistrationPage: React.FC = () => {
  const navigate = useNavigate();
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
      setError('Please upload an image file (JPG, PNG)');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
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
      setError('Failed to read file');
    };
    reader.readAsDataURL(file);
  };

  const handleNext = () => {
    // Validate current step
    if (activeStep === 0) {
      if (!personalInfo.fullName || !personalInfo.dateOfBirth || !personalInfo.nationality ||
          !personalInfo.phone || !personalInfo.email || !personalInfo.currentAddress) {
        setError('Please fill in all required fields');
        return;
      }

      // Validate email
      const emailValidation = validateEmail(personalInfo.email);
      if (emailValidation) {
        setEmailError(emailValidation);
        setError(emailValidation);
        return;
      }

      // Validate phone
      const phoneValidation = validatePhone(personalInfo.phone);
      if (phoneValidation) {
        setPhoneError(phoneValidation);
        setError(phoneValidation);
        return;
      }
    } else if (activeStep === 1) {
      if (!documentInfo.idType || !documentInfo.idNumber || !documentInfo.idIssuingCountry ||
          !documentInfo.idExpiryDate) {
        setError('Please fill in all required document details');
        return;
      }
      // Validate expiry date is in the future
      if (new Date(documentInfo.idExpiryDate) <= new Date()) {
        setError('ID expiry date must be in the future');
        return;
      }
    } else if (activeStep === 2) {
      if (!uploads.idFront || !uploads.selfie) {
        setError('Please upload your ID front and selfie photo');
        return;
      }
      if (documentInfo.idType !== 'passport' && !uploads.idBack) {
        setError('Please upload the back of your ID');
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

  // Upload single document
  const uploadDocument = async (base64Data: string, documentType: string): Promise<string> => {
    const blob = base64ToBlob(base64Data);
    const formData = new FormData();
    formData.append('file', blob, `${documentType}.jpg`);
    formData.append('documentType', documentType);

    const response = await fetch('http://localhost:3030/ekyc/upload-document', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload ${documentType}`);
    }

    const data = await response.json();
    return data.file_path;
  };

  const handleSubmit = async () => {
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
      };

      // Call API to submit eKYC
      const response = await fetch('http://localhost:3030/ekyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        throw new Error('Failed to submit eKYC verification');
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/profile?ekycSubmitted=true');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit eKYC verification');
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Personal Information
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Please provide your personal details as they appear on your ID document.
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Full Name"
                required
                value={personalInfo.fullName}
                onChange={(e) => setPersonalInfo({ ...personalInfo, fullName: e.target.value })}
                placeholder="As shown on ID"
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <ModernDatePicker
                label="Date of Birth"
                value={personalInfo.dateOfBirth}
                onChange={(value) => setPersonalInfo({ ...personalInfo, dateOfBirth: value })}
                maxDate={new Date().toISOString().split('T')[0]}
                required
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Nationality"
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

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="Phone Number"
                required
                value={personalInfo.phone}
                onChange={(e) => {
                  setPersonalInfo({ ...personalInfo, phone: e.target.value });
                  setPhoneError('');
                }}
                onBlur={() => setPhoneError(validatePhone(personalInfo.phone))}
                error={!!phoneError}
                helperText={phoneError}
                placeholder="+1-234-567-8900"
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Email Address"
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

            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Current Address"
                required
                multiline
                rows={3}
                value={personalInfo.currentAddress}
                onChange={(e) => setPersonalInfo({ ...personalInfo, currentAddress: e.target.value })}
                placeholder="Street, City, State, ZIP, Country"
              />
            </Grid>
          </Grid>
        );

      case 1:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Identity Document Details
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Enter the details from your government-issued ID.
              </Typography>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="ID Type"
                required
                value={documentInfo.idType}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idType: e.target.value })}
              >
                {idTypes.map((type) => (
                  <MenuItem key={type.value} value={type.value}>
                    {type.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                label="ID Number"
                required
                value={documentInfo.idNumber}
                onChange={(e) => setDocumentInfo({ ...documentInfo, idNumber: e.target.value })}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <TextField
                fullWidth
                select
                label="Issuing Country"
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

            <Grid item xs={12} md={6}>
              <ModernDatePicker
                label="Issue Date (Optional)"
                value={documentInfo.idIssueDate}
                onChange={(value) => setDocumentInfo({ ...documentInfo, idIssueDate: value })}
                maxDate={new Date().toISOString().split('T')[0]}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <ModernDatePicker
                label="Expiry Date"
                value={documentInfo.idExpiryDate}
                onChange={(value) => setDocumentInfo({ ...documentInfo, idExpiryDate: value })}
                minDate={new Date().toISOString().split('T')[0]}
                required
              />
            </Grid>
          </Grid>
        );

      case 2:
        return (
          <Grid container spacing={3}>
            <Grid item xs={12}>
              <Typography variant="h6" gutterBottom>
                Upload Documents
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Please upload clear photos of your ID and a recent selfie.
              </Typography>
            </Grid>

            {/* ID Front */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    ID Front <Chip label="Required" color="error" size="small" />
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.idFront ? (
                      <>
                        <img
                          src={uploads.idFront}
                          alt="ID Front"
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, idFront: null }))}
                        >
                          Remove
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
                          Upload ID Front
                        </Button>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* ID Back */}
            {documentInfo.idType !== 'passport' && (
              <Grid item xs={12} md={6}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="subtitle2" gutterBottom>
                      ID Back <Chip label="Required" color="error" size="small" />
                    </Typography>
                    <Box sx={{ mt: 2 }}>
                      {uploads.idBack ? (
                        <>
                          <img
                            src={uploads.idBack}
                            alt="ID Back"
                            style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                          />
                          <Button
                            fullWidth
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteIcon />}
                            onClick={() => setUploads(prev => ({ ...prev, idBack: null }))}
                          >
                            Remove
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
                            Upload ID Back
                          </Button>
                        </>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            )}

            {/* Selfie */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    Selfie Photo <Chip label="Required" color="error" size="small" />
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                    Take a clear photo of your face for verification
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.selfie ? (
                      <>
                        <img
                          src={uploads.selfie}
                          alt="Selfie"
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, selfie: null }))}
                        >
                          Remove
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
                          Take Selfie
                        </Button>
                      </>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Proof of Address (Optional) */}
            <Grid item xs={12} md={6}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2" gutterBottom>
                    Proof of Address <Chip label="Optional" size="small" />
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                    Utility bill, bank statement, etc.
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    {uploads.proofOfAddress ? (
                      <>
                        <img
                          src={uploads.proofOfAddress}
                          alt="Proof of Address"
                          style={{ width: '100%', borderRadius: 8, marginBottom: 16 }}
                        />
                        <Button
                          fullWidth
                          variant="outlined"
                          color="error"
                          startIcon={<DeleteIcon />}
                          onClick={() => setUploads(prev => ({ ...prev, proofOfAddress: null }))}
                        >
                          Remove
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
                          Upload Document
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
              Review & Submit
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Please review your information before submitting.
            </Typography>

            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  Personal Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Full Name:</Typography>
                    <Typography variant="body1">{personalInfo.fullName}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Date of Birth:</Typography>
                    <Typography variant="body1">{personalInfo.dateOfBirth}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Nationality:</Typography>
                    <Typography variant="body1">{personalInfo.nationality}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Phone:</Typography>
                    <Typography variant="body1">{personalInfo.phone}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary">Email:</Typography>
                    <Typography variant="body1">{personalInfo.email}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            <Card variant="outlined" sx={{ mb: 3 }}>
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  Document Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">ID Type:</Typography>
                    <Typography variant="body1">
                      {idTypes.find(t => t.value === documentInfo.idType)?.label}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">ID Number:</Typography>
                    <Typography variant="body1">{documentInfo.idNumber}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Issuing Country:</Typography>
                    <Typography variant="body1">{documentInfo.idIssuingCountry}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Expiry Date:</Typography>
                    <Typography variant="body1">{documentInfo.idExpiryDate}</Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            <Card variant="outlined">
              <CardContent>
                <Typography variant="subtitle2" color="primary" gutterBottom>
                  Uploaded Documents
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {uploads.idFront && (
                    <Chip icon={<CheckIcon />} label="ID Front" color="success" />
                  )}
                  {uploads.idBack && (
                    <Chip icon={<CheckIcon />} label="ID Back" color="success" />
                  )}
                  {uploads.selfie && (
                    <Chip icon={<CheckIcon />} label="Selfie" color="success" />
                  )}
                  {uploads.proofOfAddress && (
                    <Chip icon={<CheckIcon />} label="Proof of Address" color="success" />
                  )}
                </Box>
              </CardContent>
            </Card>

            <Alert severity="info" sx={{ mt: 3 }}>
              <Typography variant="body2">
                Your information will be securely processed and verified. You will be notified once your verification is complete.
                Once approved, you'll be able to use self-check-in for your bookings.
              </Typography>
            </Alert>
          </Box>
        );

      default:
        return null;
    }
  };

  if (success) {
    return (
      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CheckIcon sx={{ fontSize: 80, color: 'success.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            eKYC Submitted Successfully!
          </Typography>
          <Typography variant="body1" color="text.secondary" paragraph>
            Your identity verification has been submitted and is under review.
            You will receive an email notification once your verification is approved.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Redirecting to your profile...
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
            eKYC Registration
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Complete your identity verification to enable self-check-in
          </Typography>
        </Box>

        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
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
            Back
          </Button>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              onClick={() => navigate('/profile')}
            >
              Cancel
            </Button>

            {activeStep === steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={loading}
                endIcon={loading ? <CircularProgress size={20} /> : <CheckIcon />}
              >
                {loading ? 'Submitting...' : 'Submit for Verification'}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
                endIcon={<ForwardIcon />}
              >
                Next
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Container>
  );
};

export default EkycRegistrationPage;
