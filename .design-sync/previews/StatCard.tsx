import React from 'react';
import { Box } from '@mui/material';
import HotelIcon from '@mui/icons-material/Hotel';
import PaidIcon from '@mui/icons-material/Paid';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import { StatCard } from 'hotel-web-fe';

export function Occupancy() {
  return (
    <Box sx={{ maxWidth: 300 }}>
      <StatCard title="Occupancy" value="82%" subtitle="128 of 156 rooms" icon={<HotelIcon />} />
    </Box>
  );
}

export function Gradient() {
  return (
    <Box sx={{ maxWidth: 300 }}>
      <StatCard
        appearance="gradient"
        gradient="linear-gradient(135deg, #2f8d66 0%, #1f6f52 100%)"
        title="Revenue Today"
        value="RM 42,180"
        subtitle="Rooms + F&B"
        icon={<PaidIcon />}
      />
    </Box>
  );
}

export function WithTrend() {
  return (
    <Box sx={{ maxWidth: 300 }}>
      <StatCard
        title="Arrivals"
        value="37"
        subtitle="Expected check-ins"
        icon={<EventAvailableIcon />}
        showPositiveTrendSign
        trend={{ value: 12, label: 'vs. yesterday' }}
      />
    </Box>
  );
}

export function Dashboard() {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      <Box sx={{ flex: '1 1 200px' }}>
        <StatCard title="ADR" value="RM 329" subtitle="Average daily rate" icon={<PaidIcon />} />
      </Box>
      <Box sx={{ flex: '1 1 200px' }}>
        <StatCard
          title="RevPAR"
          value="RM 270"
          subtitle="Revenue per available room"
          icon={<HotelIcon />}
          trend={{ value: -4, label: 'vs. last week' }}
        />
      </Box>
      <Box sx={{ flex: '1 1 200px' }}>
        <StatCard title="Departures" value="29" subtitle="Check-outs today" icon={<EventAvailableIcon />} />
      </Box>
    </Box>
  );
}
