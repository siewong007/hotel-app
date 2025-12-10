import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  LinearProgress,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Avatar,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Divider,
  IconButton,
  Tooltip,
  Badge,
} from '@mui/material';
import {
  EmojiEvents as TrophyIcon,
  Stars as StarsIcon,
  CardGiftcard as GiftIcon,
  History as HistoryIcon,
  TrendingUp as TrendingUpIcon,
  Info as InfoIcon,
  LocalHotel as HotelIcon,
  Restaurant as RestaurantIcon,
  Spa as SpaIcon,
  LocalOffer as OfferIcon,
  AttachMoney as MoneyIcon,
  CheckCircle as CheckCircleIcon,
  Lock as LockIcon,
  Redeem as RedeemIcon,
} from '@mui/icons-material';
import { HotelAPIService } from '../api';

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

// Tier configurations
const TIER_CONFIG: Record<number, {
  name: string;
  color: string;
  gradient: string;
  icon: string;
  bgColor: string;
}> = {
  1: {
    name: 'Bronze',
    color: '#CD7F32',
    gradient: 'linear-gradient(135deg, #CD7F32 0%, #B87333 100%)',
    icon: '🥉',
    bgColor: 'rgba(205, 127, 50, 0.1)',
  },
  2: {
    name: 'Silver',
    color: '#C0C0C0',
    gradient: 'linear-gradient(135deg, #C0C0C0 0%, #A8A8A8 100%)',
    icon: '🥈',
    bgColor: 'rgba(192, 192, 192, 0.1)',
  },
  3: {
    name: 'Gold',
    color: '#FFD700',
    gradient: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
    icon: '🥇',
    bgColor: 'rgba(255, 215, 0, 0.1)',
  },
  4: {
    name: 'Platinum',
    color: '#E5E4E2',
    gradient: 'linear-gradient(135deg, #E5E4E2 0%, #B9B9B9 100%)',
    icon: '💎',
    bgColor: 'rgba(229, 228, 226, 0.1)',
  },
};

const CATEGORY_ICONS: Record<string, React.ReactElement> = {
  room_upgrade: <HotelIcon />,
  service: <GiftIcon />,
  discount: <MoneyIcon />,
  dining: <RestaurantIcon />,
  spa: <SpaIcon />,
  gift: <GiftIcon />,
  experience: <TrophyIcon />,
};

interface UserLoyaltyMembership {
  id: number;
  membership_number: string;
  points_balance: number;
  lifetime_points: number;
  tier_level: number;
  tier_name: string;
  status: string;
  enrolled_date: string;
  next_tier?: {
    tier_level: number;
    tier_name: string;
    minimum_points: number;
    points_multiplier: number;
  };
  current_tier_benefits: string[];
  points_to_next_tier?: number;
  recent_transactions: Array<{
    id: string;
    transaction_type: string;
    points_amount: number;
    balance_after: number;
    description?: string;
    created_at: string;
  }>;
}

interface LoyaltyReward {
  id: number;
  name: string;
  description?: string;
  category: string;
  points_cost: number;
  monetary_value?: number;
  minimum_tier_level: number;
  stock_quantity?: number;
  image_url?: string;
  terms_conditions?: string;
}

const LoyaltyDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [membership, setMembership] = useState<UserLoyaltyMembership | null>(null);
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [selectedReward, setSelectedReward] = useState<LoyaltyReward | null>(null);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [redeemNotes, setRedeemNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  useEffect(() => {
    loadLoyaltyData();
  }, []);

  const loadLoyaltyData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load membership and rewards in parallel
      const [membershipData, rewardsData] = await Promise.all([
        HotelAPIService.getUserLoyaltyMembership(),
        HotelAPIService.getLoyaltyRewards(),
      ]);

      setMembership(membershipData);
      setRewards(rewardsData);
    } catch (err: any) {
      console.error('Failed to load loyalty data:', err);
      setError(err.message || 'Failed to load loyalty information');
    } finally {
      setLoading(false);
    }
  };

  const handleRedeemClick = (reward: LoyaltyReward) => {
    setSelectedReward(reward);
    setRedeemDialogOpen(true);
    setRedeemNotes('');
  };

  const handleRedeemConfirm = async () => {
    if (!selectedReward || !membership) return;

    try {
      setLoading(true);
      await HotelAPIService.redeemReward({
        reward_id: selectedReward.id,
        notes: redeemNotes || undefined,
      });

      setSuccessMessage(`Successfully redeemed: ${selectedReward.name}`);
      setRedeemDialogOpen(false);
      setSelectedReward(null);
      setRedeemNotes('');

      // Reload data
      await loadLoyaltyData();
    } catch (err: any) {
      setError(err.message || 'Failed to redeem reward');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const getTierConfig = (tierLevel: number) => {
    return TIER_CONFIG[tierLevel] || TIER_CONFIG[1];
  };

  const getTierProgress = () => {
    if (!membership || !membership.next_tier) return 100;

    const currentPoints = membership.lifetime_points;
    const nextTierPoints = membership.next_tier.minimum_points;
    const currentTierMin = membership.tier_level === 1 ? 0 :
      (membership.tier_level === 2 ? 1000 :
       membership.tier_level === 3 ? 5000 : 10000);

    const progress = ((currentPoints - currentTierMin) / (nextTierPoints - currentTierMin)) * 100;
    return Math.min(Math.max(progress, 0), 100);
  };

  const filteredRewards = filterCategory === 'all'
    ? rewards
    : rewards.filter(r => r.category === filterCategory);

  const categories = Array.from(new Set(rewards.map(r => r.category)));

  if (loading && !membership) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress size={60} />
      </Box>
    );
  }

  if (error && !membership) {
    return (
      <Alert severity="error" sx={{ m: 3 }}>
        {error}
      </Alert>
    );
  }

  if (!membership) {
    return (
      <Alert severity="info" sx={{ m: 3 }}>
        No loyalty membership found. Contact support to enroll in our loyalty programme.
      </Alert>
    );
  }

  const tierConfig = getTierConfig(membership.tier_level);
  const tierProgress = getTierProgress();

  return (
    <Box>
      {/* Success/Error Messages */}
      {successMessage && (
        <Alert severity="success" onClose={() => setSuccessMessage(null)} sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 700, color: 'primary.main' }}>
          Loyalty Rewards
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Earn points with every stay and unlock exclusive rewards
        </Typography>
      </Box>

      {/* Tier Status Card */}
      <Card
        sx={{
          mb: 3,
          background: tierConfig.gradient,
          color: 'white',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: -50,
            right: -50,
            fontSize: '200px',
            opacity: 0.1,
          }}
        >
          {tierConfig.icon}
        </Box>
        <CardContent sx={{ position: 'relative', zIndex: 1 }}>
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} md={4}>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <Avatar
                  sx={{
                    width: 80,
                    height: 80,
                    bgcolor: 'rgba(255,255,255,0.2)',
                    fontSize: '3rem',
                    mr: 2,
                  }}
                >
                  {tierConfig.icon}
                </Avatar>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {tierConfig.name} Member
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Member since {formatDate(membership.enrolled_date)}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    #{membership.membership_number}
                  </Typography>
                </Box>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
                  {formatNumber(membership.points_balance)}
                </Typography>
                <Typography variant="body1" sx={{ opacity: 0.9 }}>
                  Available Points
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  {formatNumber(membership.lifetime_points)} lifetime points earned
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              {membership.next_tier ? (
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="body2">
                      Progress to {membership.next_tier.tier_name}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {Math.round(tierProgress)}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={tierProgress}
                    sx={{
                      height: 10,
                      borderRadius: 5,
                      bgcolor: 'rgba(255,255,255,0.3)',
                      '& .MuiLinearProgress-bar': {
                        bgcolor: 'white',
                        borderRadius: 5,
                      },
                    }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.8, mt: 1, display: 'block' }}>
                    {formatNumber(membership.points_to_next_tier || 0)} more points needed
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ textAlign: 'center' }}>
                  <TrophyIcon sx={{ fontSize: 48, mb: 1 }} />
                  <Typography variant="body1">
                    You've reached the highest tier!
                  </Typography>
                </Box>
              )}
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Card sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(e, v) => setActiveTab(v)}
          variant="fullWidth"
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Tab icon={<GiftIcon />} label="Rewards Catalog" iconPosition="start" />
          <Tab icon={<TrophyIcon />} label="My Benefits" iconPosition="start" />
          <Tab icon={<HistoryIcon />} label="Points History" iconPosition="start" />
        </Tabs>
      </Card>

      {/* Rewards Catalog Tab */}
      <TabPanel value={activeTab} index={0}>
        {/* Category Filter */}
        <Box sx={{ mb: 3, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            label="All Rewards"
            onClick={() => setFilterCategory('all')}
            color={filterCategory === 'all' ? 'primary' : 'default'}
            sx={{ fontWeight: filterCategory === 'all' ? 600 : 400 }}
          />
          {categories.map((category) => (
            <Chip
              key={category}
              icon={CATEGORY_ICONS[category]}
              label={category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
              onClick={() => setFilterCategory(category)}
              color={filterCategory === category ? 'primary' : 'default'}
              sx={{ fontWeight: filterCategory === category ? 600 : 400 }}
            />
          ))}
        </Box>

        {/* Rewards Grid */}
        <Grid container spacing={3}>
          {filteredRewards.map((reward) => {
            const canRedeem = membership.points_balance >= reward.points_cost &&
                            membership.tier_level >= reward.minimum_tier_level;
            const isLocked = membership.tier_level < reward.minimum_tier_level;

            return (
              <Grid item xs={12} sm={6} md={4} key={reward.id}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    transition: 'all 0.3s ease',
                    opacity: isLocked ? 0.6 : 1,
                    '&:hover': {
                      transform: isLocked ? 'none' : 'translateY(-4px)',
                      boxShadow: isLocked ? undefined : 6,
                    },
                  }}
                >
                  {isLocked && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        zIndex: 1,
                      }}
                    >
                      <Tooltip title={`Requires ${getTierConfig(reward.minimum_tier_level).name} tier`}>
                        <Chip
                          icon={<LockIcon />}
                          label={getTierConfig(reward.minimum_tier_level).name}
                          size="small"
                          sx={{
                            bgcolor: 'rgba(0,0,0,0.7)',
                            color: 'white',
                          }}
                        />
                      </Tooltip>
                    </Box>
                  )}

                  {reward.stock_quantity !== null && reward.stock_quantity !== undefined && (
                    <Box
                      sx={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        zIndex: 1,
                      }}
                    >
                      <Chip
                        label={`${reward.stock_quantity} left`}
                        size="small"
                        color={reward.stock_quantity < 10 ? 'error' : 'default'}
                        sx={{ fontWeight: 600 }}
                      />
                    </Box>
                  )}

                  <Box
                    sx={{
                      height: 200,
                      background: reward.image_url
                        ? `url(${reward.image_url})`
                        : `linear-gradient(135deg, ${getTierConfig(reward.minimum_tier_level).color} 0%, ${getTierConfig(reward.minimum_tier_level).color}80 100%)`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {!reward.image_url && (
                      <Box sx={{ fontSize: '5rem', opacity: 0.3 }}>
                        {CATEGORY_ICONS[reward.category] || <GiftIcon sx={{ fontSize: 80 }} />}
                      </Box>
                    )}
                  </Box>

                  <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                        {reward.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {reward.description}
                      </Typography>
                    </Box>

                    <Box sx={{ mt: 'auto' }}>
                      <Divider sx={{ mb: 2 }} />
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <StarsIcon sx={{ color: 'warning.main', fontSize: 20 }} />
                          <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            {formatNumber(reward.points_cost)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            points
                          </Typography>
                        </Box>
                        {reward.monetary_value && (
                          <Typography variant="caption" color="text.secondary">
                            Value: ${reward.monetary_value}
                          </Typography>
                        )}
                      </Box>

                      <Button
                        fullWidth
                        variant={canRedeem ? 'contained' : 'outlined'}
                        disabled={!canRedeem || loading}
                        onClick={() => handleRedeemClick(reward)}
                        startIcon={isLocked ? <LockIcon /> : <RedeemIcon />}
                      >
                        {isLocked
                          ? 'Tier Locked'
                          : !canRedeem
                          ? 'Insufficient Points'
                          : 'Redeem Now'}
                      </Button>

                      {reward.terms_conditions && (
                        <Tooltip title={reward.terms_conditions}>
                          <IconButton size="small" sx={{ mt: 1 }}>
                            <InfoIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>

        {filteredRewards.length === 0 && (
          <Alert severity="info">
            No rewards available in this category.
          </Alert>
        )}
      </TabPanel>

      {/* Benefits Tab */}
      <TabPanel value={activeTab} index={1}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TrophyIcon color="primary" />
                  Current Tier Benefits
                </Typography>
                <List>
                  {membership.current_tier_benefits.map((benefit, index) => (
                    <ListItem key={index}>
                      <ListItemAvatar>
                        <Avatar sx={{ bgcolor: tierConfig.bgColor, color: tierConfig.color }}>
                          <CheckCircleIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText primary={benefit} />
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          </Grid>

          {membership.next_tier && (
            <Grid item xs={12} md={6}>
              <Card sx={{ border: 2, borderColor: 'primary.main' }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TrendingUpIcon color="primary" />
                    Unlock at {membership.next_tier.tier_name}
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <LinearProgress
                      variant="determinate"
                      value={tierProgress}
                      sx={{ height: 8, borderRadius: 4, mb: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {formatNumber(membership.points_to_next_tier || 0)} points away
                    </Typography>
                  </Box>
                  <Alert severity="info" icon={<TrophyIcon />}>
                    Earn <strong>{membership.next_tier.points_multiplier}x</strong> points on all stays at {membership.next_tier.tier_name} level!
                  </Alert>
                </CardContent>
              </Card>
            </Grid>
          )}

          {/* Tier Comparison */}
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
                  Tier Comparison
                </Typography>
                <Grid container spacing={2}>
                  {[1, 2, 3, 4].map((tier) => {
                    const config = getTierConfig(tier);
                    const isCurrent = tier === membership.tier_level;
                    const isLocked = tier > membership.tier_level;

                    return (
                      <Grid item xs={12} sm={6} md={3} key={tier}>
                        <Card
                          sx={{
                            background: isCurrent ? config.gradient : undefined,
                            color: isCurrent ? 'white' : undefined,
                            border: isCurrent ? 3 : 1,
                            borderColor: isCurrent ? config.color : 'divider',
                            opacity: isLocked ? 0.7 : 1,
                          }}
                        >
                          <CardContent>
                            <Box sx={{ textAlign: 'center' }}>
                              <Typography variant="h2">{config.icon}</Typography>
                              <Typography variant="h6" sx={{ fontWeight: 600, mt: 1 }}>
                                {config.name}
                              </Typography>
                              {isCurrent && (
                                <Chip
                                  label="Current"
                                  size="small"
                                  sx={{ mt: 1, bgcolor: 'rgba(255,255,255,0.3)', color: 'white' }}
                                />
                              )}
                              {isLocked && (
                                <Chip
                                  icon={<LockIcon />}
                                  label="Locked"
                                  size="small"
                                  sx={{ mt: 1 }}
                                />
                              )}
                            </Box>
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </TabPanel>

      {/* Points History Tab */}
      <TabPanel value={activeTab} index={2}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, mb: 3 }}>
              Recent Transactions
            </Typography>
            <List>
              {membership.recent_transactions.map((transaction, index) => {
                const isEarn = transaction.transaction_type === 'earn';
                const isRedeem = transaction.transaction_type === 'redeem';

                return (
                  <React.Fragment key={transaction.id}>
                    {index > 0 && <Divider />}
                    <ListItem>
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            bgcolor: isEarn ? 'success.light' : isRedeem ? 'error.light' : 'grey.300',
                            color: isEarn ? 'success.dark' : isRedeem ? 'error.dark' : 'grey.700',
                          }}
                        >
                          {isEarn ? <TrendingUpIcon /> : <RedeemIcon />}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="body1">
                              {transaction.description || transaction.transaction_type}
                            </Typography>
                            <Typography
                              variant="h6"
                              sx={{
                                color: isEarn ? 'success.main' : 'error.main',
                                fontWeight: 600,
                              }}
                            >
                              {isEarn ? '+' : ''}{formatNumber(transaction.points_amount)}
                            </Typography>
                          </Box>
                        }
                        secondary={
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(transaction.created_at)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Balance: {formatNumber(transaction.balance_after)}
                            </Typography>
                          </Box>
                        }
                      />
                    </ListItem>
                  </React.Fragment>
                );
              })}
            </List>

            {membership.recent_transactions.length === 0 && (
              <Alert severity="info">
                No transactions yet. Start earning points with your first booking!
              </Alert>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* Redeem Dialog */}
      <Dialog
        open={redeemDialogOpen}
        onClose={() => setRedeemDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Confirm Reward Redemption
        </DialogTitle>
        <DialogContent>
          {selectedReward && (
            <Box>
              <Typography variant="h6" gutterBottom>
                {selectedReward.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                {selectedReward.description}
              </Typography>

              <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 2, mb: 2 }}>
                <Typography variant="body2" gutterBottom>
                  Points to be deducted:
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
                  {formatNumber(selectedReward.points_cost)} points
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  New balance: {formatNumber((membership?.points_balance || 0) - selectedReward.points_cost)} points
                </Typography>
              </Box>

              <TextField
                fullWidth
                label="Notes (optional)"
                multiline
                rows={3}
                value={redeemNotes}
                onChange={(e) => setRedeemNotes(e.target.value)}
                placeholder="Add any special requests or notes..."
                sx={{ mb: 2 }}
              />

              {selectedReward.terms_conditions && (
                <Alert severity="info" icon={<InfoIcon />}>
                  <Typography variant="caption">
                    <strong>Terms & Conditions:</strong> {selectedReward.terms_conditions}
                  </Typography>
                </Alert>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRedeemDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleRedeemConfirm}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <RedeemIcon />}
          >
            Confirm Redemption
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default LoyaltyDashboard;
