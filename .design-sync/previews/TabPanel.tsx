import React from 'react';
// Import MUI scaffolding from the DS bundle so it shares the hotel theme
// (teal), not a fresh default-blue MUI instance.
import { Tabs, Tab, Typography, Paper, TabPanel } from 'hotel-web-fe';

// TabPanel renders its children only when `value === index`. Pair it with
// MUI <Tabs> — here the first tab is active so its panel is shown.
export function GuestFolio() {
  const [value, setValue] = React.useState(0);
  return (
    <Paper variant="outlined" sx={{ maxWidth: 480, borderRadius: 2, overflow: 'hidden' }}>
      <Tabs value={value} onChange={(_, v) => setValue(v)} sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Tab label="Summary" />
        <Tab label="Charges" />
        <Tab label="Payments" />
      </Tabs>
      <TabPanel value={value} index={0} idPrefix="folio">
        <Typography variant="subtitle2">Reservation BK-10241</Typography>
        <Typography variant="body2" color="text.secondary">
          Aisha Rahman · Room 1204 · 3 nights · Balance due RM 987
        </Typography>
      </TabPanel>
      <TabPanel value={value} index={1} idPrefix="folio">
        <Typography variant="body2">Room 3 × RM 329, Tourism tax RM 30</Typography>
      </TabPanel>
      <TabPanel value={value} index={2} idPrefix="folio">
        <Typography variant="body2">Deposit RM 300 (card)</Typography>
      </TabPanel>
    </Paper>
  );
}
