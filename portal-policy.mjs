import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string'
    && Buffer.byteLength(a) === Buffer.byteLength(b)
    && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function validateTenant(tenant) {
  if (!/^[a-z0-9-]+$/.test(tenant.id) || !/^\d{12}$/.test(tenant.accountId)
    || (!tenant.autoBinding?.enabled && !tenant.identityMappings?.length && (typeof tenant.pilotLogin !== 'string' || tenant.pilotLogin.length === 0))
    || !/^[a-z]{2}-[a-z]+-\d$/.test(tenant.region)
    || new URL(tenant.issuer).protocol !== 'https:'
    || (!tenant.useExecutionRole && !tenant.roleArn?.startsWith(`arn:aws:iam::${tenant.accountId}:role/`))
    || (!tenant.autoBinding?.enabled && !tenant.identityMappings?.length && !tenant.pilotUserArn?.startsWith(`arn:aws:quicksight:${tenant.region}:${tenant.accountId}:user/`))) {
    throw Error('Invalid tenant configuration');
  }
  if (tenant.autoBinding && typeof tenant.autoBinding.enabled !== 'boolean') throw Error('Invalid automatic identity flag');
  if (tenant.autoBinding?.enabled) {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(tenant.autoBinding.namespace)
      || !Array.isArray(tenant.autoBinding.allowedEmailDomains)
      || tenant.autoBinding.allowedEmailDomains.some(d=>typeof d!=='string'||d!==d.toLowerCase()||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d))) throw Error('Invalid automatic identity policy');
  }
  if (tenant.identityMappings) {
    const ids = new Set(), logins = new Set();
    for (const m of tenant.identityMappings) {
      if (m.id?.startsWith('auto-') || !/^[a-z0-9-]+$/.test(m.id) || !m.login || ids.has(m.id) || logins.has(m.login)
        || !m.quickSightUserArn?.startsWith(`arn:aws:quicksight:${tenant.region}:${tenant.accountId}:user/`)
        || (m.subject !== undefined && (typeof m.subject !== 'string' || !m.subject))) throw Error('Invalid or duplicate identity mapping');
      ids.add(m.id); logins.add(m.login);
    }
  }
  return tenant;
}
export function isPilotIdentity(tenant, claims) {
  return typeof claims.sub === 'string' && claims.sub.length > 0
    && claims.iss === tenant.issuer
    && (claims.preferred_username === tenant.pilotLogin
      || (claims.email_verified === true && claims.email === tenant.pilotLogin));
}
export function matchesIdentity(tenant, identity, user, now = Date.now()) {
  return !!identity && identity.enabled === true && user?.authVersion === 2
    && typeof user.subject === 'string' && user.subject.length > 0
    && user.tenantId === tenant.id && user.issuer === tenant.issuer
    && user.subject === identity.subject && identity.issuer === tenant.issuer
    && identity.tenantId === tenant.id && user.expiresAt > now
    && identity.quickSightUserArn === tenant.pilotUserArn;
}
export function publicTenant(tenant, env) {
  return { id: tenant.id, label: tenant.label, ready: Boolean(env[tenant.clientIdEnv]) };
}
