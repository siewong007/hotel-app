-- ============================================================================
-- SCYLLADB MULTILINGUAL SCHEMA INITIALIZATION
-- ============================================================================
-- Creates keyspace and tables for multilingual content support
-- ============================================================================

-- Create keyspace with replication
CREATE KEYSPACE IF NOT EXISTS hotel_i18n
WITH REPLICATION = {
  'class': 'SimpleStrategy',
  'replication_factor': 3
}
AND DURABLE_WRITES = true;

-- Use the keyspace
USE hotel_i18n;

-- ============================================================================
-- TRANSLATIONS TABLE
-- ============================================================================
-- Stores translated content for all hotel resources
CREATE TABLE IF NOT EXISTS translations (
  resource_type text,        -- 'room_type', 'amenity', 'service', 'ui', 'email_template'
  resource_id uuid,          -- Foreign key to source table (PostgreSQL)
  language_code text,        -- ISO 639-1 code: 'en', 'es', 'fr', 'de', 'zh', 'ja', 'ar', etc.
  field_name text,           -- Field being translated: 'name', 'description', 'benefits', etc.
  translated_text text,      -- The actual translated content
  translation_method text,   -- 'human', 'mbart', 'adapter_fusion', 'hybrid', 'google', 'deepl'
  quality_score float,       -- Translation quality metric (0.0-1.0)
  reviewed boolean,          -- Has been human-reviewed
  reviewed_by uuid,          -- User ID who reviewed (null if not reviewed)
  reviewer_notes text,       -- Optional notes from reviewer
  created_at timestamp,
  updated_at timestamp,
  version int,               -- Version number for tracking changes
  metadata map<text, text>,  -- Additional metadata (context, domain, tags, etc.)
  PRIMARY KEY ((resource_type, resource_id), language_code, field_name)
) WITH CLUSTERING ORDER BY (language_code ASC, field_name ASC)
  AND compaction = {
    'class': 'TimeWindowCompactionStrategy',
    'compaction_window_size': 1,
    'compaction_window_unit': 'DAYS'
  }
  AND comment = 'Stores all translated content with quality tracking';

-- Index for quick language lookups
CREATE INDEX IF NOT EXISTS idx_translations_language
ON translations (language_code);

-- Index for translation method analysis
CREATE INDEX IF NOT EXISTS idx_translations_method
ON translations (translation_method);

-- Index for quality filtering
CREATE INDEX IF NOT EXISTS idx_translations_quality
ON translations (quality_score);

-- Index for review status
CREATE INDEX IF NOT EXISTS idx_translations_reviewed
ON translations (reviewed);

-- ============================================================================
-- USER LANGUAGE PREFERENCES TABLE
-- ============================================================================
-- Stores user language preferences and fallback options
CREATE TABLE IF NOT EXISTS user_language_preferences (
  user_id uuid,
  primary_language text,                    -- User's primary language
  fallback_languages list<text>,            -- Ordered list of fallback languages
  auto_detect boolean,                      -- Auto-detect language from browser/IP
  translation_quality_preference text,      -- 'fast', 'balanced', 'accurate'
  rtl_preference text,                      -- 'auto', 'force_ltr', 'force_rtl'
  show_original boolean,                    -- Show original text alongside translation
  created_at timestamp,
  updated_at timestamp,
  last_language_change timestamp,
  PRIMARY KEY (user_id)
) WITH comment = 'User language preferences and settings';

-- ============================================================================
-- TRANSLATION CACHE TABLE
-- ============================================================================
-- High-performance cache for frequently used translations
CREATE TABLE IF NOT EXISTS translation_cache (
  source_language text,
  target_language text,
  source_text text,
  translated_text text,
  model_version text,                       -- Model/adapter version used
  quality_score float,
  hit_count counter,                        -- Track cache hits
  last_accessed timestamp,
  expires_at timestamp,
  created_at timestamp,
  PRIMARY KEY ((source_language, target_language), source_text)
) WITH default_time_to_live = 2592000       -- 30 days TTL
  AND gc_grace_seconds = 86400
  AND compaction = {
    'class': 'SizeTieredCompactionStrategy',
    'min_threshold': 4,
    'max_threshold': 32
  }
  AND comment = 'Cache for translated strings with TTL';

-- Index for cache maintenance
CREATE INDEX IF NOT EXISTS idx_cache_expires
ON translation_cache (expires_at);

-- ============================================================================
-- SUPPORTED LANGUAGES TABLE
-- ============================================================================
-- Master list of supported languages with configuration
CREATE TABLE IF NOT EXISTS supported_languages (
  language_code text,
  language_name text,                       -- English name
  native_name text,                         -- Native name (e.g., "Español" for Spanish)
  rtl boolean,                              -- Right-to-left writing system
  enabled boolean,                          -- Currently enabled for users
  adapter_available boolean,                -- Has trained domain adapter
  quality_tier text,                        -- 'tier1' (best), 'tier2', 'tier3'
  fallback_language text,                   -- Fallback if translation unavailable
  locale text,                              -- Full locale code (e.g., 'en-US')
  flag_emoji text,                          -- Unicode flag emoji
  sort_order int,                           -- Display order in UI
  created_at timestamp,
  updated_at timestamp,
  metadata map<text, text>,                 -- Additional config
  PRIMARY KEY (language_code)
) WITH comment = 'Supported languages configuration';

-- ============================================================================
-- TRANSLATION JOBS TABLE
-- ============================================================================
-- Tracks background translation jobs and batch operations
CREATE TABLE IF NOT EXISTS translation_jobs (
  job_id uuid,
  job_type text,                            -- 'batch_translate', 'retranslate', 'quality_check'
  status text,                              -- 'pending', 'running', 'completed', 'failed'
  resource_type text,
  language_code text,
  total_items int,
  completed_items int,
  failed_items int,
  started_at timestamp,
  completed_at timestamp,
  error_message text,
  metadata map<text, text>,
  PRIMARY KEY (job_id)
) WITH comment = 'Background translation job tracking';

-- Index for status monitoring
CREATE INDEX IF NOT EXISTS idx_jobs_status
ON translation_jobs (status);

-- Index for job type filtering
CREATE INDEX IF NOT EXISTS idx_jobs_type
ON translation_jobs (job_type);

-- ============================================================================
-- TRANSLATION QUALITY METRICS TABLE
-- ============================================================================
-- Tracks translation quality over time for analytics
CREATE TABLE IF NOT EXISTS quality_metrics (
  metric_id uuid,
  language_code text,
  resource_type text,
  translation_method text,
  metric_type text,                         -- 'bleu', 'meteor', 'ter', 'human_rating'
  score float,
  sample_size int,
  measured_at timestamp,
  PRIMARY KEY ((language_code, resource_type), measured_at, metric_id)
) WITH CLUSTERING ORDER BY (measured_at DESC)
  AND comment = 'Translation quality metrics for monitoring';

-- ============================================================================
-- GLOSSARY TABLE
-- ============================================================================
-- Domain-specific terminology with translations
CREATE TABLE IF NOT EXISTS glossary (
  term_id uuid,
  source_term text,
  source_language text,
  category text,                            -- 'hotel', 'amenity', 'booking', 'legal'
  translations map<text, text>,             -- language_code -> translated_term
  usage_notes text,
  do_not_translate boolean,                 -- Brand names, proper nouns
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (term_id)
) WITH comment = 'Domain-specific terminology glossary';

-- Index for term lookup
CREATE INDEX IF NOT EXISTS idx_glossary_term
ON glossary (source_term);

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_glossary_category
ON glossary (category);

-- ============================================================================
-- INITIAL DATA: SUPPORTED LANGUAGES
-- ============================================================================
INSERT INTO supported_languages (
  language_code, language_name, native_name, rtl, enabled,
  adapter_available, quality_tier, fallback_language, locale,
  flag_emoji, sort_order, created_at
) VALUES
  ('en', 'English', 'English', false, true, true, 'tier1', null, 'en-US', '🇺🇸', 1, toTimestamp(now())),
  ('es', 'Spanish', 'Español', false, true, true, 'tier1', 'en', 'es-ES', '🇪🇸', 2, toTimestamp(now())),
  ('fr', 'French', 'Français', false, true, true, 'tier1', 'en', 'fr-FR', '🇫🇷', 3, toTimestamp(now())),
  ('de', 'German', 'Deutsch', false, true, true, 'tier1', 'en', 'de-DE', '🇩🇪', 4, toTimestamp(now())),
  ('zh', 'Chinese', '中文', false, true, true, 'tier2', 'en', 'zh-CN', '🇨🇳', 5, toTimestamp(now())),
  ('ja', 'Japanese', '日本語', false, true, true, 'tier2', 'en', 'ja-JP', '🇯🇵', 6, toTimestamp(now())),
  ('ar', 'Arabic', 'العربية', true, true, true, 'tier2', 'en', 'ar-SA', '🇸🇦', 7, toTimestamp(now())),
  ('ru', 'Russian', 'Русский', false, true, true, 'tier2', 'en', 'ru-RU', '🇷🇺', 8, toTimestamp(now())),
  ('pt', 'Portuguese', 'Português', false, true, true, 'tier2', 'en', 'pt-PT', '🇵🇹', 9, toTimestamp(now())),
  ('it', 'Italian', 'Italiano', false, true, true, 'tier2', 'en', 'it-IT', '🇮🇹', 10, toTimestamp(now())),
  ('ko', 'Korean', '한국어', false, true, false, 'tier3', 'en', 'ko-KR', '🇰🇷', 11, toTimestamp(now())),
  ('hi', 'Hindi', 'हिन्दी', false, true, false, 'tier3', 'en', 'hi-IN', '🇮🇳', 12, toTimestamp(now())),
  ('tr', 'Turkish', 'Türkçe', false, true, false, 'tier3', 'en', 'tr-TR', '🇹🇷', 13, toTimestamp(now())),
  ('vi', 'Vietnamese', 'Tiếng Việt', false, true, false, 'tier3', 'en', 'vi-VN', '🇻🇳', 14, toTimestamp(now())),
  ('th', 'Thai', 'ไทย', false, true, false, 'tier3', 'en', 'th-TH', '🇹🇭', 15, toTimestamp(now()));

-- ============================================================================
-- SAMPLE GLOSSARY ENTRIES
-- ============================================================================
INSERT INTO glossary (
  term_id, source_term, source_language, category, translations,
  do_not_translate, created_at
) VALUES
  (uuid(), 'Deluxe Room', 'en', 'hotel', {'es': 'Habitación Deluxe', 'fr': 'Chambre Deluxe', 'de': 'Deluxe-Zimmer'}, false, toTimestamp(now())),
  (uuid(), 'Check-in', 'en', 'booking', {'es': 'Registro de entrada', 'fr': 'Enregistrement', 'de': 'Check-in'}, false, toTimestamp(now())),
  (uuid(), 'Check-out', 'en', 'booking', {'es': 'Salida', 'fr': 'Départ', 'de': 'Check-out'}, false, toTimestamp(now())),
  (uuid(), 'WiFi', 'en', 'amenity', {'es': 'WiFi', 'fr': 'WiFi', 'de': 'WLAN'}, true, toTimestamp(now())),
  (uuid(), 'Room Service', 'en', 'hotel', {'es': 'Servicio de habitaciones', 'fr': 'Service en chambre', 'de': 'Zimmerservice'}, false, toTimestamp(now()));
