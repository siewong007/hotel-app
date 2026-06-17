import React from 'react';

// Stroke-based icon set (1.6 weight) ported from the Salim Inn design handoff.
export type IconName =
  | 'bed' | 'building' | 'ledger' | 'users' | 'user' | 'calendar' | 'chart' | 'bank'
  | 'dots' | 'sun' | 'moon' | 'chev-left' | 'chev-right' | 'chev-down' | 'search'
  | 'plus' | 'login' | 'logout' | 'card' | 'doc' | 'print' | 'download' | 'refresh'
  | 'filter' | 'phone' | 'info' | 'x' | 'check' | 'external' | 'arrow-right'
  | 'arrow-up-right' | 'trend-up' | 'trend-down' | 'percent' | 'coins' | 'wallet'
  | 'gauge' | 'lock' | 'clock' | 'sparkle' | 'list' | 'door' | 'broom' | 'alert'
  | 'menu' | 'globe';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({ name, size = 16, strokeWidth = 1.6, style, className }) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    style: { width: size, height: size, ...style },
    className,
  };
  switch (name) {
    case 'bed':
      return (<svg {...common}><path d="M3 17V7" /><path d="M3 12h18v5" /><path d="M21 12V9a2 2 0 0 0-2-2H10v5" /><circle cx="7" cy="11" r="1.5" /></svg>);
    case 'building':
      return (<svg {...common}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" /></svg>);
    case 'ledger':
      return (<svg {...common}><path d="M4 6v13a2 2 0 0 0 2 2h14V8a2 2 0 0 0-2-2H6a2 2 0 0 1 0-4h12" /><path d="M9 11h7M9 15h5" /></svg>);
    case 'users':
      return (<svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 3-5 6-5s6 2 6 5" /><path d="M16 4.5a3 3 0 0 1 0 6" /><path d="M17.5 14c2.5.5 4 2 4.5 4" /></svg>);
    case 'user':
      return (<svg {...common}><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.5 3.2-6 7-6s7 2.5 7 6" /></svg>);
    case 'calendar':
      return (<svg {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>);
    case 'chart':
      return (<svg {...common}><path d="M3 20h18" /><path d="M7 16v-5" /><path d="M12 16V8" /><path d="M17 16v-3" /></svg>);
    case 'bank':
      return (<svg {...common}><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8" /><path d="M3 19h18" /></svg>);
    case 'dots':
      return (<svg {...common}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>);
    case 'sun':
      return (<svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>);
    case 'moon':
      return (<svg {...common}><path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" /></svg>);
    case 'chev-left':
      return (<svg {...common}><path d="M15 6l-6 6 6 6" /></svg>);
    case 'chev-right':
      return (<svg {...common}><path d="M9 6l6 6-6 6" /></svg>);
    case 'chev-down':
      return (<svg {...common}><path d="M6 9l6 6 6-6" /></svg>);
    case 'search':
      return (<svg {...common}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.5-3.5" /></svg>);
    case 'plus':
      return (<svg {...common}><path d="M12 5v14M5 12h14" /></svg>);
    case 'login':
      return (<svg {...common}><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>);
    case 'logout':
      return (<svg {...common}><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>);
    case 'card':
      return (<svg {...common}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /><path d="M6 15h3" /></svg>);
    case 'doc':
      return (<svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8 13h8M8 17h5" /></svg>);
    case 'print':
      return (<svg {...common}><path d="M7 9V4h10v5" /><rect x="3" y="9" width="18" height="8" rx="2" /><path d="M7 15h10v5H7z" /></svg>);
    case 'download':
      return (<svg {...common}><path d="M12 4v11" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></svg>);
    case 'refresh':
      return (<svg {...common}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>);
    case 'filter':
      return (<svg {...common}><path d="M3 5h18l-7 9v6l-4-2v-4z" /></svg>);
    case 'phone':
      return (<svg {...common}><path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>);
    case 'info':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.6" fill="currentColor" /></svg>);
    case 'x':
      return (<svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case 'check':
      return (<svg {...common}><path d="M5 12l5 5L20 7" /></svg>);
    case 'external':
      return (<svg {...common}><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></svg>);
    case 'arrow-right':
      return (<svg {...common}><path d="M4 12h16" /><path d="M14 6l6 6-6 6" /></svg>);
    case 'arrow-up-right':
      return (<svg {...common}><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>);
    case 'trend-up':
      return (<svg {...common}><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v5M21 7h-5" /></svg>);
    case 'trend-down':
      return (<svg {...common}><path d="M3 7l6 6 4-4 8 8" /><path d="M21 17v-5M21 17h-5" /></svg>);
    case 'percent':
      return (<svg {...common}><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></svg>);
    case 'coins':
      return (<svg {...common}><ellipse cx="9" cy="6" rx="6" ry="3" /><path d="M3 6v6c0 1.7 2.7 3 6 3s6-1.3 6-3V6" /><path d="M15 10.5c2.8.3 6 1.5 6 3.5 0 1.7-2.7 3-6 3-1.4 0-2.7-.2-3.7-.6" /></svg>);
    case 'wallet':
      return (<svg {...common}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M16 15h2" /></svg>);
    case 'gauge':
      return (<svg {...common}><path d="M12 13l4-4" /><path d="M3 17a9 9 0 1 1 18 0" /><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" /></svg>);
    case 'lock':
      return (<svg {...common}><rect x="4.5" y="10" width="15" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" /></svg>);
    case 'clock':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
    case 'sparkle':
      return (<svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>);
    case 'list':
      return (<svg {...common}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>);
    case 'door':
      return (<svg {...common}><path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17" /><path d="M3 21h16" /><circle cx="13" cy="12" r="1" fill="currentColor" stroke="none" /></svg>);
    case 'broom':
      return (<svg {...common}><path d="M19 4 9 14" /><path d="M5 20s-1-4 2-5 5 2 5 2l2-2-3-3-2 2s-3-2-5 0-1 6-1 6z" /></svg>);
    case 'alert':
      return (<svg {...common}><path d="M12 3l10 17H2z" /><path d="M12 10v5" /><circle cx="12" cy="18" r="0.6" fill="currentColor" /></svg>);
    case 'menu':
      return (<svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
    case 'globe':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></svg>);
    default:
      return null;
  }
};

export default Icon;
