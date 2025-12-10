import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  CircularProgress,
  Snackbar,
  Tabs,
  Tab,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CardGiftcard as RewardIcon,
  History as HistoryIcon
} from '@mui/icons-material';
import { HotelAPIService } from '../api';
import { LoyaltyReward, RewardInput, RewardUpdateInput, RewardRedemption } from '../types';

const categories = [
  { value: 'room_upgrade', label: 'Room Upgrade', color: '#1976d2' },
  { value: 'service', label: 'Service', color: '#2e7d32' },
  { value: 'discount', label: 'Discount', color: '#ed6c02' },
  { value: 'gift', label: 'Gift', color: '#9c27b0' },
  { value: 'dining', label: 'Dining', color: '#d32f2f' },
  { value: 'spa', label: 'Spa', color: '#0288d1' },
  { value: 'experience', label: 'Experience', color: '#f57c00' }
];

const tierLevels = [
  { value: 1, label: 'Bronze (Tier 1)' },
  { value: 2, label: 'Silver (Tier 2)' },
  { value: 3, label: 'Gold (Tier 3)' },
  { value: 4, label: 'Platinum (Tier 4)' }
];

const RewardsManagementPage: React.FC = () => {
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [redemptions, setRedemptions] = useState<RewardRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState(0);

  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<LoyaltyReward | null>(null);

  // Form states
  const [formData, setFormData] = useState<RewardInput>({
    name: '',
    description: '',
    category: 'room_upgrade',
    points_cost: 0,
    monetary_value: 0,
    minimum_tier_level: 1,
    stock_quantity: undefined,
    image_url: '',
    terms_conditions: ''
  });

  // Action states
  const [submitting, setSubmitting] = useState(false);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [snackbarSeverity, setSnackbarSeverity] = useState<'success' | 'error'>('success');

  useEffect(() => {
    loadData();
  }, [categoryFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [rewardsData, redemptionsData] = await Promise.all([
        HotelAPIService.getRewards(categoryFilter || undefined),
        HotelAPIService.getRewardRedemptions()
      ]);
      setRewards(rewardsData);
      setRedemptions(redemptionsData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load rewards data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateReward = async () => {
    try {
      setSubmitting(true);
      await HotelAPIService.createReward(formData);
      showSnackbar('Reward created successfully!', 'success');
      setCreateDialogOpen(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create reward', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateReward = async () => {
    if (!selectedReward) return;

    try {
      setSubmitting(true);
      const updateData: RewardUpdateInput = {
        name: formData.name,
        description: formData.description,
        category: formData.category,
        points_cost: formData.points_cost,
        monetary_value: formData.monetary_value,
        minimum_tier_level: formData.minimum_tier_level,
        stock_quantity: formData.stock_quantity,
        image_url: formData.image_url,
        terms_conditions: formData.terms_conditions
      };

      await HotelAPIService.updateReward(selectedReward.id, updateData);
      showSnackbar('Reward updated successfully!', 'success');
      setEditDialogOpen(false);
      setSelectedReward(null);
      resetForm();
      await loadData();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to update reward', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteReward = async () => {
    if (!selectedReward) return;

    try {
      setSubmitting(true);
      await HotelAPIService.deleteReward(selectedReward.id);
      showSnackbar('Reward deleted successfully!', 'success');
      setDeleteDialogOpen(false);
      setSelectedReward(null);
      await loadData();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to delete reward', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditDialog = (reward: LoyaltyReward) => {
    setSelectedReward(reward);
    setFormData({
      name: reward.name,
      description: reward.description || '',
      category: reward.category,
      points_cost: reward.points_cost,
      monetary_value: reward.monetary_value || 0,
      minimum_tier_level: reward.minimum_tier_level,
      stock_quantity: reward.stock_quantity,
      image_url: reward.image_url || '',
      terms_conditions: reward.terms_conditions || ''
    });
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (reward: LoyaltyReward) => {
    setSelectedReward(reward);
    setDeleteDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      category: 'room_upgrade',
      points_cost: 0,
      monetary_value: 0,
      minimum_tier_level: 1,
      stock_quantity: undefined,
      image_url: '',
      terms_conditions: ''
    });
  };

  const showSnackbar = (message: string, severity: 'success' | 'error') => {
    setSnackbarMessage(message);
    setSnackbarSeverity(severity);
    setSnackbarOpen(true);
  };

  const getCategoryColor = (category: string) => {
    const cat = categories.find(c => c.value === category);
    return cat?.color || '#757575';
  };

  const getCategoryLabel = (category: string) => {
    const cat = categories.find(c => c.value === category);
    return cat?.label || category;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const activeRewards = rewards.filter(r => r.is_active);
  const inactiveRewards = rewards.filter(r => !r.is_active);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
            Rewards Management
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Manage loyalty rewards, categories, and redemption history
          </Typography>
        </Box>
        <Box display="flex" gap={2}>
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadData}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            New Reward
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
          <Tab label={`Active Rewards (${activeRewards.length})`} icon={<RewardIcon />} iconPosition="start" />
          <Tab label={`Redemption History (${redemptions.length})`} icon={<HistoryIcon />} iconPosition="start" />
        </Tabs>
      </Box>

      {/* Tab Panels */}
      {tabValue === 0 && (
        <>
          {/* Filter */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box display="flex" gap={2} alignItems="center">
                <TextField
                  select
                  label="Filter by Category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  sx={{ minWidth: 200 }}
                  size="small"
                >
                  <MenuItem value="">All Categories</MenuItem>
                  {categories.map((cat) => (
                    <MenuItem key={cat.value} value={cat.value}>
                      {cat.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="body2" color="text.secondary">
                  {activeRewards.length} active reward(s) | {inactiveRewards.length} inactive
                </Typography>
              </Box>
            </CardContent>
          </Card>

          {/* Rewards Table */}
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell><strong>Reward Name</strong></TableCell>
                  <TableCell><strong>Category</strong></TableCell>
                  <TableCell><strong>Points Cost</strong></TableCell>
                  <TableCell><strong>Value</strong></TableCell>
                  <TableCell><strong>Min Tier</strong></TableCell>
                  <TableCell><strong>Stock</strong></TableCell>
                  <TableCell><strong>Status</strong></TableCell>
                  <TableCell align="right"><strong>Actions</strong></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rewards.map((reward) => (
                  <TableRow key={reward.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {reward.name}
                      </Typography>
                      {reward.description && (
                        <Typography variant="caption" color="text.secondary">
                          {reward.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={getCategoryLabel(reward.category)}
                        size="small"
                        sx={{ backgroundColor: getCategoryColor(reward.category), color: 'white' }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
                        {reward.points_cost.toLocaleString()} pts
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {reward.monetary_value ? `$${reward.monetary_value}` : '-'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`Tier ${reward.minimum_tier_level}`}
                        size="small"
                        variant="outlined"
                        color={reward.minimum_tier_level >= 3 ? 'warning' : 'default'}
                      />
                    </TableCell>
                    <TableCell>
                      {reward.stock_quantity !== null && reward.stock_quantity !== undefined ? (
                        <Typography
                          variant="body2"
                          sx={{
                            color: reward.stock_quantity < 10 ? 'error.main' : 'text.primary',
                            fontWeight: reward.stock_quantity < 10 ? 600 : 400
                          }}
                        >
                          {reward.stock_quantity}
                          {reward.stock_quantity < 10 && ' ⚠️'}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Unlimited
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={reward.is_active ? 'Active' : 'Inactive'}
                        size="small"
                        color={reward.is_active ? 'success' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Edit">
                        <IconButton
                          size="small"
                          onClick={() => openEditDialog(reward)}
                          color="primary"
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          onClick={() => openDeleteDialog(reward)}
                          color="error"
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {rewards.length === 0 && (
            <Box textAlign="center" py={4}>
              <RewardIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No rewards found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create your first reward using the "New Reward" button above
              </Typography>
            </Box>
          )}
        </>
      )}

      {tabValue === 1 && (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                <TableCell><strong>Date</strong></TableCell>
                <TableCell><strong>Guest</strong></TableCell>
                <TableCell><strong>Reward</strong></TableCell>
                <TableCell><strong>Category</strong></TableCell>
                <TableCell><strong>Points Spent</strong></TableCell>
                <TableCell><strong>Status</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {redemptions.map((redemption) => (
                <TableRow key={redemption.id} hover>
                  <TableCell>{formatDate(redemption.redeemed_at)}</TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {redemption.guest_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {redemption.guest_email}
                    </Typography>
                  </TableCell>
                  <TableCell>{redemption.reward_name}</TableCell>
                  <TableCell>
                    <Chip
                      label={getCategoryLabel(redemption.category)}
                      size="small"
                      sx={{ backgroundColor: getCategoryColor(redemption.category), color: 'white' }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600, color: 'error.main' }}>
                    -{redemption.points_spent.toLocaleString()} pts
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={redemption.status}
                      size="small"
                      color="success"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {redemptions.length === 0 && (
            <Box textAlign="center" py={4}>
              <HistoryIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No redemptions yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Redemption history will appear here once guests start redeeming rewards
              </Typography>
            </Box>
          )}
        </TableContainer>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create New Reward</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              label="Reward Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <TextField
              fullWidth
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              multiline
              rows={2}
            />
            <Box display="flex" gap={2}>
              <TextField
                select
                fullWidth
                label="Category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                required
              >
                {categories.map((cat) => (
                  <MenuItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                label="Minimum Tier Level"
                value={formData.minimum_tier_level}
                onChange={(e) => setFormData({ ...formData, minimum_tier_level: Number(e.target.value) })}
                required
              >
                {tierLevels.map((tier) => (
                  <MenuItem key={tier.value} value={tier.value}>
                    {tier.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box display="flex" gap={2}>
              <TextField
                fullWidth
                label="Points Cost"
                type="number"
                value={formData.points_cost}
                onChange={(e) => setFormData({ ...formData, points_cost: Number(e.target.value) })}
                required
                inputProps={{ min: 1 }}
              />
              <TextField
                fullWidth
                label="Monetary Value ($)"
                type="number"
                value={formData.monetary_value}
                onChange={(e) => setFormData({ ...formData, monetary_value: Number(e.target.value) })}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                fullWidth
                label="Stock Quantity"
                type="number"
                value={formData.stock_quantity || ''}
                onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Unlimited"
                inputProps={{ min: 0 }}
              />
            </Box>
            <TextField
              fullWidth
              label="Image URL (optional)"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
            />
            <TextField
              fullWidth
              label="Terms & Conditions"
              value={formData.terms_conditions}
              onChange={(e) => setFormData({ ...formData, terms_conditions: e.target.value })}
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateDialogOpen(false); resetForm(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleCreateReward}
            variant="contained"
            disabled={submitting || !formData.name || formData.points_cost <= 0}
          >
            {submitting ? 'Creating...' : 'Create Reward'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Edit Reward</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              label="Reward Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <TextField
              fullWidth
              label="Description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              multiline
              rows={2}
            />
            <Box display="flex" gap={2}>
              <TextField
                select
                fullWidth
                label="Category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                required
              >
                {categories.map((cat) => (
                  <MenuItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                fullWidth
                label="Minimum Tier Level"
                value={formData.minimum_tier_level}
                onChange={(e) => setFormData({ ...formData, minimum_tier_level: Number(e.target.value) })}
                required
              >
                {tierLevels.map((tier) => (
                  <MenuItem key={tier.value} value={tier.value}>
                    {tier.label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box display="flex" gap={2}>
              <TextField
                fullWidth
                label="Points Cost"
                type="number"
                value={formData.points_cost}
                onChange={(e) => setFormData({ ...formData, points_cost: Number(e.target.value) })}
                required
                inputProps={{ min: 1 }}
              />
              <TextField
                fullWidth
                label="Monetary Value ($)"
                type="number"
                value={formData.monetary_value}
                onChange={(e) => setFormData({ ...formData, monetary_value: Number(e.target.value) })}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                fullWidth
                label="Stock Quantity"
                type="number"
                value={formData.stock_quantity || ''}
                onChange={(e) => setFormData({ ...formData, stock_quantity: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Unlimited"
                inputProps={{ min: 0 }}
              />
            </Box>
            <TextField
              fullWidth
              label="Image URL (optional)"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
            />
            <TextField
              fullWidth
              label="Terms & Conditions"
              value={formData.terms_conditions}
              onChange={(e) => setFormData({ ...formData, terms_conditions: e.target.value })}
              multiline
              rows={3}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setEditDialogOpen(false); setSelectedReward(null); resetForm(); }}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdateReward}
            variant="contained"
            disabled={submitting || !formData.name || formData.points_cost <= 0}
          >
            {submitting ? 'Updating...' : 'Update Reward'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Reward</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{selectedReward?.name}"? This action will soft-delete the reward (mark as inactive).
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteDialogOpen(false); setSelectedReward(null); }}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteReward}
            color="error"
            variant="contained"
            disabled={submitting}
          >
            {submitting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
      >
        <Alert onClose={() => setSnackbarOpen(false)} severity={snackbarSeverity}>
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default RewardsManagementPage;
