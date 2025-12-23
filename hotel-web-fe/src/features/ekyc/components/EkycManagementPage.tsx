import React, { useState, useEffect } from 'react';
import {
  Box,
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Grid,
  Card,
  CardContent,
  CardMedia,
  IconButton,
  Tabs,
  Tab,
  Alert,
  CircularProgress,
  Rating,
  Divider,
} from '@mui/material';
import {
  CheckCircle as ApproveIcon,
  Cancel as RejectIcon,
  Visibility as ViewIcon,
  Close as CloseIcon,
  Person as PersonIcon,
  Badge as BadgeIcon,
  CameraAlt as PhotoIcon,
} from '@mui/icons-material';
import { format } from 'date-fns';

interface EkycVerification {
  id: number;
  user_id: number;
  guest_id: number | null;
  full_name: string;
  date_of_birth: string;
  nationality: string;
  phone: string;
  email: string;
  current_address: string;
  id_type: string;
  id_number: string;
  id_issuing_country: string;
  id_issue_date: string | null;
  id_expiry_date: string;
  id_front_image_path: string;
  id_back_image_path: string | null;
  selfie_image_path: string;
  proof_of_address_path: string | null;
  status: 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';
  verification_notes: string | null;
  verified_by: number | null;
  verified_at: string | null;
  face_match_score: number | null;
  face_match_passed: boolean;
  auto_verified: boolean;
  auto_verification_details: any;
  self_checkin_enabled: boolean;
  self_checkin_activated_at: string | null;
  submitted_at: string;
  updated_at: string;
}

const EkycManagementPage: React.FC = () => {
  const [verifications, setVerifications] = useState<EkycVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedVerification, setSelectedVerification] = useState<EkycVerification | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [faceMatchScore, setFaceMatchScore] = useState<number>(0);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchVerifications();
  }, []);

  const fetchVerifications = async () => {
    try {
      setLoading(true);
      const response = await fetch('http://localhost:3030/ekyc/verifications', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch verifications');
      }

      const data = await response.json();
      setVerifications(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = (verification: EkycVerification) => {
    setSelectedVerification(verification);
    setReviewNotes(verification.verification_notes || '');
    setFaceMatchScore(verification.face_match_score || 0);
    setDialogOpen(true);
  };

  const handleUpdateStatus = async (status: 'approved' | 'rejected', enableSelfCheckin: boolean = false) => {
    if (!selectedVerification) return;

    setProcessing(true);
    try {
      const response = await fetch(`http://localhost:3030/ekyc/verifications/${selectedVerification.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          status,
          verification_notes: reviewNotes,
          face_match_score: faceMatchScore > 0 ? faceMatchScore : null,
          face_match_passed: faceMatchScore >= 80,
          self_checkin_enabled: status === 'approved' && enableSelfCheckin,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update verification');
      }

      await fetchVerifications();
      setDialogOpen(false);
      setSelectedVerification(null);
      setReviewNotes('');
      setFaceMatchScore(0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'warning';
      case 'under_review':
        return 'info';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      case 'expired':
        return 'default';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const filteredVerifications = verifications.filter(v =>
    filterStatus === 'all' || v.status === filterStatus
  );

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4, mb: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body1" sx={{ mt: 2 }}>Loading verifications...</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="h4" gutterBottom>
            eKYC Verification Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Review and approve guest identity verifications
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <Tabs value={filterStatus} onChange={(e, v) => setFilterStatus(v)}>
            <Tab label="All" value="all" />
            <Tab label="Pending" value="pending" />
            <Tab label="Under Review" value="under_review" />
            <Tab label="Approved" value="approved" />
            <Tab label="Rejected" value="rejected" />
          </Tabs>
        </Box>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>Full Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>ID Type</TableCell>
                <TableCell>Submitted</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Self Check-in</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredVerifications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography variant="body2" color="text.secondary">
                      No verifications found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredVerifications.map((verification) => (
                  <TableRow key={verification.id} hover>
                    <TableCell>{verification.id}</TableCell>
                    <TableCell>{verification.full_name}</TableCell>
                    <TableCell>{verification.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={verification.id_type.replace('_', ' ').toUpperCase()}
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      {format(new Date(verification.submitted_at), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getStatusLabel(verification.status)}
                        color={getStatusColor(verification.status) as any}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      {verification.self_checkin_enabled ? (
                        <Chip label="Enabled" color="success" size="small" />
                      ) : (
                        <Chip label="Disabled" color="default" size="small" />
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        onClick={() => handleViewDetails(verification)}
                        color="primary"
                      >
                        <ViewIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Verification Details Dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        {selectedVerification && (
          <>
            <DialogTitle>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">eKYC Verification Details</Typography>
                <IconButton onClick={() => setDialogOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </Box>
            </DialogTitle>
            <DialogContent>
              <Grid container spacing={3}>
                {/* Personal Information */}
                <Grid item xs={12}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <PersonIcon sx={{ mr: 1, color: 'primary.main' }} />
                        <Typography variant="h6">Personal Information</Typography>
                      </Box>
                      <Grid container spacing={2}>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Full Name</Typography>
                          <Typography variant="body1">{selectedVerification.full_name}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Date of Birth</Typography>
                          <Typography variant="body1">{selectedVerification.date_of_birth}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Nationality</Typography>
                          <Typography variant="body1">{selectedVerification.nationality}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Phone</Typography>
                          <Typography variant="body1">{selectedVerification.phone}</Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Typography variant="caption" color="text.secondary">Email</Typography>
                          <Typography variant="body1">{selectedVerification.email}</Typography>
                        </Grid>
                        <Grid item xs={12}>
                          <Typography variant="caption" color="text.secondary">Address</Typography>
                          <Typography variant="body1">{selectedVerification.current_address}</Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Document Information */}
                <Grid item xs={12}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <BadgeIcon sx={{ mr: 1, color: 'primary.main' }} />
                        <Typography variant="h6">Document Information</Typography>
                      </Box>
                      <Grid container spacing={2}>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">ID Type</Typography>
                          <Typography variant="body1">
                            {selectedVerification.id_type.replace('_', ' ').toUpperCase()}
                          </Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">ID Number</Typography>
                          <Typography variant="body1">{selectedVerification.id_number}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Issuing Country</Typography>
                          <Typography variant="body1">{selectedVerification.id_issuing_country}</Typography>
                        </Grid>
                        <Grid item xs={6}>
                          <Typography variant="caption" color="text.secondary">Expiry Date</Typography>
                          <Typography variant="body1">{selectedVerification.id_expiry_date}</Typography>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Uploaded Documents */}
                <Grid item xs={12}>
                  <Card variant="outlined">
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <PhotoIcon sx={{ mr: 1, color: 'primary.main' }} />
                        <Typography variant="h6">Uploaded Documents</Typography>
                      </Box>
                      <Grid container spacing={2}>
                        <Grid item xs={12} md={4}>
                          <Typography variant="caption" color="text.secondary" gutterBottom>
                            ID Front
                          </Typography>
                          <Card variant="outlined">
                            <CardMedia
                              component="img"
                              image={`http://localhost:3030/${selectedVerification.id_front_image_path}`}
                              alt="ID Front"
                              sx={{ height: 200, objectFit: 'contain', p: 1 }}
                            />
                          </Card>
                        </Grid>
                        {selectedVerification.id_back_image_path && (
                          <Grid item xs={12} md={4}>
                            <Typography variant="caption" color="text.secondary" gutterBottom>
                              ID Back
                            </Typography>
                            <Card variant="outlined">
                              <CardMedia
                                component="img"
                                image={`http://localhost:3030/${selectedVerification.id_back_image_path}`}
                                alt="ID Back"
                                sx={{ height: 200, objectFit: 'contain', p: 1 }}
                              />
                            </Card>
                          </Grid>
                        )}
                        <Grid item xs={12} md={4}>
                          <Typography variant="caption" color="text.secondary" gutterBottom>
                            Selfie
                          </Typography>
                          <Card variant="outlined">
                            <CardMedia
                              component="img"
                              image={`http://localhost:3030/${selectedVerification.selfie_image_path}`}
                              alt="Selfie"
                              sx={{ height: 200, objectFit: 'contain', p: 1 }}
                            />
                          </Card>
                        </Grid>
                      </Grid>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Face Match Score */}
                <Grid item xs={12}>
                  <Card variant="outlined">
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom>
                        Face Match Score (Optional)
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Rating
                          value={faceMatchScore / 20}
                          onChange={(e, newValue) => setFaceMatchScore((newValue || 0) * 20)}
                          max={5}
                          precision={0.5}
                        />
                        <Typography variant="body2">
                          {faceMatchScore}% {faceMatchScore >= 80 && '(Pass)'}
                        </Typography>
                      </Box>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Review Notes */}
                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    multiline
                    rows={4}
                    label="Verification Notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add notes about your verification decision..."
                  />
                </Grid>

                {/* Current Status */}
                {selectedVerification.status !== 'pending' && (
                  <Grid item xs={12}>
                    <Alert severity="info">
                      <Typography variant="body2">
                        <strong>Current Status:</strong> {getStatusLabel(selectedVerification.status)}
                      </Typography>
                      {selectedVerification.verified_at && (
                        <Typography variant="body2">
                          <strong>Verified:</strong> {format(new Date(selectedVerification.verified_at), 'MMM dd, yyyy HH:mm')}
                        </Typography>
                      )}
                      {selectedVerification.verification_notes && (
                        <Typography variant="body2">
                          <strong>Notes:</strong> {selectedVerification.verification_notes}
                        </Typography>
                      )}
                    </Alert>
                  </Grid>
                )}
              </Grid>
            </DialogContent>
            <DialogActions sx={{ p: 3 }}>
              <Button onClick={() => setDialogOpen(false)} disabled={processing}>
                Cancel
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<RejectIcon />}
                onClick={() => handleUpdateStatus('rejected', false)}
                disabled={processing}
              >
                Reject
              </Button>
              <Button
                variant="contained"
                color="success"
                startIcon={<ApproveIcon />}
                onClick={() => handleUpdateStatus('approved', true)}
                disabled={processing}
              >
                {processing ? <CircularProgress size={20} /> : 'Approve & Enable Self Check-in'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Container>
  );
};

export default EkycManagementPage;
