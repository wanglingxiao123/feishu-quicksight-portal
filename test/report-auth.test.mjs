import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import { once } from 'node:events';
import { automaticLockKey } from '../automatic-identity.mjs';
import { randomUUID } from 'node:crypto';
import { mountReportRoutes } from '../report-routes.mjs';
import { approvedClaims, makeReportSession, validReportSession, validPending } from '../report-session.mjs';

const tenant = {
  id: 'company-a', label: 'Company A', issuer: 'https://sso-a.example', pilotLogin: 'alice',
  pilotUserArn: 'arn:aws:quicksight:us-east-1:111111111111:user/default/reader/alice',
};
const other = { ...tenant, id: 'company-b', label: 'Company B', issuer: 'https://sso-b.example',
  pilotUserArn: tenant.pilotUserArn.replace('111111111111', '222222222222') };
const bindingFor = t => ({ enabled: true, tenantId: t.id, issuer: t.issuer, subject: `subject-${t.id}`,
  quickSightUserArn: t.pilotUserArn, name: 'Alice' });

async function harness(t) {
  const app = express(), store = new session.MemoryStore();
  app.use(express.json());
  app.use(session({ secret: randomUUID(), resave: false, saveUninitialized: false, store }));
  const sessions = new Map(), bindings = new Map(), attempts = new Map(), locks = new Map();
  let directory = [];
  let liveUser;
  const calls = { search: [], embed: [], begin: [], finish: 0 };
  let rejected = false, disabled = false, badClaims, inactive = false;
  const save = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
  const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
  app.get('/test/enter', (req, res) => {
    req.session.user = { openId: 'permitted-feishu-user' }; req.session.csrf = 'test-csrf';
    sessions.set('id', req.sessionID); res.json({ csrfToken: req.session.csrf });
  });
  const gate = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'gate' });
  const csrf = (req, res, next) => req.get('X-CSRF-Token') === req.session.csrf
    && req.get('origin') === 'https://portal.example' ? next() : res.sendStatus(403);
  mountReportRoutes(app, {
    tenants: [tenant, other], ready: () => !disabled, origin: () => 'https://portal.example',
    gate, csrf, save, regenerate,
    provider: {
      async begin(current, options) {
        calls.begin.push({ tenant: current.id, ...options });
        const state = randomUUID();
        return { transaction: { state, nonce: randomUUID(), verifier: randomUUID() }, url: `https://sso.example/auth?state=${state}` };
      },
      async finish(current) {
        calls.finish++;
        if (rejected) throw Error('Invalid ID token signature');
        return badClaims || { iss: current.issuer, sub: `subject-${current.id}`, preferred_username: 'alice' };
      },
    },
    readBinding: async id => bindings.get(id),
    createBinding: async (id, binding) => { if (!bindings.has(id)) bindings.set(id, binding); },
    createAutomaticBinding: async (id,binding) => {
      if(bindings.has(id)||locks.has(automaticLockKey(binding)))return;
      bindings.set(id,binding);locks.set(automaticLockKey(binding),id);
    },
    listUsers: async () => directory,
    describeUser: async current => liveUser || ({ Arn: current.pilotUserArn, Active: !inactive }),
    searchDashboards: async (current, binding) => {
      calls.search.push({ tenant: current.id, arn: binding.quickSightUserArn });
      return [{ id: `${current.id}${current.mappingId ? '-'+current.mappingId : ''}-dashboard`, name: `${current.label} private dashboard` }];
    },
    createEmbed: async (current, binding, id) => {
      calls.embed.push({ tenant: current.id, arn: binding.quickSightUserArn, id });
      return `https://quicksight.example/embed/${randomUUID()}`;
    },
    saveAttempt: async (state, sid) => attempts.set(state, sid),
    consumeAttempt: async (state, sid) => {
      if (attempts.get(state) !== sid) return false;
      attempts.delete(state); return true;
    },
    deleteAttempt: async state => attempts.delete(state),
  });
  app.use((err, req, res, next) => res.status(500).json({ error: err.name }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie = '', token;
  const request = async (path, method = 'GET', headers = {}) => {
    const res = await fetch(origin + path, { method, redirect: 'manual', headers: {
      cookie, origin: 'https://portal.example', ...(token ? { 'X-CSRF-Token': token } : {}), ...headers,
    } });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    const text = await res.text(); let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (body.csrfToken) token = body.csrfToken;
    return { status: res.status, body, location: res.headers.get('location') };
  };
  const login = async (id = tenant.id) => {
    await request('/test/enter');
    const start = await request(`/auth/report/start?tenant=${id}`);
    assert.equal(start.status, 302);
    const state = new URL(start.location).searchParams.get('state');
    const callback = await request(`/auth/report/callback?code=test-code&state=${state}`);
    return { start, callback, state };
  };
  return { request, login, calls, bindings, attempts, directory:users=>{directory=users;},liveUser:u=>{liveUser=u;},
    async expire() {
      const values = await new Promise((resolve, reject) => store.all((e, result) => e ? reject(e) : resolve(result)));
      for (const [sid, data] of Object.entries(values)) {
        if (!data.report) continue;
        data.report.expiresAt = Date.now() - 1000;
        await new Promise((resolve, reject) => store.set(sid, data, e => e ? reject(e) : resolve()));
      }
    },
    reject: () => { rejected = true; }, disable: () => { disabled = true; },
    inactive: () => { inactive = true; }, claims: c => { badClaims = c; },
  };
}

test('Feishu admission alone never returns a QuickSight identity or dashboard catalog', async t => {
  const h = await harness(t);
  assert.equal((await h.request('/api/access')).status, 401);
  await h.request('/test/enter');
  assert.equal((await h.request('/api/access')).status, 200);
  assert.equal((await h.request('/api/me')).status, 401);
  assert.equal((await h.request('/api/dashboards?account=company-a')).status, 401);
  assert.equal((await h.request('/api/dashboards/company-a-dashboard/embed', 'POST')).status, 401);
  assert.equal(h.calls.search.length, 0);
  assert.equal(h.calls.embed.length, 0);
});
test('SSO callback binds verified subject, account and user; lists and embeds only that identity', async t => {
  const h = await harness(t); const { callback } = await h.login();
  assert.equal(callback.location, '/');
  const me = await h.request('/api/me'); assert.equal(me.status, 200);
  assert.equal(me.body.account, tenant.label); assert.equal(me.body.quickSightUsername, 'reader/alice');
  assert.equal((await h.request('/api/dashboards')).body.dashboards[0].id, 'company-a-dashboard');
  const first = await h.request('/api/dashboards/company-a-dashboard/embed', 'POST');
  const second = await h.request('/api/dashboards/company-a-dashboard/embed', 'POST');
  assert.equal(first.status, 200); assert.notEqual(first.body.embedUrl, second.body.embedUrl);
  assert.ok(h.calls.embed.every(call => call.arn === tenant.pilotUserArn));
});
test('client cannot switch account by query, request body, or an unauthorized dashboard ID', async t => {
  const h = await harness(t); await h.login(); await h.request('/api/me');
  assert.equal((await h.request('/api/dashboards?account=company-b')).status, 400);
  assert.equal((await h.request('/api/dashboards/company-b-dashboard/embed', 'POST')).status, 403);
  assert.equal(h.calls.embed.length, 0);
});
test('explicit account switch clears old authorization and requires a fresh verified callback', async t => {
  const h = await harness(t); await h.login(); await h.request('/api/me');
  assert.equal((await h.request('/auth/report/clear', 'POST')).status, 200);
  assert.equal((await h.request('/api/me')).status, 401);
  assert.equal((await h.request('/api/dashboards')).status, 401);
  const start = await h.request('/auth/report/start?tenant=company-b');
  assert.equal(h.calls.begin.at(-1).forceLogin, true);
  const state = new URL(start.location).searchParams.get('state');
  await h.request(`/auth/report/callback?state=${state}&code=test`);
  assert.equal((await h.request('/api/me')).body.tenantId, 'company-b');
  assert.equal((await h.request('/api/dashboards')).body.dashboards[0].id, 'company-b-dashboard');
});
test('cross-site or missing CSRF cannot clear a report session or mint an embed URL', async t => {
  const h = await harness(t); await h.login(); await h.request('/api/me');
  assert.equal((await h.request('/auth/report/clear', 'POST', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await h.request('/api/dashboards/company-a-dashboard/embed', 'POST', { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await h.request('/api/me')).status, 200);
});
test('callback cannot be replayed and invalid state never exchanges an authorization code', async t => {
  const h = await harness(t); const { state } = await h.login();
  const count = h.calls.finish;
  await h.request(`/auth/report/callback?state=${state}&code=replay`);
  assert.equal(h.calls.finish, count);
  assert.equal((await h.request('/api/me')).status, 401);
});
test('unverified token, wrong issuer, and wrong principal never become a report identity', async t => {
  for (const variant of ['signature', 'issuer', 'principal']) {
    await t.test(variant, async t => {
      const h = await harness(t);
      if (variant === 'signature') h.reject();
      else h.claims({ iss: variant === 'issuer' ? other.issuer : tenant.issuer,
        sub: 'subject-company-a', preferred_username: variant === 'principal' ? 'mallory' : 'alice' });
      const { callback } = await h.login();
      assert.ok(callback.location.includes('login_error='));
      assert.equal((await h.request('/api/dashboards')).status, 401);
      assert.equal(h.bindings.size, 0);
    });
  }
});
test('disabled binding, changed subject, or inactive QuickSight user cannot gain access', async t => {
  const h = await harness(t); h.inactive(); await h.login();
  assert.equal((await h.request('/api/me')).status, 401);
  assert.equal(h.bindings.size, 0);
  const j = await harness(t); j.bindings.set(tenant.id, { ...bindingFor(tenant), subject: 'old-subject' });
  await j.login(); assert.equal((await j.request('/api/me')).status, 401);
  const k = await harness(t); await k.login(); k.bindings.get(tenant.id).enabled = false;
  assert.equal((await k.request('/api/dashboards')).status, 401);
});
test('unconfigured SSO fails closed, without falling back to a static catalog', async t => {
  const h = await harness(t); h.disable(); await h.request('/test/enter');
  assert.equal((await h.request('/auth/report/start?tenant=company-a')).status, 503);
  assert.equal((await h.request('/api/dashboards')).status, 401);
  assert.equal(h.calls.begin.length, 0);
});
test('expired report identity can restart login instead of redirecting in a loop', async t => {
  const h = await harness(t); await h.login(); await h.expire();
  assert.equal((await h.request('/api/me')).status, 401);
  assert.equal((await h.request('/api/dashboards')).status, 401);
  const start = await h.request('/auth/report/start?tenant=company-a');
  assert.equal(new URL(start.location).origin, 'https://sso.example');
});
test('switching abandons an in-flight callback and destroys its one-use transaction', async t => {
  const h = await harness(t); await h.request('/test/enter');
  const start = await h.request('/auth/report/start?tenant=company-a');
  const state = new URL(start.location).searchParams.get('state');
  await h.request('/api/access');
  assert.equal(h.attempts.has(state), true);
  await h.request('/auth/report/clear', 'POST');
  assert.equal(h.attempts.has(state), false);
  await h.request(`/auth/report/callback?state=${state}&code=abandoned`);
  assert.equal(h.calls.finish, 0);
  assert.equal((await h.request('/api/me')).status, 401);
});
test('expiry, legacy sessions and cross-account bindings fail authorization', () => {
  const b = bindingFor(tenant), r = makeReportSession(tenant, b, 1000);
  assert.equal(validReportSession(tenant, b, r, 1000), true);
  for (const bad of [{ ...r, expiresAt: 1000 }, { ...r, tenantId: other.id }, { ...r, userArn: other.pilotUserArn },
    { ...r, subject: 'different' }, { ...r, version: 1 }, { name: 'Feishu', openId: '123' }]) {
    assert.equal(validReportSession(tenant, b, bad, 1000), false);
  }
  assert.equal(validPending({ state: 'ok', createdAt: 0 }, 'ok', 600_000), false);
  assert.equal(validPending({ state: 'ok', createdAt: 1001 }, 'ok', 1000), false);
  assert.equal(approvedClaims(tenant, { iss: tenant.issuer, sub: 'x', email: 'alice' }), false);
});

test('Cognito pilot binding requires ID token and exact native username', async () => {
 const {approvedClaims}=await import('../report-session.mjs');
 const t={provider:'cognito',issuer:'https://cognito.example/pool',pilotLogin:'workshop-admin'};
 const c={iss:t.issuer,sub:'confirmed-subject',token_use:'id','cognito:username':'workshop-admin'};
 assert.equal(approvedClaims(t,c),true);
 assert.equal(approvedClaims(t,{...c,token_use:'access'}),false);
 assert.equal(approvedClaims(t,{...c,'cognito:username':'other',preferred_username:'workshop-admin'}),false);
 assert.equal(approvedClaims(t,{...c,iss:'https://other.example'}),false);
});


test('two mapped identities receive separate bindings and cannot embed each other dashboards', async t => {
  tenant.identityMappings = [
    {id:'alice',login:'alice',quickSightUserArn:tenant.pilotUserArn},
    {id:'bob',login:'bob',quickSightUserArn:tenant.pilotUserArn.replace('reader/alice','reader/bob')},
  ];
  t.after(()=>{delete tenant.identityMappings;});
  const h=await harness(t);
  assert.equal((await h.login()).callback.location,'/');
  assert.equal((await h.request('/api/dashboards')).body.dashboards[0].id,'company-a-alice-dashboard');
  const aliceArn=(await h.request('/api/me')).body.quickSightUsername;
  await h.request('/auth/report/clear','POST');
  h.claims({iss:tenant.issuer,sub:'subject-bob',preferred_username:'bob'});
  assert.equal((await h.login()).callback.location,'/');
  assert.equal((await h.request('/api/dashboards')).body.dashboards[0].id,'company-a-bob-dashboard');
  assert.notEqual((await h.request('/api/me')).body.quickSightUsername,aliceArn);
  assert.equal((await h.request('/api/dashboards/company-a-alice-dashboard/embed','POST')).status,403);
  assert.equal((await h.request('/api/dashboards/company-a-bob-dashboard/embed','POST')).status,200);
  assert.equal(h.bindings.size,2);
  assert.equal(h.bindings.get('company-a#bob').subject,'subject-bob');
  tenant.identityMappings[1].enabled=false;
  assert.equal((await h.request('/api/me')).status,401);
});


test('automatic first login persists identity and serves the matched user only, with manual pilot unchanged',async t=>{
 tenant.autoBinding={enabled:true,namespace:'default',allowedEmailDomains:['example.com']};
 tenant.accountId='111111111111';tenant.region='us-east-1';
 t.after(()=>{delete tenant.autoBinding;delete tenant.accountId;delete tenant.region;});
 const h=await harness(t);
 assert.equal((await h.login()).callback.location,'/'); // Existing explicit pilot still works.
 await h.request('/api/me');
 await h.request('/auth/report/clear','POST');
 const user={Arn:tenant.pilotUserArn.replace('reader/alice','reader/bob'),PrincipalId:'principal-bob',Email:'bob@example.com',Active:true};
 h.directory([user]);h.liveUser(user);h.claims({iss:tenant.issuer,sub:'subject-new-bob',email:'bob@example.com',email_verified:true,preferred_username:'bob'});
 assert.equal((await h.login()).callback.location,'/');
 assert.equal((await h.request('/api/me')).body.quickSightUsername,'reader/bob');
 await h.request('/api/dashboards');assert.equal(h.calls.search.at(-1).arn,user.Arn);
 assert.equal((await h.request('/api/dashboards/company-a-dashboard/embed','POST')).status,403);
 h.liveUser({...user,PrincipalId:'recreated-user'});
 assert.equal((await h.request('/api/me')).status,401);
});
