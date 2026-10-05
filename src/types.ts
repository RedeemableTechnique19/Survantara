export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  JWT_SECRET: string;
  BOOTSTRAP_TOKEN: string;
  SURVEILLANCE_MANAGER_EMAIL?: string;
  AUTH_ISSUER?: string;
  SBM_ALLOWANCE_AMOUNT?: string;
  // Dedicated bearer token for the local SKD-KLB synchronization client. It
  // has access only to the allowlisted integration routes in integration.ts.
  SKDKLB_INTEGRATION_TOKEN?: string;
  // Separate least-privilege secret for one-way, aggregate-only public
  // surveillance snapshots published manually by the local SKD-KLB app.
  SKDKLB_PUBLICATION_TOKEN?: string;
  // Dedicated AES-GCM key material for local-only patient identity. JWT_SECRET
  // remains a rollout-safe fallback until this secret is configured.
  PATIENT_DATA_KEY?: string;
  // Optional Telegram alerting. Immediate reports persist delivery state; when
  // either value is absent they are marked UNCONFIGURED for staff follow-up.
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export type Role = 'ADMIN' | 'VERIFIKATOR' | 'PETUGAS_PROGRAM' | 'PIMPINAN' | 'VIEWER';

export type StaffSession = {
  kind: 'staff';
  sessionId: string;
  userId: string;
  email: string;
  role: Role;
  program?: string;
  sessionVersion: number;
  exp: number;
};

export type CadreSession = {
  kind: 'cadre';
  sessionId: string;
  reporterId: string;
  cadreCode: string;
  sessionVersion: number;
  exp: number;
};

export type RoutineSession = {
  kind: 'routine';
  sessionId: string;
  sourceId: string;
  sourceCode: string;
  sourceType: 'FASKES' | 'SEKOLAH';
  sessionVersion: number;
  exp: number;
};

export type Session = StaffSession | CadreSession | RoutineSession;

export type Report = Record<string, unknown>;

// Allowed status transitions for reports. The backend is the sole authority;
// the SPA fetches the valid next-states from the report detail response so the
// two never drift.
export const REPORT_TRANSITIONS: Record<string, string[]> = {
  BARU: ['DITERIMA', 'DITOLAK'],
  DITERIMA: ['SEDANG_DIVERIFIKASI', 'MEMERLUKAN_INFORMASI', 'DITOLAK'],
  // TERVERIFIKASI is reached only through the verification endpoint, which
  // requires an official EBS classification and records the verification.
  SEDANG_DIVERIFIKASI: ['MEMERLUKAN_INFORMASI', 'DUPLIKAT', 'DITOLAK'],
  MEMERLUKAN_INFORMASI: ['SEDANG_DIVERIFIKASI', 'DITOLAK'],
  TERVERIFIKASI: ['TERKAIT_EVENT', 'SELESAI', 'DUPLIKAT'],
  TERKAIT_EVENT: ['SELESAI', 'DUPLIKAT'],
  DUPLIKAT: [],
  DITOLAK: [],
  SELESAI: [],
};

// Allowed status transitions for events, mirroring REPORT_TRANSITIONS. Closing
// states (SELESAI/DIBATALKAN) are terminal and stamp events.closed_at.
export const EVENT_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['AKTIF', 'DIBATALKAN'],
  AKTIF: ['SELESAI', 'DIBATALKAN'],
  SELESAI: [],
  DIBATALKAN: [],
};

export const EVENT_CLOSED_STATUSES = ['SELESAI', 'DIBATALKAN'];

export const PERMISSIONS: Record<Role, string[]> = {
  ADMIN: ['*'],
  VERIFIKATOR: ['REPORT_READ', 'REPORT_VERIFY', 'DASHBOARD_READ', 'IBS_REVIEW'],
  PETUGAS_PROGRAM: ['REPORT_READ', 'DASHBOARD_READ'],
  PIMPINAN: ['REPORT_READ', 'DASHBOARD_READ'],
  VIEWER: ['REPORT_READ', 'DASHBOARD_READ'],
};

export function roleHasPermission(role: Role, permission: string): boolean {
  const allowed = PERMISSIONS[role];
  return allowed.includes('*') || allowed.includes(permission);
}
