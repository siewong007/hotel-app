/**
 * i18next Configuration for Hotel Management System
 * Integrated with backend translation service (mBART + Adapter Fusion)
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enRooms from './locales/en/rooms.json';
import enBookings from './locales/en/bookings.json';
import enGuests from './locales/en/guests.json';
import enValidation from './locales/en/validation.json';
import enDashboard from './locales/en/dashboard.json';
import enProfile from './locales/en/profile.json';
import enSettings from './locales/en/settings.json';

import zhCommon from './locales/zh/common.json';
import zhAuth from './locales/zh/auth.json';
import zhRooms from './locales/zh/rooms.json';
import zhBookings from './locales/zh/bookings.json';
import zhGuests from './locales/zh/guests.json';
import zhValidation from './locales/zh/validation.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhProfile from './locales/zh/profile.json';
import zhSettings from './locales/zh/settings.json';

// ============================================================================
// Supported Languages Configuration
// ============================================================================

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
  flag: string;
  quality: 'tier1' | 'tier2' | 'tier3';
}

export const SUPPORTED_LANGUAGES: Language[] = [
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    rtl: false,
    flag: '🇺🇸',
    quality: 'tier1'
  },
  {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    rtl: false,
    flag: '🇪🇸',
    quality: 'tier1'
  },
  {
    code: 'fr',
    name: 'French',
    nativeName: 'Français',
    rtl: false,
    flag: '🇫🇷',
    quality: 'tier1'
  },
  {
    code: 'de',
    name: 'German',
    nativeName: 'Deutsch',
    rtl: false,
    flag: '🇩🇪',
    quality: 'tier1'
  },
  {
    code: 'zh',
    name: 'Chinese',
    nativeName: '中文',
    rtl: false,
    flag: '🇨🇳',
    quality: 'tier2'
  },
  {
    code: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    rtl: false,
    flag: '🇯🇵',
    quality: 'tier2'
  },
  {
    code: 'ar',
    name: 'Arabic',
    nativeName: 'العربية',
    rtl: true,
    flag: '🇸🇦',
    quality: 'tier2'
  },
  {
    code: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    rtl: false,
    flag: '🇷🇺',
    quality: 'tier2'
  },
  {
    code: 'pt',
    name: 'Portuguese',
    nativeName: 'Português',
    rtl: false,
    flag: '🇵🇹',
    quality: 'tier2'
  },
  {
    code: 'it',
    name: 'Italian',
    nativeName: 'Italiano',
    rtl: false,
    flag: '🇮🇹',
    quality: 'tier2'
  },
  {
    code: 'ko',
    name: 'Korean',
    nativeName: '한국어',
    rtl: false,
    flag: '🇰🇷',
    quality: 'tier3'
  },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    rtl: false,
    flag: '🇮🇳',
    quality: 'tier3'
  },
  {
    code: 'tr',
    name: 'Turkish',
    nativeName: 'Türkçe',
    rtl: false,
    flag: '🇹🇷',
    quality: 'tier3'
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

export const getLanguageByCode = (code: string): Language | undefined => {
  return SUPPORTED_LANGUAGES.find(lang => lang.code === code);
};

export const isRTL = (languageCode: string): boolean => {
  const lang = getLanguageByCode(languageCode);
  return lang?.rtl || false;
};

export const updateDocumentDirection = (languageCode: string) => {
  const rtl = isRTL(languageCode);
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.documentElement.lang = languageCode;

  // Update Material-UI theme direction if needed
  const event = new CustomEvent('language-direction-change', {
    detail: { rtl, languageCode }
  });
  window.dispatchEvent(event);
};

// ============================================================================
// i18next Initialization
// ============================================================================

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3030';

// Translation resources
const resources = {
  en: {
    common: enCommon,
    bookings: enBookings,
    rooms: enRooms,
    guests: enGuests,
    auth: enAuth,
    validation: enValidation,
    dashboard: enDashboard,
    profile: enProfile,
    settings: enSettings,
  },
  zh: {
    common: zhCommon,
    bookings: zhBookings,
    rooms: zhRooms,
    guests: zhGuests,
    auth: zhAuth,
    validation: zhValidation,
    dashboard: zhDashboard,
    profile: zhProfile,
    settings: zhSettings,
  }
};

i18n
  // Detect user language
  .use(LanguageDetector)
  // Pass i18n instance to react-i18next
  .use(initReactI18next)
  // Initialize i18next
  .init({
    // Fallback language
    fallbackLng: 'en',

    // Debug mode (disabled to reduce console noise)
    debug: false,

    // Supported languages
    supportedLngs: SUPPORTED_LANGUAGES.map(l => l.code),

    // Non-explicit fallback language
    nonExplicitSupportedLngs: true,

    // Use inline resources instead of backend
    resources: resources,

    // Language detection order
    detection: {
      order: [
        'querystring',
        'localStorage',
        'sessionStorage',
        'navigator',
        'htmlTag',
        'path',
        'subdomain'
      ],
      lookupQuerystring: 'lng',
      lookupLocalStorage: 'i18nextLng',
      lookupSessionStorage: 'i18nextLng',
      caches: ['localStorage', 'sessionStorage'],
      excludeCacheFor: ['cimode'],
    },

    // Interpolation
    interpolation: {
      escapeValue: false, // React already escapes values
      format: (value, format, lng) => {
        if (format === 'uppercase') return value.toUpperCase();
        if (format === 'lowercase') return value.toLowerCase();
        if (format === 'currency') {
          return new Intl.NumberFormat(lng, {
            style: 'currency',
            currency: 'USD'
          }).format(value);
        }
        if (format === 'date') {
          return new Intl.DateTimeFormat(lng).format(new Date(value));
        }
        return value;
      }
    },

    // React specific options
    react: {
      useSuspense: false, // Disable suspense to avoid loading delays
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added removed',
      transEmptyNodeValue: '',
      transSupportBasicHtmlNodes: true,
      transKeepBasicHtmlNodesFor: ['br', 'strong', 'i', 'b', 'p', 'span'],
    },

    // Namespaces
    ns: ['common', 'bookings', 'rooms', 'guests', 'auth', 'validation', 'dashboard', 'profile', 'settings'],
    defaultNS: 'common',

    // Key separator
    keySeparator: '.',
    nsSeparator: ':',

    // Plurals
    pluralSeparator: '_',
    contextSeparator: '_',

    // Missing key handling (disabled to reduce console noise)
    saveMissing: false,

    // Load resources synchronously
    initImmediate: false,

    // Clean code on default value
    returnEmptyString: false,
    returnNull: false,
    returnObjects: false,
  });

// ============================================================================
// Event Listeners
// ============================================================================

// Update document direction when language changes
i18n.on('languageChanged', (lng) => {
  updateDocumentDirection(lng);

  // Save to localStorage
  try {
    localStorage.setItem('preferredLanguage', lng);
  } catch (error) {
    console.error('Failed to save language preference:', error);
  }

  // Log language change
  if (process.env.NODE_ENV === 'development') {
    console.log(`🌍 Language changed to: ${lng}`);
  }
});

// Handle initialization errors
i18n.on('failedLoading', (lng, ns, msg) => {
  console.error(`Failed to load [${lng}][${ns}]:`, msg);
});

// ============================================================================
// Initial Setup
// ============================================================================

// Set initial direction based on current or default language
const initialLang = i18n.language || 'en';
updateDocumentDirection(initialLang);

export default i18n;
