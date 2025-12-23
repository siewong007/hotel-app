import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  TextField,
  Button,
  Avatar,
  Tab,
  Tabs,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Snackbar,
  Chip,
} from '@mui/material';
import {
  Person as PersonIcon,
  Lock as LockIcon,
  Fingerprint as FingerprintIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Save as SaveIcon,
  Cancel as CancelIcon,
  Edit as EditIcon,
  Check as CheckIcon,
  Laptop as LaptopIcon,
  Computer as ComputerIcon,
  PhoneIphone as PhoneIphoneIcon,
  Tablet as TabletIcon,
  Security as SecurityIcon,
  Smartphone as SmartphoneIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../../../api';
import { UserProfile, PasskeyInfo } from '../../../types';
import { useAuth } from '../../../auth/AuthContext';
import { validateEmail, validatePhone } from '../../../utils/validation';

// 2FA component imports
import TwoFactorSetup from '../../auth/components/TwoFactorSetup';
import EkycStatusCard from '../../ekyc/components/EkycStatusCard';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`profile-tabpanel-${index}`}
      aria-labelledby={`profile-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

// Device type detection and configuration
type DeviceType = 'laptop' | 'desktop' | 'mobile' | 'tablet' | 'security-key' | 'unknown';

interface DeviceConfig {
  type: DeviceType;
  icon: React.ReactElement;
  color: string;
  label: string;
  gradient: string;
}

const detectDeviceType = (deviceName: string): DeviceConfig => {
  const name = deviceName.toLowerCase();

  // Laptop detection
  if (name.includes('macbook') || name.includes('laptop') || name.includes('thinkpad') ||
      name.includes('notebook') || name.includes('xps') || name.includes('surface laptop') ||
      name.includes('chromebook')) {
    return {
      type: 'laptop',
      icon: <LaptopIcon />,
      color: '#1976d2',
      label: 'Laptop',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    };
  }

  // Desktop detection
  if (name.includes('desktop') || name.includes('pc') || name.includes('imac') ||
      name.includes('mac mini') || name.includes('mac studio') || name.includes('workstation')) {
    return {
      type: 'desktop',
      icon: <ComputerIcon />,
      color: '#2e7d32',
      label: 'Desktop',
      gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    };
  }

  // Tablet detection
  if (name.includes('ipad') || name.includes('tablet') || name.includes('surface pro') ||
      name.includes('galaxy tab')) {
    return {
      type: 'tablet',
      icon: <TabletIcon />,
      color: '#ed6c02',
      label: 'Tablet',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    };
  }

  // Mobile phone detection
  if (name.includes('iphone') || name.includes('android') || name.includes('pixel') ||
      name.includes('samsung') || name.includes('galaxy') || name.includes('mobile') ||
      name.includes('phone') || name.includes('oneplus') || name.includes('xiaomi')) {
    return {
      type: 'mobile',
      icon: name.includes('iphone') ? <PhoneIphoneIcon /> : <SmartphoneIcon />,
      color: '#9c27b0',
      label: name.includes('iphone') ? 'iPhone' : 'Mobile',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    };
  }

  // Security key detection
  if (name.includes('yubikey') || name.includes('security key') || name.includes('fido') ||
      name.includes('u2f') || name.includes('token')) {
    return {
      type: 'security-key',
      icon: <SecurityIcon />,
      color: '#d32f2f',
      label: 'Security Key',
      gradient: 'linear-gradient(135deg, #ff6b6b 0%, #c92a2a 100%)',
    };
  }

  // Unknown/default
  return {
    type: 'unknown',
    icon: <FingerprintIcon />,
    color: '#757575',
    label: 'Device',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  };
};

// Animated device icon component
interface DeviceIconProps {
  deviceName: string;
  size?: number;
}

const DeviceIcon: React.FC<DeviceIconProps> = ({ deviceName, size = 48 }) => {
  const config = detectDeviceType(deviceName);

  return (
    <Box
      sx={{
        position: 'relative',
        width: size + 16,
        height: size + 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Animated background pulse */}
      <Box
        sx={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: config.gradient,
          opacity: 0.2,
          animation: 'pulse 2s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': {
              transform: 'scale(0.95)',
              opacity: 0.2,
            },
            '50%': {
              transform: 'scale(1.05)',
              opacity: 0.3,
            },
          },
        }}
      />

      {/* Icon container */}
      <Box
        sx={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius: '50%',
          background: config.gradient,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          transition: 'transform 0.3s ease',
          '&:hover': {
            transform: 'scale(1.1) rotate(5deg)',
          },
          '& svg': {
            fontSize: size * 0.6,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))',
          },
        }}
      >
        {config.icon}
      </Box>
    </Box>
  );
};

const UserProfilePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyInfo[]>([]);
  const [editing, setEditing] = useState(false);
  const [editingPasskey, setEditingPasskey] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');

  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    avatar_url: '',
  });

  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });

  const [showNewPasswordFields, setShowNewPasswordFields] = useState(false);

  const { registerPasskey } = useAuth();

  useEffect(() => {
    loadProfile();
    loadPasskeys();

    // Check if we should auto-enter edit mode
    const editParam = searchParams.get('edit');
    if (editParam === 'true') {
      setEditing(true);
      // Remove the edit parameter from URL after reading it
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProfile = async () => {
    try {
      const data = await HotelAPIService.getUserProfile();
      setProfile(data);
      setFormData({
        full_name: data.full_name || '',
        email: data.email || '',
        phone: data.phone || '',
        avatar_url: data.avatar_url || '',
      });
    } catch (error: any) {
      console.error('Failed to load profile:', error);
      showSnackbar('Failed to load profile', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadPasskeys = async () => {
    try {
      const data = await HotelAPIService.listPasskeys();
      setPasskeys(data);
    } catch (error: any) {
      console.error('Failed to load passkeys:', error);
    }
  };

  const handleUpdateProfile = async () => {
    // Validate email
    const emailValidation = validateEmail(formData.email);
    if (emailValidation) {
      setEmailError(emailValidation);
      showSnackbar(emailValidation, 'error');
      return;
    }

    // Validate phone if provided
    if (formData.phone) {
      const phoneValidation = validatePhone(formData.phone);
      if (phoneValidation) {
        setPhoneError(phoneValidation);
        showSnackbar(phoneValidation, 'error');
        return;
      }
    }

    try {
      await HotelAPIService.updateUserProfile(formData);
      setEditing(false);
      await loadProfile();
      showSnackbar('Profile updated successfully', 'success');
    } catch (error: any) {
      console.error('Failed to update profile:', error);
      showSnackbar('Failed to update profile', 'error');
    }
  };

  const handleCurrentPasswordSubmit = () => {
    if (!passwordData.current_password) {
      showSnackbar('Please enter your current password', 'error');
      return;
    }

    if (passwordData.current_password.length < 3) {
      showSnackbar('Please enter a valid password', 'error');
      return;
    }

    // Show new password fields after current password is entered
    setShowNewPasswordFields(true);
  };

  const handleUpdatePassword = async () => {
    if (!passwordData.current_password || !passwordData.new_password) {
      showSnackbar('Please fill in all password fields', 'error');
      return;
    }

    if (passwordData.new_password !== passwordData.confirm_password) {
      showSnackbar('New passwords do not match', 'error');
      return;
    }

    if (passwordData.new_password.length < 8) {
      showSnackbar('Password must be at least 8 characters long', 'error');
      return;
    }

    try {
      await HotelAPIService.updatePassword({
        current_password: passwordData.current_password,
        new_password: passwordData.new_password,
      });
      setPasswordData({ current_password: '', new_password: '', confirm_password: '' });
      setShowNewPasswordFields(false);
      showSnackbar('Password updated successfully', 'success');
    } catch (error: any) {
      console.error('Failed to update password:', error);
      showSnackbar(error.message || 'Failed to update password', 'error');
    }
  };

  const handleCancelPasswordChange = () => {
    setPasswordData({ current_password: '', new_password: '', confirm_password: '' });
    setShowNewPasswordFields(false);
  };

  const handleDeletePasskey = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this passkey?')) return;

    try {
      await HotelAPIService.deletePasskey(id);
      await loadPasskeys();
      showSnackbar('Passkey deleted successfully', 'success');
    } catch (error: any) {
      console.error('Failed to delete passkey:', error);
      showSnackbar('Failed to delete passkey', 'error');
    }
  };

  const handleAddPasskey = async () => {
    if (passkeys.length >= 10) {
      showSnackbar('Maximum of 10 passkeys allowed', 'error');
      return;
    }

    if (!profile) return;

    try {
      await registerPasskey(profile.username);
      await loadPasskeys();
      showSnackbar('Passkey registered successfully', 'success');
    } catch (error: any) {
      console.error('Failed to register passkey:', error);
      showSnackbar(error.message || 'Failed to register passkey', 'error');
    }
  };

  const handleEditPasskey = (id: string, currentName: string) => {
    setEditingPasskey(id);
    setPasskeyName(currentName || '');
  };

  const handleSavePasskeyName = async (id: string) => {
    if (!passkeyName.trim()) {
      showSnackbar('Passkey name cannot be empty', 'error');
      return;
    }

    try {
      await HotelAPIService.updatePasskey(id, { device_name: passkeyName });
      setEditingPasskey(null);
      setPasskeyName('');
      await loadPasskeys();
      showSnackbar('Passkey name updated successfully', 'success');
    } catch (error: any) {
      console.error('Failed to update passkey:', error);
      showSnackbar('Failed to update passkey name', 'error');
    }
  };

  const handleCancelEditPasskey = () => {
    setEditingPasskey(null);
    setPasskeyName('');
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbar({ open: true, message, severity });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (!profile) {
    return (
      <Alert severity="error">
        Failed to load user profile. Please try again.
      </Alert>
    );
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, mb: 3, color: 'primary.main' }}>
        User Profile
      </Typography>

      <Card sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setActiveTab(v)}>
          <Tab label="Profile" icon={<PersonIcon />} iconPosition="start" />
          <Tab label="Security" icon={<LockIcon />} iconPosition="start" />
          <Tab label="Passkeys" icon={<FingerprintIcon />} iconPosition="start" />
          <Tab label="2FA" icon={<SecurityIcon />} iconPosition="start" />
        </Tabs>
      </Card>

      {/* Profile Tab */}
      <TabPanel value={activeTab} index={0}>
        {/* eKYC Status Card */}
        <Box sx={{ mb: 3 }}>
          <EkycStatusCard />
        </Box>

        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
              <Avatar
                src={formData.avatar_url || profile?.avatar_url}
                sx={{
                  width: 80,
                  height: 80,
                  mr: 3,
                  bgcolor: 'primary.main',
                  fontSize: '2rem',
                  fontWeight: 600,
                }}
              >
                {!formData.avatar_url && !profile?.avatar_url && (profile?.full_name?.charAt(0) || profile?.username?.charAt(0))}
              </Avatar>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  {profile?.full_name || profile?.username}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  @{profile?.username}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Member since {new Date(profile?.created_at).toLocaleDateString()}
                </Typography>
              </Box>
              {!editing ? (
                <Button
                  variant="contained"
                  startIcon={<PersonIcon />}
                  onClick={() => setEditing(true)}
                >
                  Edit Profile
                </Button>
              ) : (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    variant="outlined"
                    startIcon={<CancelIcon />}
                    onClick={() => {
                      setEditing(false);
                      setFormData({
                        full_name: profile?.full_name || '',
                        email: profile?.email || '',
                        phone: profile?.phone || '',
                        avatar_url: profile?.avatar_url || '',
                      });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleUpdateProfile}
                  >
                    Save
                  </Button>
                </Box>
              )}
            </Box>

            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Full Name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  disabled={!editing}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => {
                    setFormData({ ...formData, email: e.target.value });
                    setEmailError('');
                  }}
                  onBlur={() => {
                    if (editing) {
                      setEmailError(validateEmail(formData.email));
                    }
                  }}
                  error={!!emailError}
                  helperText={emailError}
                  disabled={!editing}
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  fullWidth
                  label="Phone"
                  value={formData.phone}
                  onChange={(e) => {
                    setFormData({ ...formData, phone: e.target.value });
                    setPhoneError('');
                  }}
                  onBlur={() => {
                    if (editing && formData.phone) {
                      setPhoneError(validatePhone(formData.phone));
                    }
                  }}
                  error={!!phoneError}
                  helperText={phoneError}
                  disabled={!editing}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  label="Avatar URL"
                  value={formData.avatar_url}
                  onChange={(e) => setFormData({ ...formData, avatar_url: e.target.value })}
                  disabled={!editing}
                  helperText="Enter a URL to your profile picture or upload an image below"
                />
              </Grid>
              {editing && (
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                      variant="outlined"
                      component="label"
                      disabled={!editing}
                    >
                      Upload Profile Picture
                      <input
                        type="file"
                        hidden
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            // Check file size (max 2MB)
                            if (file.size > 2 * 1024 * 1024) {
                              showSnackbar('Image size must be less than 2MB', 'error');
                              return;
                            }
                            // Convert to base64
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setFormData({ ...formData, avatar_url: reader.result as string });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </Button>
                    {formData.avatar_url && (
                      <Button
                        variant="text"
                        color="error"
                        onClick={() => setFormData({ ...formData, avatar_url: '' })}
                      >
                        Remove Picture
                      </Button>
                    )}
                    {formData.avatar_url && (
                      <Avatar
                        src={formData.avatar_url}
                        sx={{ width: 40, height: 40 }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                    Supported formats: JPG, PNG, GIF. Max size: 2MB
                  </Typography>
                </Grid>
              )}
            </Grid>
          </CardContent>
        </Card>
      </TabPanel>

      {/* Security Tab */}
      <TabPanel value={activeTab} index={1}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 3 }}>
              Change Password
            </Typography>
            <Grid container spacing={3}>
              <Grid item xs={12}>
                <TextField
                  fullWidth
                  type="password"
                  label="Current Password"
                  value={passwordData.current_password}
                  onChange={(e) =>
                    setPasswordData({ ...passwordData, current_password: e.target.value })
                  }
                  disabled={showNewPasswordFields}
                  helperText={!showNewPasswordFields ? "Enter your current password to continue" : ""}
                />
              </Grid>

              {!showNewPasswordFields && (
                <Grid item xs={12}>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant="contained"
                      onClick={handleCurrentPasswordSubmit}
                      disabled={!passwordData.current_password}
                    >
                      Continue
                    </Button>
                  </Box>
                </Grid>
              )}

              {showNewPasswordFields && (
                <>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      type="password"
                      label="New Password"
                      value={passwordData.new_password}
                      onChange={(e) =>
                        setPasswordData({ ...passwordData, new_password: e.target.value })
                      }
                      helperText="Minimum 8 characters"
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <TextField
                      fullWidth
                      type="password"
                      label="Confirm New Password"
                      value={passwordData.confirm_password}
                      onChange={(e) =>
                        setPasswordData({ ...passwordData, confirm_password: e.target.value })
                      }
                    />
                  </Grid>
                </>
              )}
            </Grid>

            {showNewPasswordFields && (
              <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                <Button
                  variant="outlined"
                  onClick={handleCancelPasswordChange}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  startIcon={<LockIcon />}
                  onClick={handleUpdatePassword}
                  disabled={!passwordData.new_password || !passwordData.confirm_password}
                >
                  Update Password
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* Passkeys Tab */}
      <TabPanel value={activeTab} index={2}>
        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>
                  Registered Passkeys ({passkeys.length}/10)
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Passkeys provide secure, passwordless authentication
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleAddPasskey}
                disabled={passkeys.length >= 10}
              >
                Add Passkey
              </Button>
            </Box>

            {passkeys.length === 0 ? (
              <Box
                sx={{
                  textAlign: 'center',
                  py: 6,
                  backgroundColor: 'background.default',
                  borderRadius: 2,
                }}
              >
                <FingerprintIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  No passkeys registered
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Add a passkey for secure, passwordless login
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={handleAddPasskey}
                >
                  Register Your First Passkey
                </Button>
              </Box>
            ) : (
              <List>
                {passkeys.map((passkey, index) => {
                  const deviceConfig = detectDeviceType(passkey.device_name || '');
                  return (
                    <ListItem
                      key={passkey.id}
                      divider={index < passkeys.length - 1}
                      sx={{
                        py: 2.5,
                        px: 2,
                        borderRadius: 2,
                        mb: 1,
                        transition: 'all 0.3s ease',
                        '&:hover': {
                          backgroundColor: 'action.hover',
                          transform: 'translateX(4px)',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        },
                      }}
                    >
                      <Box sx={{ mr: 2 }}>
                        <DeviceIcon deviceName={passkey.device_name || ''} size={48} />
                      </Box>
                      {editingPasskey === passkey.id ? (
                        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <TextField
                            size="small"
                            value={passkeyName}
                            onChange={(e) => setPasskeyName(e.target.value)}
                            placeholder="Device name (e.g., MacBook Pro, iPhone 15, YubiKey)"
                            autoFocus
                            sx={{ flexGrow: 1 }}
                          />
                          <IconButton
                            color="primary"
                            onClick={() => handleSavePasskeyName(passkey.id)}
                            title="Save"
                          >
                            <CheckIcon />
                          </IconButton>
                          <IconButton
                            onClick={handleCancelEditPasskey}
                            title="Cancel"
                          >
                            <CancelIcon />
                          </IconButton>
                        </Box>
                      ) : (
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                                {passkey.device_name || 'Unnamed Device'}
                              </Typography>
                              <Chip
                                label={deviceConfig.label}
                                size="small"
                                sx={{
                                  background: deviceConfig.gradient,
                                  color: 'white',
                                  fontWeight: 500,
                                  fontSize: '0.7rem',
                                  height: 20,
                                }}
                              />
                            </Box>
                          }
                          secondary={
                            <Box sx={{ mt: 0.5 }}>
                              <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <strong>Added:</strong> {new Date(passkey.created_at).toLocaleDateString('en-US', {
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </Typography>
                              {passkey.last_used_at && (
                                <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                  <strong>Last used:</strong> {new Date(passkey.last_used_at).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                  })} at {new Date(passkey.last_used_at).toLocaleTimeString('en-US', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </Typography>
                              )}
                              {!passkey.last_used_at && (
                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                  Never used
                                </Typography>
                              )}
                            </Box>
                          }
                        />
                      )}
                      <ListItemSecondaryAction>
                        {editingPasskey !== passkey.id && (
                          <>
                            <IconButton
                              edge="end"
                              onClick={() => handleEditPasskey(passkey.id, passkey.device_name || '')}
                              title="Edit passkey name"
                              sx={{
                                mr: 1,
                                '&:hover': {
                                  backgroundColor: 'primary.light',
                                  color: 'primary.contrastText',
                                },
                              }}
                            >
                              <EditIcon />
                            </IconButton>
                            <IconButton
                              edge="end"
                              color="error"
                              onClick={() => handleDeletePasskey(passkey.id)}
                              title="Delete passkey"
                              sx={{
                                '&:hover': {
                                  backgroundColor: 'error.light',
                                  color: 'error.contrastText',
                                },
                              }}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </>
                        )}
                      </ListItemSecondaryAction>
                    </ListItem>
                  );
                })}
              </List>
            )}

            {passkeys.length >= 10 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Maximum number of passkeys reached (10/10). Delete a passkey to add a new one.
              </Alert>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* 2FA Tab */}
      <TabPanel value={activeTab} index={3}>
        <TwoFactorSetup />
      </TabPanel>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={handleCloseSnackbar}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default UserProfilePage;
