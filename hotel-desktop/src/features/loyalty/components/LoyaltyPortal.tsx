import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  LinearProgress,
  Alert,
  AlertTitle,
  CircularProgress,
  Tabs,
  Tab,
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  People as PeopleIcon,
  Stars as StarsIcon,
  AccountBalance as AccountBalanceIcon,
  EmojiEvents as TrophyIcon,
  Timeline as TimelineIcon,
} from '@mui/icons-material';
import { HotelAPIService, APIError } from '../../../api';
import { LoyaltyStatistics } from '../../../types';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MembershipPointsScanner from '../../guests/components/MembershipPointsScanner';

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
      id={`loyalty-tabpanel-${index}`}
      aria-labelledby={`loyalty-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

const TIER_COLORS: Record<string, string> = {
  '1': '#CD7F32', // Bronze
  '2': '#C0C0C0', // Silver
  '3': '#FFD700', // Gold
  '4': '#E5E4E2', // Platinum
};

const TIER_NAMES: Record<number, string> = {
  1: 'Bronze',
  2: 'Silver',
  3: 'Gold',
  4: 'Platinum',
};

const LoyaltyPortal: React.FC = () => {
  const [statistics, setStatistics] = useState<LoyaltyStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    loadStatistics();
  }, []);

  const loadStatistics = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await HotelAPIService.getLoyaltyStatistics();
      setStatistics(data);
    } catch (err) {
      if (err instanceof APIError) {
        setError(err.message);
      } else {
        setError('Failed to load loyalty statistics');
      }
      console.error('Error loading loyalty statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const formatNumber = (num: number): string => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getTierColor = (tierLevel: number): string => {
    return TIER_COLORS[tierLevel.toString()] || '#666';
  };

  const getTierName = (tierLevel: number): string => {
    return TIER_NAMES[tierLevel] || `Tier ${tierLevel}`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        <AlertTitle>Error</AlertTitle>
        {error}
      </Alert>
    );
  }

  if (!statistics) {
    return (
      <Alert severity="info">
        <AlertTitle>No Data</AlertTitle>
        No loyalty statistics available at this time.
      </Alert>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'primary.main' }}>
            Customer Loyalty Portal
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Comprehensive insights into your loyalty program performance
          </Typography>
        </Box>
        <MembershipPointsScanner onSuccess={loadStatistics} />
      </Box>

      {/* Overview Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PeopleIcon sx={{ fontSize: 40, color: 'white', mr: 2 }} />
                <Box>
                  <Typography variant="h4" sx={{ color: 'white', fontWeight: 700 }}>
                    {formatNumber(statistics.total_members)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                    Total Members
                  </Typography>
                </Box>
              </Box>
              <LinearProgress
                variant="determinate"
                value={(statistics.active_members / statistics.total_members) * 100}
                sx={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: 'rgba(255,255,255,0.3)',
                  '& .MuiLinearProgress-bar': { backgroundColor: 'white' }
                }}
              />
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', mt: 1 }}>
                {statistics.active_members} active ({Math.round((statistics.active_members / statistics.total_members) * 100)}%)
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <StarsIcon sx={{ fontSize: 40, color: 'white', mr: 2 }} />
                <Box>
                  <Typography variant="h4" sx={{ color: 'white', fontWeight: 700 }}>
                    {formatNumber(statistics.total_points_active)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                    Active Points
                  </Typography>
                </Box>
              </Box>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                Avg: {formatNumber(Math.round(statistics.average_points_per_member))} per member
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TrendingUpIcon sx={{ fontSize: 40, color: 'white', mr: 2 }} />
                <Box>
                  <Typography variant="h4" sx={{ color: 'white', fontWeight: 700 }}>
                    {formatNumber(statistics.total_points_issued)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                    Points Issued
                  </Typography>
                </Box>
              </Box>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                Lifetime total earned
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={3}>
          <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <AccountBalanceIcon sx={{ fontSize: 40, color: 'white', mr: 2 }} />
                <Box>
                  <Typography variant="h4" sx={{ color: 'white', fontWeight: 700 }}>
                    {formatNumber(statistics.total_points_redeemed)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                    Points Redeemed
                  </Typography>
                </Box>
              </Box>
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)' }}>
                {Math.round((statistics.total_points_redeemed / statistics.total_points_issued) * 100)}% redemption rate
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Tabs */}
      <Card sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab label="Tier Distribution" icon={<TrophyIcon />} iconPosition="start" />
          <Tab label="Top Members" icon={<StarsIcon />} iconPosition="start" />
          <Tab label="Recent Activity" icon={<TimelineIcon />} iconPosition="start" />
          <Tab label="Growth Trends" icon={<TrendingUpIcon />} iconPosition="start" />
        </Tabs>
      </Card>

      {/* Tab Panels */}
      <TabPanel value={activeTab} index={0}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  Members by Tier
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statistics.members_by_tier}
                      dataKey="count"
                      nameKey="tier_name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ tier_name, percentage }) => `${tier_name}: ${percentage.toFixed(1)}%`}
                    >
                      {statistics.members_by_tier.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getTierColor(entry.tier_level)} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  Tier Breakdown
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={statistics.members_by_tier}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="tier_name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" name="Members">
                      {statistics.members_by_tier.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getTierColor(entry.tier_level)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  Tier Statistics
                </Typography>
                <TableContainer>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Tier</TableCell>
                        <TableCell align="right">Members</TableCell>
                        <TableCell align="right">Percentage</TableCell>
                        <TableCell align="right">Progress</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {statistics.members_by_tier.map((tier) => (
                        <TableRow key={tier.tier_level}>
                          <TableCell>
                            <Chip
                              label={tier.tier_name}
                              size="small"
                              sx={{
                                backgroundColor: getTierColor(tier.tier_level),
                                color: 'white',
                                fontWeight: 600,
                              }}
                            />
                          </TableCell>
                          <TableCell align="right">{formatNumber(tier.count)}</TableCell>
                          <TableCell align="right">{tier.percentage.toFixed(1)}%</TableCell>
                          <TableCell align="right">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <LinearProgress
                                variant="determinate"
                                value={tier.percentage}
                                sx={{
                                  flexGrow: 1,
                                  height: 8,
                                  borderRadius: 4,
                                  backgroundColor: 'rgba(0,0,0,0.1)',
                                  '& .MuiLinearProgress-bar': {
                                    backgroundColor: getTierColor(tier.tier_level),
                                  }
                                }}
                              />
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      <TabPanel value={activeTab} index={1}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Top Loyalty Members
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Our most valued customers with the highest loyalty points
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Rank</TableCell>
                    <TableCell>Guest Name</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Tier</TableCell>
                    <TableCell align="right">Points Balance</TableCell>
                    <TableCell align="right">Lifetime Points</TableCell>
                    <TableCell>Membership #</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {statistics.top_members.map((member, index) => (
                    <TableRow key={member.membership_number} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          {index < 3 && (
                            <TrophyIcon
                              sx={{
                                mr: 1,
                                color: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : '#CD7F32',
                              }}
                            />
                          )}
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            #{index + 1}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {member.guest_name}
                        </Typography>
                      </TableCell>
                      <TableCell>{member.guest_email}</TableCell>
                      <TableCell>
                        <Chip
                          label={getTierName(member.tier_level)}
                          size="small"
                          sx={{
                            backgroundColor: getTierColor(member.tier_level),
                            color: 'white',
                            fontWeight: 600,
                          }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
                          {formatNumber(member.points_balance)}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{formatNumber(member.lifetime_points)}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {member.membership_number}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={activeTab} index={2}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
              Recent Points Transactions
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Latest loyalty points activity across all members
            </Typography>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Date</TableCell>
                    <TableCell>Guest</TableCell>
                    <TableCell>Transaction Type</TableCell>
                    <TableCell align="right">Points</TableCell>
                    <TableCell>Description</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {statistics.recent_transactions.map((transaction) => (
                    <TableRow key={transaction.id} hover>
                      <TableCell>{formatDate(transaction.created_at)}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {transaction.guest_name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={transaction.transaction_type.toUpperCase()}
                          size="small"
                          color={
                            transaction.transaction_type === 'earn'
                              ? 'success'
                              : transaction.transaction_type === 'redeem'
                              ? 'warning'
                              : transaction.transaction_type === 'expire'
                              ? 'error'
                              : 'default'
                          }
                          sx={{ fontWeight: 600 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 600,
                            color:
                              transaction.transaction_type === 'earn'
                                ? 'success.main'
                                : transaction.transaction_type === 'redeem'
                                ? 'warning.main'
                                : 'error.main',
                          }}
                        >
                          {transaction.transaction_type === 'earn' ? '+' : '-'}
                          {formatNumber(Math.abs(transaction.points_amount))}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {transaction.description || 'No description'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </TabPanel>

      <TabPanel value={activeTab} index={3}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  Membership Growth
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  New member enrollments and total membership over time
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={statistics.membership_growth}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="new_members"
                      name="New Members"
                      stroke="#4facfe"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_members"
                      name="Total Members"
                      stroke="#667eea"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  Points Activity Trends
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Points earned vs redeemed over time
                </Typography>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={statistics.points_activity}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="points_earned" name="Points Earned" fill="#4facfe" />
                    <Bar dataKey="points_redeemed" name="Points Redeemed" fill="#fa709a" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>
    </Box>
  );
};

export default LoyaltyPortal;
