import React from 'react';
import { Box } from '@mui/material';
import {
  Computer as ComputerIcon,
  Fingerprint as FingerprintIcon,
  Laptop as LaptopIcon,
  PhoneIphone as PhoneIphoneIcon,
  Security as SecurityIcon,
  Smartphone as SmartphoneIcon,
  Tablet as TabletIcon,
} from '@mui/icons-material';

export type DeviceType = 'laptop' | 'desktop' | 'mobile' | 'tablet' | 'security-key' | 'unknown';

export interface DeviceConfig {
  type: DeviceType;
  icon: React.ReactElement;
  color: string;
  label: string;
  gradient: string;
}

/**
 * Best-effort device classification from a free-text device name or user agent.
 * Used to decorate passkeys and signed-in sessions; never security-relevant.
 */
export const detectDeviceType = (deviceName: string): DeviceConfig => {
  const name = deviceName.toLowerCase();
  const matches = (...needles: string[]) => needles.some(needle => name.includes(needle));

  if (matches('macbook', 'laptop', 'thinkpad', 'notebook', 'xps', 'surface laptop', 'chromebook')) {
    return {
      type: 'laptop',
      icon: <LaptopIcon />,
      color: 'var(--hotel-info)',
      label: 'Laptop',
      gradient: 'color-mix(in srgb, var(--hotel-info) 20%, transparent)',
    };
  }

  if (matches('desktop', 'pc', 'imac', 'mac mini', 'mac studio', 'workstation')) {
    return {
      type: 'desktop',
      icon: <ComputerIcon />,
      color: 'var(--hotel-success)',
      label: 'Desktop',
      gradient: 'color-mix(in srgb, var(--hotel-success) 20%, transparent)',
    };
  }

  if (matches('ipad', 'tablet', 'surface pro', 'galaxy tab')) {
    return {
      type: 'tablet',
      icon: <TabletIcon />,
      color: 'var(--hotel-warning)',
      label: 'Tablet',
      gradient: 'color-mix(in srgb, var(--hotel-warning) 20%, transparent)',
    };
  }

  if (matches('iphone', 'android', 'pixel', 'samsung', 'galaxy', 'mobile', 'phone', 'oneplus', 'xiaomi')) {
    const isIphone = name.includes('iphone');
    return {
      type: 'mobile',
      icon: isIphone ? <PhoneIphoneIcon /> : <SmartphoneIcon />,
      color: 'var(--hotel-chart-4)',
      label: isIphone ? 'iPhone' : 'Mobile',
      gradient: 'color-mix(in srgb, var(--hotel-chart-4) 20%, transparent)',
    };
  }

  if (matches('yubikey', 'security key', 'fido', 'u2f', 'token')) {
    return {
      type: 'security-key',
      icon: <SecurityIcon />,
      color: 'var(--hotel-danger)',
      label: 'Security Key',
      gradient: 'color-mix(in srgb, var(--hotel-danger) 20%, transparent)',
    };
  }

  return {
    type: 'unknown',
    icon: <FingerprintIcon />,
    color: 'var(--hotel-neutral)',
    label: 'Device',
    gradient: 'color-mix(in srgb, var(--hotel-info) 20%, transparent)',
  };
};

interface DeviceIconProps {
  deviceName: string;
  size?: number;
}

export const DeviceIcon: React.FC<DeviceIconProps> = ({ deviceName, size = 48 }) => {
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
          color: config.color,
          boxShadow: 'var(--hotel-shadow-sm)',
          transition: 'transform 0.3s ease',
          '&:hover': {
            transform: 'scale(1.1) rotate(5deg)',
          },
          '& svg': {
            fontSize: size * 0.6,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
          },
        }}
      >
        {config.icon}
      </Box>
    </Box>
  );
};
