import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Card,
  CardContent,
  Chip,
  Button,
  TextField,
  MenuItem,
  CircularProgress,
  IconButton,
  Grid,
  FormControl,
  InputLabel,
  Select,
  InputAdornment,
  Collapse,
  TablePagination,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  Download as DownloadIcon,
  PictureAsPdf as PdfIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Person as PersonIcon,
  Computer as SystemIcon,
} from '@mui/icons-material';
import { AuditService } from '../../../api';
import {
  AuditLogEntry,
  AuditLogQuery,
  AuditUser,
  getActionLabel,
  getResourceLabel,
} from '../../../types/audit.types';

const AuditLogPage: React.FC = () => {
  // Data state
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Filter state
  const [actions, setActions] = useState<string[]>([]);
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Query state
  const [query, setQuery] = useState<AuditLogQuery>({
    page: 1,
    page_size: 25,
    sort_by: 'created_at',
    sort_order: 'desc',
  });
  const [searchInput, setSearchInput] = useState('');

  // Expanded rows
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Fetch audit logs
  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true);
      const response = await AuditService.getAuditLogs(query);
      setLogs(response.data);
      setTotal(response.total);
    } catch (error) {
      console.error('Failed to fetch audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Fetch filter options
  const fetchFilterOptions = useCallback(async () => {
    try {
      const [actionsRes, resourceTypesRes, usersRes] = await Promise.all([
        AuditService.getAuditActions(),
        AuditService.getAuditResourceTypes(),
        AuditService.getAuditUsers(),
      ]);
      setActions(actionsRes);
      setResourceTypes(resourceTypesRes);
      setUsers(usersRes);
    } catch (error) {
      console.error('Failed to fetch filter options:', error);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  // Handle search with debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== (query.search || '')) {
        setQuery((prev) => ({ ...prev, search: searchInput || undefined, page: 1 }));
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchInput, query.search]);

  // Handle filter changes
  const handleFilterChange = (field: keyof AuditLogQuery, value: any) => {
    setQuery((prev) => ({
      ...prev,
      [field]: value || undefined,
      page: 1, // Reset to first page when filter changes
    }));
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchInput('');
    setQuery({
      page: 1,
      page_size: 25,
      sort_by: 'created_at',
      sort_order: 'desc',
    });
  };

  // Handle page change
  const handlePageChange = (_: unknown, newPage: number) => {
    setQuery((prev) => ({ ...prev, page: newPage + 1 }));
  };

  // Handle rows per page change
  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery((prev) => ({
      ...prev,
      page_size: parseInt(event.target.value, 10),
      page: 1,
    }));
  };

  // Toggle row expansion
  const toggleRowExpansion = (id: number) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Export functions
  const handleExportCSV = async () => {
    try {
      setExporting(true);
      await AuditService.downloadCSV(query);
    } catch (error) {
      console.error('Failed to export CSV:', error);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setExporting(true);
      await AuditService.downloadPDF(query);
    } catch (error) {
      console.error('Failed to export PDF:', error);
    } finally {
      setExporting(false);
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // Check if any filters are active
  const hasActiveFilters = !!(
    query.action ||
    query.resource_type ||
    query.user_id ||
    query.start_date ||
    query.end_date ||
    query.search
  );

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Audit Log</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleExportCSV}
            disabled={exporting || loading}
          >
            Export CSV
          </Button>
          <Button
            variant="outlined"
            startIcon={<PdfIcon />}
            onClick={handleExportPDF}
            disabled={exporting || loading}
          >
            Export PDF
          </Button>
          <IconButton onClick={fetchLogs} disabled={loading}>
            <RefreshIcon />
          </IconButton>
        </Box>
      </Box>

      {/* Search and Filter Toggle */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              placeholder="Search logs..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              size="small"
              sx={{ flexGrow: 1 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
            <Button
              variant={showFilters ? 'contained' : 'outlined'}
              startIcon={<FilterIcon />}
              onClick={() => setShowFilters(!showFilters)}
            >
              Filters {hasActiveFilters && `(${Object.values(query).filter(Boolean).length - 4})`}
            </Button>
            {hasActiveFilters && (
              <Button variant="text" startIcon={<ClearIcon />} onClick={clearFilters}>
                Clear
              </Button>
            )}
          </Box>

          {/* Expandable Filters */}
          <Collapse in={showFilters}>
            <Grid container spacing={2} sx={{ mt: 2 }}>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Action</InputLabel>
                  <Select
                    value={query.action || ''}
                    label="Action"
                    onChange={(e) => handleFilterChange('action', e.target.value)}
                  >
                    <MenuItem value="">All Actions</MenuItem>
                    {actions.map((action) => (
                      <MenuItem key={action} value={action}>
                        {getActionLabel(action).label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>Resource Type</InputLabel>
                  <Select
                    value={query.resource_type || ''}
                    label="Resource Type"
                    onChange={(e) => handleFilterChange('resource_type', e.target.value)}
                  >
                    <MenuItem value="">All Resources</MenuItem>
                    {resourceTypes.map((type) => (
                      <MenuItem key={type} value={type}>
                        {getResourceLabel(type).label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>User</InputLabel>
                  <Select
                    value={query.user_id?.toString() || ''}
                    label="User"
                    onChange={(e) =>
                      handleFilterChange('user_id', e.target.value ? parseInt(e.target.value) : undefined)
                    }
                  >
                    <MenuItem value="">All Users</MenuItem>
                    {users.map((user) => (
                      <MenuItem key={user.id} value={user.id.toString()}>
                        {user.username}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Start Date"
                  value={query.start_date || ''}
                  onChange={(e) => handleFilterChange('start_date', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="End Date"
                  value={query.end_date || ''}
                  onChange={(e) => handleFilterChange('end_date', e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
            </Grid>
          </Collapse>
        </CardContent>
      </Card>

      {/* Results Table */}
      <TableContainer component={Paper}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
            <CircularProgress />
          </Box>
        ) : logs.length === 0 ? (
          <Box sx={{ textAlign: 'center', p: 4 }}>
            <Typography color="textSecondary">No audit logs found</Typography>
          </Box>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={40}></TableCell>
                  <TableCell>Timestamp</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Action</TableCell>
                  <TableCell>Resource</TableCell>
                  <TableCell>IP Address</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => {
                  const isExpanded = expandedRows.has(log.id);
                  const actionInfo = getActionLabel(log.action);
                  const resourceInfo = getResourceLabel(log.resource_type);

                  return (
                    <React.Fragment key={log.id}>
                      <TableRow hover sx={{ '& > *': { borderBottom: isExpanded ? 'none' : undefined } }}>
                        <TableCell>
                          {log.details && (
                            <IconButton size="small" onClick={() => toggleRowExpansion(log.id)}>
                              {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                            </IconButton>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{formatTimestamp(log.created_at)}</Typography>
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {log.username ? <PersonIcon fontSize="small" /> : <SystemIcon fontSize="small" />}
                            <Typography variant="body2">{log.username || 'System'}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={actionInfo.label}
                            size="small"
                            sx={{ backgroundColor: actionInfo.color, color: 'white', fontWeight: 500 }}
                          />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Chip
                              label={resourceInfo.label}
                              size="small"
                              variant="outlined"
                              sx={{ borderColor: resourceInfo.color, color: resourceInfo.color }}
                            />
                            {log.resource_id && (
                              <Typography variant="body2" color="textSecondary">
                                #{log.resource_id}
                              </Typography>
                            )}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Tooltip title={log.user_agent || ''}>
                            <Typography variant="body2" color="textSecondary">
                              {log.ip_address || '-'}
                            </Typography>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                      {/* Expanded Details Row */}
                      <TableRow>
                        <TableCell colSpan={6} sx={{ py: 0 }}>
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 2, backgroundColor: 'grey.50' }}>
                              <Typography variant="subtitle2" gutterBottom>
                                Details
                              </Typography>
                              <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'grey.100' }}>
                                <pre
                                  style={{
                                    margin: 0,
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    fontSize: '0.85rem',
                                  }}
                                >
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              </Paper>
                              {log.user_agent && (
                                <Box sx={{ mt: 1 }}>
                                  <Typography variant="caption" color="textSecondary">
                                    User Agent: {log.user_agent}
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={total}
              page={(query.page || 1) - 1}
              rowsPerPage={query.page_size || 25}
              onPageChange={handlePageChange}
              onRowsPerPageChange={handleRowsPerPageChange}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </>
        )}
      </TableContainer>
    </Box>
  );
};

export default AuditLogPage;
