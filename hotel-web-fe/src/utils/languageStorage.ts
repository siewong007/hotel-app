/**
 * Language Storage Utility
 * Manages language preferences in localStorage with fallback handling
 */

export interface LanguagePreference {
  code: string;
  name: string;
  nativeName: string;
  selectedAt: string;
  isFirstVisit: boolean;
}

const STORAGE_KEYS = {
  LANGUAGE: 'hotel_app_language',
  LANGUAGE_PREFERENCE: 'hotel_app_language_preference',
  FIRST_VISIT: 'hotel_app_first_visit',
  LANGUAGE_HISTORY: 'hotel_app_language_history',
} as const;

class LanguageStorageService {
  /**
   * Check if this is the user's first visit
   */
  isFirstVisit(): boolean {
    try {
      const firstVisit = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT);
      return firstVisit === null || firstVisit === 'true';
    } catch (error) {
      console.warn('Failed to check first visit status:', error);
      return true;
    }
  }

  /**
   * Mark that the user has completed their first visit
   */
  markFirstVisitComplete(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.FIRST_VISIT, 'false');
    } catch (error) {
      console.error('Failed to mark first visit complete:', error);
    }
  }

  /**
   * Reset first visit status (for testing)
   */
  resetFirstVisit(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.FIRST_VISIT);
    } catch (error) {
      console.error('Failed to reset first visit:', error);
    }
  }

  /**
   * Get the current language preference
   */
  getLanguagePreference(): LanguagePreference | null {
    try {
      const preference = localStorage.getItem(STORAGE_KEYS.LANGUAGE_PREFERENCE);
      if (preference) {
        return JSON.parse(preference);
      }

      // Fallback to legacy storage
      const legacyLang = localStorage.getItem(STORAGE_KEYS.LANGUAGE);
      if (legacyLang) {
        return {
          code: legacyLang,
          name: '',
          nativeName: '',
          selectedAt: new Date().toISOString(),
          isFirstVisit: false,
        };
      }

      return null;
    } catch (error) {
      console.error('Failed to get language preference:', error);
      return null;
    }
  }

  /**
   * Save language preference
   */
  saveLanguagePreference(preference: LanguagePreference): void {
    try {
      // Save full preference
      localStorage.setItem(
        STORAGE_KEYS.LANGUAGE_PREFERENCE,
        JSON.stringify(preference)
      );

      // Also save just the code for i18next compatibility
      localStorage.setItem(STORAGE_KEYS.LANGUAGE, preference.code);

      // Add to history
      this.addToHistory(preference);
    } catch (error) {
      console.error('Failed to save language preference:', error);
    }
  }

  /**
   * Get language code only (for i18next)
   */
  getLanguageCode(): string | null {
    try {
      const preference = this.getLanguagePreference();
      return preference?.code || localStorage.getItem(STORAGE_KEYS.LANGUAGE);
    } catch (error) {
      console.error('Failed to get language code:', error);
      return null;
    }
  }

  /**
   * Add language selection to history
   */
  private addToHistory(preference: LanguagePreference): void {
    try {
      const historyStr = localStorage.getItem(STORAGE_KEYS.LANGUAGE_HISTORY);
      let history: LanguagePreference[] = historyStr ? JSON.parse(historyStr) : [];

      // Add new entry
      history.unshift(preference);

      // Keep only last 10 entries
      history = history.slice(0, 10);

      localStorage.setItem(STORAGE_KEYS.LANGUAGE_HISTORY, JSON.stringify(history));
    } catch (error) {
      console.error('Failed to add to language history:', error);
    }
  }

  /**
   * Get language selection history
   */
  getLanguageHistory(): LanguagePreference[] {
    try {
      const historyStr = localStorage.getItem(STORAGE_KEYS.LANGUAGE_HISTORY);
      return historyStr ? JSON.parse(historyStr) : [];
    } catch (error) {
      console.error('Failed to get language history:', error);
      return [];
    }
  }

  /**
   * Clear all language preferences
   */
  clearAllPreferences(): void {
    try {
      Object.values(STORAGE_KEYS).forEach((key) => {
        localStorage.removeItem(key);
      });
    } catch (error) {
      console.error('Failed to clear language preferences:', error);
    }
  }

  /**
   * Detect browser language
   */
  detectBrowserLanguage(): string {
    try {
      // Get browser language
      const browserLang = navigator.language || (navigator as any).userLanguage;

      // Extract language code (e.g., 'en-US' -> 'en')
      const langCode = browserLang.split('-')[0].toLowerCase();

      return langCode;
    } catch (error) {
      console.error('Failed to detect browser language:', error);
      return 'en'; // Default to English
    }
  }

  /**
   * Check if localStorage is available
   */
  isStorageAvailable(): boolean {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const languageStorage = new LanguageStorageService();
