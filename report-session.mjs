import { resolvedTenant } from './access-policy.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const REPORT_SESSION_MS = 60 * 60_000;
export const LOGIN_ATTEMPT_MS = 10 * 60_000;
export const REPORT_AUTH_VERSION = 3;
export function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && Buffer.byteLength(a) === Buffer.byteLength(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function approvedClaims(tenant, claims) {
  return typeof tenant.pilotLogin === 'string' && tenant.pilotLogin.length > 0
    && (!tenant.expectedSubject || tenant.expectedSubject === claims?.sub)
    && claims?.iss === tenant.issuer && typeof claims.sub === 'string' && claims.sub.length > 0
    && (tenant.provider === 'cognito'
      ? claims.token_use === 'id' && claims['cognito:username'] === tenant.pilotLogin
      : (claims.preferred_username === tenant.pilotLogin
        || (claims.email_verified === true && claims.email === tenant.pilotLogin)));
}
export function validReportSession(tenant, binding, session, now = Date.now()) {
  return Boolean(tenant && binding && session && session.version === REPORT_AUTH_VERSION
    && session.expiresAt > now && binding.enabled === true
    && session.mappingId === tenant.mappingId
    && (!tenant.expectedSubject || tenant.expectedSubject === session.subject)
    && session.tenantId === tenant.id && binding.tenantId === tenant.id
    && session.issuer === tenant.issuer && binding.issuer === tenant.issuer
    && typeof session.subject === 'string' && session.subject.length > 0
    && session.subject === binding.subject
    && session.userArn === binding.quickSightUserArn && session.userArn === tenant.pilotUserArn);
}
export function makeReportSession(tenant, binding, now = Date.now()) {
  return { version: REPORT_AUTH_VERSION, tenantId: tenant.id, issuer: tenant.issuer,
    mappingId: tenant.mappingId, subject: binding.subject, userArn: binding.quickSightUserArn, expiresAt: now + REPORT_SESSION_MS };
}
export function validPending(pending, state, now = Date.now()) {
  return Boolean(pending && equal(pending.state, state)
    && pending.createdAt <= now && now - pending.createdAt < LOGIN_ATTEMPT_MS);
}
export function newCsrf() { return randomBytes(24).toString('hex'); }

// A report identity is never inferred from Feishu identity, catalog selection, or browser cookies.
export function publicReportIdentity(tenant, binding, session) {
  return { name: binding.name, account: tenant.label, tenantId: tenant.id,
    quickSightUsername: binding.quickSightUserArn.split(':user/')[1]?.split('/').slice(1).join('/'),
    expiresAt: session.expiresAt, identityType: 'verified-enterprise-sso' };
}

export function selectIdentityTenant(tenant, claims) {
  if (!tenant) return undefined;
  if (!tenant.identityMappings?.length) return approvedClaims(tenant, claims) ? tenant : undefined;
  const matches = tenant.identityMappings.map(m => resolvedTenant(tenant, m.id)).filter(t => t && approvedClaims(t, claims));
  return matches.length === 1 ? matches[0] : undefined;
}
