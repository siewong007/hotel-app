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
      color: '#1976d2',
      label: 'Laptop',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    };
  }

  if (matches('desktop', 'pc', 'imac', 'mac mini', 'mac studio', 'workstation')) {
    return {
      type: 'desktop',
      icon: <ComputerIcon />,
      color: '#2e7d32',
      label: 'Desktop',
      gradient: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    };
  }

  if (matches('ipad', 'tablet', 'surface pro', 'galaxy tab')) {
    return {
      type: 'tablet',
      icon: <TabletIcon />,
      color: '#ed6c02',
      label: 'Tablet',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    };
  }

  if (matches('iphone', 'android', 'pixel', 'samsung', 'galaxy', 'mobile', 'phone', 'oneplus', 'xiaomi')) {
    const isIphone = name.includes('iphone');
    return {
      type: 'mobile',
      icon: isIphone ? <PhoneIphoneIcon /> : <SmartphoneIcon />,
      color: '#9c27b0',
      label: isIphone ? 'iPhone' : 'Mobile',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    };
  }

  if (matches('yubikey', 'security key', 'fido', 'u2f', 'token')) {
    return {
      type: 'security-key',
      icon: <SecurityIcon />,
      color: '#d32f2f',
      label: 'Security Key',
      gradient: 'linear-gradient(135deg, #ff6b6b 0%, #c92a2a 100%)',
    };
  }

  return {
    type: 'unknown',
    icon: <FingerprintIcon />,
    color: '#757575',
    label: 'Device',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
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
