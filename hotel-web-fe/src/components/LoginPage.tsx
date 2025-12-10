import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Paper,
  TextField,
  Button,
  Typography,
  Alert,
  Tabs,
  Tab,
  CircularProgress,
} from '@mui/material';
import { Hotel as HotelIcon, Lock as LockIcon, Fingerprint as FingerprintIcon } from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';
import FirstLoginPasskeyPrompt from './FirstLoginPasskeyPrompt';

const LoginPage: React.FC = () => {
  const [tab, setTab] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showFirstLoginPrompt, setShowFirstLoginPrompt] = useState(false);
  const { login, loginWithPasskey, registerPasskey } = useAuth();
  const navigate = useNavigate();

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const isFirstLogin = await login(username, password);
      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
        setLoading(false);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!username) {
      setError('Please enter your username');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const isFirstLogin = await loginWithPasskey(username);
      if (isFirstLogin) {
        setShowFirstLoginPrompt(true);
        setLoading(false);
      } else {
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || 'Passkey login failed');
      setLoading(false);
    }
  };

  const handlePasskeyRegister = async () => {
    if (!username) {
      setError('Please enter your username');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await registerPasskey(username);
      setError('');
      alert('Passkey registered successfully! You can now use it to log in.');
    } catch (err: any) {
      setError(err.message || 'Passkey registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          opacity: 0.3,
        },
      }}
    >
      <Container maxWidth="sm" sx={{ position: 'relative', zIndex: 1 }}>
        <Paper 
          elevation={24} 
          sx={{ 
            p: 5, 
            width: '100%',
            borderRadius: 3,
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box sx={{
              display: 'inline-flex',
              p: 2,
              borderRadius: 2,
              background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
              mb: 2,
            }}>
              <HotelIcon sx={{ fontSize: 48, color: 'white' }} />
            </Box>
            <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700, color: 'text.primary' }}>
              Hotel Management System
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Sign in to continue to your dashboard
            </Typography>
          </Box>

          <Tabs 
            value={tab} 
            onChange={(_, newValue) => setTab(newValue)} 
            sx={{ 
              mb: 3,
              '& .MuiTab-root': {
                textTransform: 'none',
                fontWeight: 600,
                minHeight: 56,
              },
            }}
            variant="fullWidth"
          >
            <Tab icon={<LockIcon />} iconPosition="start" label="Password" />
            <Tab icon={<FingerprintIcon />} iconPosition="start" label="Passkey" />
          </Tabs>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {tab === 0 && (
            <form onSubmit={handlePasswordLogin}>
              <TextField
                fullWidth
                label="Username or Email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
                required
                autoFocus
              />
              <TextField
                fullWidth
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                margin="normal"
                required
              />
              <Button
                type="submit"
                fullWidth
                variant="contained"
                sx={{ 
                  mt: 3, 
                  mb: 2,
                  py: 1.5,
                  background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
                  fontWeight: 600,
                  fontSize: '1rem',
                  '&:hover': {
                    background: 'linear-gradient(135deg, #1557b0 0%, #1a73e8 100%)',
                  },
                }}
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Sign In'}
              </Button>
            </form>
          )}

          {tab === 1 && (
            <Box>
              <TextField
                fullWidth
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                margin="normal"
                required
                autoFocus
              />
              <Button
                fullWidth
                variant="contained"
                sx={{ mt: 3, mb: 2 }}
                onClick={handlePasskeyLogin}
                disabled={loading || !username}
                startIcon={<FingerprintIcon />}
              >
                {loading ? <CircularProgress size={24} /> : 'Login with Passkey'}
              </Button>
              <Button
                fullWidth
                variant="outlined"
                onClick={handlePasskeyRegister}
                disabled={loading || !username}
              >
                Register New Passkey
              </Button>
            </Box>
          )}

          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Default credentials: admin / admin123
            </Typography>
          </Box>
        </Paper>
      </Container>

      <FirstLoginPasskeyPrompt
        open={showFirstLoginPrompt}
        username={username}
        onClose={() => {
          setShowFirstLoginPrompt(false);
          navigate('/');
        }}
      />
    </Box>
  );
};

export default LoginPage;

