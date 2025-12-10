import React, { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  Chip,
  LinearProgress,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
} from '@mui/material';
import {
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  ExpandMore as ExpandMoreIcon,
  PlayArrow as PlayIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { CircularProgress } from '@mui/material';

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: 'pending' | 'running' | 'pass' | 'fail';
  message?: string;
  duration?: number;
  response?: any;
}

const APITestPage: React.FC = () => {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [currentTest, setCurrentTest] = useState<string>('');

  const updateResult = (name: string, update: Partial<TestResult>) => {
    setResults(prev =>
      prev.map(r => r.name === name ? { ...r, ...update } : r)
    );
  };

  const runTest = async (test: TestResult, testFn: () => Promise<any>) => {
    setCurrentTest(test.name);
    updateResult(test.name, { status: 'running' });

    const startTime = Date.now();
    try {
      const response = await testFn();
      const duration = Date.now() - startTime;

      updateResult(test.name, {
        status: 'pass',
        duration,
        message: 'Success',
        response: typeof response === 'object' ? JSON.stringify(response, null, 2) : response,
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      updateResult(test.name, {
        status: 'fail',
        duration,
        message: error.message || 'Request failed',
        response: error.toString(),
      });
    }
  };

  const runAllTests = async () => {
    setTesting(true);
    setCurrentTest('');

    const tests: TestResult[] = [
      // Health Tests
      { name: 'Health Check', endpoint: '/health', method: 'GET', status: 'pending' },
      { name: 'WebSocket Status', endpoint: '/ws/status', method: 'GET', status: 'pending' },

      // Room Tests
      { name: 'Get All Rooms', endpoint: '/rooms', method: 'GET', status: 'pending' },
      { name: 'Search Available Rooms', endpoint: '/rooms/available', method: 'GET', status: 'pending' },
      { name: 'Search Rooms by Type', endpoint: '/rooms/available?type=suite', method: 'GET', status: 'pending' },
      { name: 'Search Rooms by Price', endpoint: '/rooms/available?max_price=200', method: 'GET', status: 'pending' },

      // Guest Tests
      { name: 'Get All Guests', endpoint: '/guests', method: 'GET', status: 'pending' },

      // Booking Tests
      { name: 'Get All Bookings', endpoint: '/bookings', method: 'GET', status: 'pending' },
      { name: 'Get Bookings with Details', endpoint: '/bookings (detailed)', method: 'GET', status: 'pending' },

      // RBAC Tests
      { name: 'Get All Roles', endpoint: '/rbac/roles', method: 'GET', status: 'pending' },
      { name: 'Get All Permissions', endpoint: '/rbac/permissions', method: 'GET', status: 'pending' },
      { name: 'Get All Users', endpoint: '/rbac/users', method: 'GET', status: 'pending' },

      // Analytics Tests
      { name: 'Occupancy Report', endpoint: '/analytics/occupancy', method: 'GET', status: 'pending' },
      { name: 'Booking Analytics', endpoint: '/analytics/bookings', method: 'GET', status: 'pending' },
      { name: 'Benchmark Report', endpoint: '/analytics/benchmark', method: 'GET', status: 'pending' },
      { name: 'Personalized Report', endpoint: '/analytics/personalized', method: 'GET', status: 'pending' },
    ];

    setResults(tests);

    // Run tests sequentially
    for (const test of tests) {
      try {
        if (test.name === 'Health Check') {
          await runTest(test, () => HotelAPIService.getHealth());
        } else if (test.name === 'WebSocket Status') {
          await runTest(test, () => HotelAPIService.getWebSocketStatus());
        } else if (test.name === 'Get All Rooms') {
          await runTest(test, () => HotelAPIService.getAllRooms());
        } else if (test.name === 'Search Available Rooms') {
          await runTest(test, () => HotelAPIService.searchRooms());
        } else if (test.name === 'Search Rooms by Type') {
          await runTest(test, () => HotelAPIService.searchRooms('suite'));
        } else if (test.name === 'Search Rooms by Price') {
          await runTest(test, () => HotelAPIService.searchRooms(undefined, 200));
        } else if (test.name === 'Get All Guests') {
          await runTest(test, () => HotelAPIService.getAllGuests());
        } else if (test.name === 'Get All Bookings') {
          await runTest(test, () => HotelAPIService.getAllBookings());
        } else if (test.name === 'Get Bookings with Details') {
          await runTest(test, () => HotelAPIService.getBookingsWithDetails());
        } else if (test.name === 'Get All Roles') {
          await runTest(test, () => HotelAPIService.getAllRoles());
        } else if (test.name === 'Get All Permissions') {
          await runTest(test, () => HotelAPIService.getAllPermissions());
        } else if (test.name === 'Get All Users') {
          await runTest(test, () => HotelAPIService.getAllUsers());
        } else if (test.name === 'Occupancy Report') {
          await runTest(test, () => HotelAPIService.getOccupancyReport());
        } else if (test.name === 'Booking Analytics') {
          await runTest(test, () => HotelAPIService.getBookingAnalytics());
        } else if (test.name === 'Benchmark Report') {
          await runTest(test, () => HotelAPIService.getBenchmarkReport());
        } else if (test.name === 'Personalized Report') {
          await runTest(test, () => HotelAPIService.getPersonalizedReport());
        }

        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`Test failed: ${test.name}`, error);
      }
    }

    setTesting(false);
    setCurrentTest('');
  };

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const total = results.length;
  const progress = total > 0 ? ((passed + failed) / total) * 100 : 0;

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
          API Test Suite
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Comprehensive testing of all Hotel Management API endpoints
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Control Panel */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Typography variant="h6">Test Controls</Typography>
                <Box display="flex" gap={2}>
                  <Button
                    variant="contained"
                    startIcon={testing ? <CircularProgress size={20} /> : <PlayIcon />}
                    onClick={runAllTests}
                    disabled={testing}
                  >
                    {testing ? 'Running Tests...' : 'Run All Tests'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={() => setResults([])}
                    disabled={testing}
                  >
                    Clear Results
                  </Button>
                </Box>
              </Box>

              {testing && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    {currentTest || 'Initializing...'}
                  </Typography>
                  <LinearProgress variant="determinate" value={progress} />
                </Box>
              )}

              {results.length > 0 && (
                <Box display="flex" gap={2} mt={2}>
                  <Chip
                    label={`Total: ${total}`}
                    color="default"
                    size="small"
                  />
                  <Chip
                    icon={<CheckIcon />}
                    label={`Passed: ${passed}`}
                    color="success"
                    size="small"
                  />
                  <Chip
                    icon={<ErrorIcon />}
                    label={`Failed: ${failed}`}
                    color="error"
                    size="small"
                  />
                  {total > 0 && (
                    <Chip
                      label={`Pass Rate: ${((passed / total) * 100).toFixed(1)}%`}
                      color={passed / total > 0.8 ? 'success' : 'warning'}
                      size="small"
                    />
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Test Results */}
        <Grid item xs={12}>
          {results.length === 0 ? (
            <Alert severity="info">
              Click "Run All Tests" to start testing all API endpoints
            </Alert>
          ) : (
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Test Results
                </Typography>
                <List>
                  {results.map((result, index) => (
                    <React.Fragment key={result.name}>
                      {index > 0 && <Divider />}
                      <Accordion>
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Box display="flex" alignItems="center" gap={2} width="100%">
                            <ListItemIcon sx={{ minWidth: 40 }}>
                              {result.status === 'running' && <CircularProgress size={24} />}
                              {result.status === 'pass' && <CheckIcon color="success" />}
                              {result.status === 'fail' && <ErrorIcon color="error" />}
                              {result.status === 'pending' && <Box sx={{ width: 24 }} />}
                            </ListItemIcon>
                            <Box flex={1}>
                              <Typography variant="body1" fontWeight={500}>
                                {result.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {result.method} {result.endpoint}
                              </Typography>
                            </Box>
                            {result.duration && (
                              <Chip
                                label={`${result.duration}ms`}
                                size="small"
                                variant="outlined"
                              />
                            )}
                            <Chip
                              label={result.status.toUpperCase()}
                              color={
                                result.status === 'pass' ? 'success' :
                                result.status === 'fail' ? 'error' :
                                result.status === 'running' ? 'info' :
                                'default'
                              }
                              size="small"
                            />
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                          {result.message && (
                            <Alert severity={result.status === 'pass' ? 'success' : 'error'} sx={{ mb: 2 }}>
                              {result.message}
                            </Alert>
                          )}
                          {result.response && (
                            <Box
                              component="pre"
                              sx={{
                                backgroundColor: 'grey.100',
                                p: 2,
                                borderRadius: 1,
                                overflow: 'auto',
                                maxHeight: 400,
                                fontSize: '0.85rem',
                              }}
                            >
                              {result.response.length > 500
                                ? result.response.substring(0, 500) + '\n...(truncated)'
                                : result.response}
                            </Box>
                          )}
                        </AccordionDetails>
                      </Accordion>
                    </React.Fragment>
                  ))}
                </List>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>
    </Box>
  );
};

export default APITestPage;
