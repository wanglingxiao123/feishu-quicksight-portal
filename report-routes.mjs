import { resolvedAutomaticTenant, resolveAutomaticLogin, automaticUserMatches, IdentityLinkError } from './automatic-identity.mjs';
import { resolvedTenant, identityStorageKey } from './access-policy.mjs';
import {
  selectIdentityTenant, equal, makeReportSession, newCsrf, publicReportIdentity,
  validPending, validReportSession,
} from './report-session.mjs';

// Dependencies are injected so authentication and account isolation can be tested without live credentials.
export function mountReportRoutes(app, {
  tenants, ready, origin, gate, csrf, save, regenerate, provider,
  readBinding, createBinding, searchDashboards, createEmbed, describeUser, listUsers, createAutomaticBinding,
  saveAttempt, consumeAttempt, deleteAttempt,
}) {
  const byId = new Map(tenants.map(t => [t.id, t]));
  const reservedArns = () => tenants.flatMap(t=>[t.pilotUserArn,...(t.identityMappings||[]).map(m=>m.quickSightUserArn)]).filter(Boolean);
  const clearReport = async req => {
    if (req.session.pendingReportLogin) await deleteAttempt(req.session.pendingReportLogin.state);
    const user = req.session.user;
    await regenerate(req);
    req.session.user = user; // Retain the app tester gate, never the old report identity.
    req.session.csrf = newCsrf();
    await save(req);
  };
  const resolveSession = async session => {
    const base = byId.get(session?.tenantId);
    if (!base || !ready(base)) return {};
    if (/^auto-[a-f0-9]{64}$/.test(session.mappingId || '')) {
      const binding = await readBinding(`${base.id}#${session.mappingId}`);
      if (reservedArns().includes(binding?.quickSightUserArn)) return {};
      const tenant = resolvedAutomaticTenant(base, session.mappingId, binding);
      if (!tenant || !automaticUserMatches(base, binding, await describeUser(tenant))) return {};
      return {tenant,binding};
    }
    const tenant = resolvedTenant(base, session.mappingId);
    const binding = tenant ? await readBinding(identityStorageKey(tenant)) : undefined;
    if (!validReportSession(tenant, binding, session)) return {};
    const user = await describeUser(tenant);
    if (user?.Arn !== tenant.pilotUserArn || user.Active !== true
      || (binding.quickSightPrincipalId && user.PrincipalId !== binding.quickSightPrincipalId)) return {};
    return {tenant,binding};
  };
  const identity = async (req, res, next) => {
    const {tenant,binding} = await resolveSession(req.session.report);
    if (!validReportSession(tenant, binding, req.session.report)) {
      return res.status(401).json({ code: 'REPORT_LOGIN_REQUIRED', error: '请先登录报表账号。' });
    }
    res.locals.tenant = tenant; res.locals.binding = binding;
    next();
  };
  const failure = async (req, res, reason) => {
    await clearReport(req);
    res.redirect(`/?login_error=${reason}`);
  };
  const loginOptions = () => tenants.map(t => ({ id: t.id, label: t.label, ready: ready(t) }));
  // Only login destinations are public. No user identity, dashboard metadata, or permissions are exposed.
  app.get('/api/login-options', (_req, res) => res.json({ accounts: loginOptions() }));
  app.get('/api/access', gate, (req, res) => res.json({
    csrfToken: req.session.csrf, accounts: loginOptions(),
  }));
  app.get('/api/me', gate, identity, (req, res) => res.json({
    ...publicReportIdentity(res.locals.tenant, res.locals.binding, req.session.report),
    csrfToken: req.session.csrf, mode: 'verified-report-identity',
  }));
  app.get('/auth/report/start', gate, async (req, res) => {
    // Switching is a CSRF-protected POST. This GET may only start an unauthenticated report login.
    if (req.session.report) {
      const {tenant:current,binding} = await resolveSession(req.session.report);
      if (validReportSession(current, binding, req.session.report)) return res.redirect('/');
    }
    const tenant = byId.get(req.query.tenant);
    if (!tenant) return res.status(400).json({ error: '请选择要登录的企业账号。' });
    if (!ready(tenant)) return res.status(503).json({ error: '此企业账号的登录接入尚未完成。' });
    const forceLogin = req.session.forceReportLogin === true;
    await clearReport(req);
    const pending = await provider.begin(tenant, {
      redirectUri: `${origin()}/auth/report/callback`, forceLogin,
    });
    req.session.pendingReportLogin = { ...pending.transaction, tenantId: tenant.id, createdAt: Date.now() };
    await saveAttempt(req.session.pendingReportLogin.state, req.sessionID);
    await save(req);
    res.redirect(pending.url);
  });
  app.get('/auth/report/callback', gate, async (req, res) => {
    const pending = req.session.pendingReportLogin;
    delete req.session.pendingReportLogin;
    await save(req);
    if (!validPending(pending, req.query.state) || typeof req.query.code !== 'string'
      || !await consumeAttempt(pending.state, req.sessionID)) {
      return failure(req, res, 'expired');
    }
    let tenant = byId.get(pending.tenantId);
    if (!tenant || !ready(tenant)) return failure(req, res, 'unavailable');
    let claims;
    try {
      claims = await provider.finish(tenant, new URL(req.originalUrl, origin()), pending);
    } catch {
      return failure(req, res, 'invalid_identity');
    }
    const base = tenant;
    tenant = selectIdentityTenant(base, claims);
    let binding;
    // Explicit mappings remain authoritative, including disabled mappings. No auto fallback for them.
    const explicitlyConfigured = base.identityMappings?.some(m => [claims['cognito:username'],claims.preferred_username,
      ...(claims.email_verified === true ? [claims.email] : [])].includes(m.login));
    if (!tenant && !explicitlyConfigured && base.autoBinding?.enabled) {
      try {
        const result = await resolveAutomaticLogin(base, claims, {readBinding,createAutomaticBinding,listUsers,describeUser,
          reservedArns:reservedArns()});
        tenant=result.tenant; binding=result.binding;
      } catch(e) {
        if(e instanceof IdentityLinkError)return failure(req,res,e.code);
        throw e;
      }
    }
    if (!tenant) return failure(req, res, 'identity_not_mapped');
    binding ||= await readBinding(identityStorageKey(tenant));
    // Recheck existing explicit identities as well as first-time bindings.
    const user = await describeUser(tenant);
    if (user?.Arn !== tenant.pilotUserArn || user.Active !== true
      || (binding?.quickSightPrincipalId && user.PrincipalId !== binding.quickSightPrincipalId)) {
      return failure(req, res, 'not_allowed');
    }
    if (!binding) {
      // Confirm that the explicitly approved enterprise principal is an active QuickSight user.
      const candidate = {
        enabled: true, tenantId: tenant.id, issuer: tenant.issuer, subject: claims.sub,
        quickSightUserArn: user.Arn, name: claims.name || claims.preferred_username || tenant.pilotLogin,
        ...(user.PrincipalId ? {quickSightPrincipalId: user.PrincipalId} : {}),
      };
      await createBinding(identityStorageKey(tenant), candidate);
      binding = await readBinding(identityStorageKey(tenant));
    }
    const report = makeReportSession(tenant, binding);
    if (!equal(binding.subject, claims.sub) || !validReportSession(tenant, binding, report)) {
      return failure(req, res, 'not_allowed');
    }
    await clearReport(req);
    req.session.report = report;
    await save(req);
    res.redirect('/');
  });
  app.post('/auth/report/clear', gate, csrf, async (req, res) => {
    await clearReport(req);
    // Explicit switching asks the IdP to authenticate again instead of silently choosing its old account.
    req.session.forceReportLogin = true;
    await save(req);
    res.json({ csrfToken: req.session.csrf });
  });
  app.get('/api/dashboards', gate, identity, async (req, res) => {
    // The active account is exclusively server-side. Reject legacy selectors instead of silently using them.
    if (Object.keys(req.query).length) return res.status(400).json({ error: '请通过个人中心切换登录账号。' });
    res.json({ dashboards: await searchDashboards(res.locals.tenant, res.locals.binding) });
  });
  app.post('/api/dashboards/:id/embed', gate, identity, csrf, async (req, res) => {
    const { tenant, binding } = res.locals;
    const dashboards = await searchDashboards(tenant, binding);
    if (!dashboards.some(d => d.id === req.params.id)) {
      return res.status(403).json({ error: '当前账号无权查看此报表。' });
    }
    res.json({ embedUrl: await createEmbed(tenant, binding, req.params.id) });
  });
}
