import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminService, type SystemSetting } from '../../../api/admin.service';
import { queryKeys } from '../../../api/queryKeys';
import {
  REPORT_DISPLAY_FONT_SIZE_MAX,
  REPORT_DISPLAY_FONT_SIZE_MIN,
  REPORT_FONT_SIZE_MIN,
  getHotelSettings,
  normalizeBookingChannels,
  normalizeReportFontFamily,
  normalizeReportFontSize,
  normalizeStringList,
  saveHotelSettings,
  type BookingChannel,
  type HotelSettings,
} from '../../../utils/hotelSettings';

const DB_SETTING_KEYS = [
  'hotel_name',
  'hotel_address',
  'hotel_phone',
  'hotel_email',
  'check_in_time',
  'check_out_time',
  'night_shift_time',
  'night_audit_auto_enabled',
  'currency',
  'timezone',
  'deposit_amount',
  'service_tax_rate',
  'tourism_tax_rate',
  'default_payment_terms_days',
  'report_font_size',
  'report_font_family',
  'report_heading_font_size',
  'report_section_heading_font_size',
  'report_table_font_size',
  'report_caption_font_size',
  'report_chip_font_size',
  'max_login_attempts',
  'totp_issuer_name',
  'passkey_relying_party_name',
  'support_enabled',
  'support_first_response_low_minutes',
  'support_first_response_normal_minutes',
  'support_first_response_high_minutes',
  'support_first_response_urgent_minutes',
  'support_resolution_low_minutes',
  'support_resolution_normal_minutes',
  'support_resolution_high_minutes',
  'support_resolution_urgent_minutes',
  'support_reopen_window_days',
  'rate_codes',
  'market_codes',
  'booking_channels',
  'payment_methods',
] as const;

type DbSettingKey = typeof DB_SETTING_KEYS[number];

const DB_SETTING_KEY_SET = new Set<string>(DB_SETTING_KEYS);

const parseNumberSetting = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBooleanSetting = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const parseStringListSetting = (value: string | undefined, fallback: string[]) => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return normalizeStringList(parsed, fallback);
  } catch {
    const values = value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    return values.length > 0 ? Array.from(new Set(values)) : fallback;
  }
  return fallback;
};

const parseBookingChannelsSetting = (value: string | undefined, fallback: BookingChannel[]) => {
  if (!value) return fallback;
  try {
    return normalizeBookingChannels(JSON.parse(value));
  } catch {
    return normalizeBookingChannels(
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    );
  }
};

const settingsRowsToMap = (rows: SystemSetting[]) =>
  new Map(rows.map(row => [row.key, row.value]));

const mergeSystemSettings = (
  localSettings: HotelSettings,
  rows: SystemSetting[]
): HotelSettings => {
  const values = settingsRowsToMap(rows);

  return {
    ...localSettings,
    hotel_name: values.get('hotel_name') ?? localSettings.hotel_name,
    hotel_address: values.get('hotel_address') ?? localSettings.hotel_address,
    hotel_phone: values.get('hotel_phone') ?? localSettings.hotel_phone,
    hotel_email: values.get('hotel_email') ?? localSettings.hotel_email,
    check_in_time: values.get('check_in_time') ?? localSettings.check_in_time,
    check_out_time: values.get('check_out_time') ?? localSettings.check_out_time,
    night_shift_time: values.get('night_shift_time') ?? localSettings.night_shift_time,
    night_audit_auto_enabled: parseBooleanSetting(
      values.get('night_audit_auto_enabled'),
      localSettings.night_audit_auto_enabled
    ),
    currency: values.get('currency') ?? localSettings.currency,
    timezone: values.get('timezone') ?? localSettings.timezone,
    deposit_amount: parseNumberSetting(values.get('deposit_amount'), localSettings.deposit_amount),
    service_tax_rate: parseNumberSetting(values.get('service_tax_rate'), localSettings.service_tax_rate),
    tourism_tax_rate: parseNumberSetting(values.get('tourism_tax_rate'), localSettings.tourism_tax_rate),
    default_payment_terms_days: parseNumberSetting(
      values.get('default_payment_terms_days'),
      localSettings.default_payment_terms_days
    ),
    report_font_size: normalizeReportFontSize(
      values.get('report_font_size') ?? localSettings.report_font_size,
      localSettings.report_font_size
    ),
    report_font_family: normalizeReportFontFamily(
      values.get('report_font_family') ?? localSettings.report_font_family
    ),
    report_heading_font_size: normalizeReportFontSize(
      values.get('report_heading_font_size') ?? localSettings.report_heading_font_size,
      localSettings.report_heading_font_size,
      { min: REPORT_DISPLAY_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
    ),
    report_section_heading_font_size: normalizeReportFontSize(
      values.get('report_section_heading_font_size') ?? localSettings.report_section_heading_font_size,
      localSettings.report_section_heading_font_size,
      { min: REPORT_FONT_SIZE_MIN, max: REPORT_DISPLAY_FONT_SIZE_MAX }
    ),
    report_table_font_size: normalizeReportFontSize(
      values.get('report_table_font_size') ?? localSettings.report_table_font_size,
      localSettings.report_table_font_size
    ),
    report_caption_font_size: normalizeReportFontSize(
      values.get('report_caption_font_size') ?? localSettings.report_caption_font_size,
      localSettings.report_caption_font_size
    ),
    report_chip_font_size: normalizeReportFontSize(
      values.get('report_chip_font_size') ?? localSettings.report_chip_font_size,
      localSettings.report_chip_font_size
    ),
    max_login_attempts: parseNumberSetting(values.get('max_login_attempts'), localSettings.max_login_attempts),
    totp_issuer_name: values.get('totp_issuer_name') ?? localSettings.totp_issuer_name,
    passkey_relying_party_name:
      values.get('passkey_relying_party_name') ?? localSettings.passkey_relying_party_name,
    support_enabled: parseBooleanSetting(values.get('support_enabled'), localSettings.support_enabled),
    support_first_response_low_minutes: parseNumberSetting(
      values.get('support_first_response_low_minutes'),
      localSettings.support_first_response_low_minutes
    ),
    support_first_response_normal_minutes: parseNumberSetting(
      values.get('support_first_response_normal_minutes'),
      localSettings.support_first_response_normal_minutes
    ),
    support_first_response_high_minutes: parseNumberSetting(
      values.get('support_first_response_high_minutes'),
      localSettings.support_first_response_high_minutes
    ),
    support_first_response_urgent_minutes: parseNumberSetting(
      values.get('support_first_response_urgent_minutes'),
      localSettings.support_first_response_urgent_minutes
    ),
    support_resolution_low_minutes: parseNumberSetting(
      values.get('support_resolution_low_minutes'),
      localSettings.support_resolution_low_minutes
    ),
    support_resolution_normal_minutes: parseNumberSetting(
      values.get('support_resolution_normal_minutes'),
      localSettings.support_resolution_normal_minutes
    ),
    support_resolution_high_minutes: parseNumberSetting(
      values.get('support_resolution_high_minutes'),
      localSettings.support_resolution_high_minutes
    ),
    support_resolution_urgent_minutes: parseNumberSetting(
      values.get('support_resolution_urgent_minutes'),
      localSettings.support_resolution_urgent_minutes
    ),
    support_reopen_window_days: parseNumberSetting(
      values.get('support_reopen_window_days'),
      localSettings.support_reopen_window_days
    ),
    rate_codes: parseStringListSetting(values.get('rate_codes'), localSettings.rate_codes),
    market_codes: parseStringListSetting(values.get('market_codes'), localSettings.market_codes),
    booking_channels: parseBookingChannelsSetting(values.get('booking_channels'), localSettings.booking_channels),
    payment_methods: parseStringListSetting(values.get('payment_methods'), localSettings.payment_methods),
  };
};

const serializeDbSetting = (key: DbSettingKey, settings: HotelSettings) => {
  const value = settings[key];
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
};

const loadSystemSettings = async () => {
  const rows = await AdminService.getSystemSettings();
  const settings = mergeSystemSettings(getHotelSettings(), rows);
  saveHotelSettings(settings);
  return { rows, settings };
};

export function useHotelSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings.hotel(),
    queryFn: async () => {
      const { rows, settings } = await loadSystemSettings();
      return { rows, settings };
    },
    select: data => data.settings,
    staleTime: 60_000,
  });
}

export function useSaveHotelSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: HotelSettings) => {
      const cached = queryClient.getQueryData<{ rows: SystemSetting[]; settings: HotelSettings }>(
        queryKeys.settings.hotel()
      );
      const rows = cached?.rows ?? (await AdminService.getSystemSettings());
      const existingKeys = new Set(rows.map(row => row.key));

      const updatedRows = await Promise.all(
        DB_SETTING_KEYS.filter(key => existingKeys.has(key)).map(key =>
          AdminService.updateSystemSetting(key, serializeDbSetting(key, settings))
        )
      );

      const unchangedRows = rows.filter(row => !DB_SETTING_KEY_SET.has(row.key));
      const mergedRows = [...unchangedRows, ...updatedRows];
      const mergedSettings = mergeSystemSettings(settings, mergedRows);
      saveHotelSettings(mergedSettings);
      return { rows: mergedRows, settings: mergedSettings };
    },
    onSuccess: ({ rows, settings }) => {
      saveHotelSettings(settings);
      queryClient.setQueryData(queryKeys.settings.hotel(), { rows, settings });
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
    },
  });
}
