import type { Env, Session } from './types';
import { HttpError } from './http';

export function canManageSurveillance(env: Env, session: Session | null): boolean {
  const configured = env.SURVEILLANCE_MANAGER_EMAIL?.trim().toLowerCase();
  return !!configured && session?.kind === 'staff' && session.role === 'ADMIN'
    && session.email.toLowerCase() === configured;
}

export function allowanceAmount(env: Env): number {
  const amount = Number(env.SBM_ALLOWANCE_AMOUNT ?? '100000');
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError('Nominal OH belum dikonfigurasi dengan benar.', 503);
  return amount;
}
