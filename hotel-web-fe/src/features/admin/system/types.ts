export interface MetricsSnapshot {
  requests_total: number;
  responses_4xx: number;
  responses_5xx: number;
  requests_slow: number;
  rate_limit_rejections: number;
  auth_denied: number;
  permission_denied: number;
  audit_write_failures: number;
}

export interface JobHealth {
  job_name: string;
  last_status: string;
  last_run_at: string;
  last_duration_ms: number | null;
  last_error: string | null;
  last_detail: Record<string, unknown> | null;
  runs_24h: number;
  failures_24h: number;
}

export interface JobRunRow {
  id: number;
  job_name: string;
  status: string;
  detail: Record<string, unknown> | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface EmailQueueHealth {
  queued: number;
  sending: number;
  failed: number;
  sent_24h: number;
}

export interface SystemHealthResponse {
  database: string;
  uptime_seconds: number;
  metrics: MetricsSnapshot;
  email_queue: EmailQueueHealth;
  jobs: JobHealth[];
  job_runs_enabled: boolean;
}

export interface StaffNotificationItem {
  id: number;
  kind: string;
  subject: string | null;
  title: string;
  body: string | null;
  created_at: string;
  read_at: string | null;
}

export interface StaffNotificationsResponse {
  unread: number;
  items: StaffNotificationItem[];
}
