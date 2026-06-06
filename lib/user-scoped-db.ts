import type { Request } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb, createUserScopedDbFromJwt } from '../db/client';

export function bearerTokenFromRequest(req: Request): string {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

export function shouldUseUserScopedDb(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.SUPABASE_RLS_USER_CLIENT || '');
}

export function userDataDbForRequest(req: Request): SupabaseClient {
  if (!shouldUseUserScopedDb()) {
    return adminDb;
  }
  return createUserScopedDbFromJwt(bearerTokenFromRequest(req));
}
