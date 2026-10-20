import { automaticTransaction } from './automatic-identity.mjs';
import { mayEnter } from './access-policy.mjs';
import { config } from 'dotenv';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mountReportRoutes } from './report-routes.mjs';
import { createReportServices } from './report-services.mjs';
import { validateTenant } from './portal-policy.mjs';

config({ override: true, quiet: true });
export const app = express();
const env = process.env;
const tenants = JSON.parse(await readFile(new URL('./tenants.json', import.meta.url), 'utf8')).map(t => {
  const tenant = { ...t, issuer: (t.issuerEnv && env[t.issuerEnv]) || t.issuer };
  if (tenant.issuer) validateTenant(tenant);
  return tenant;
});
const db = env.STATE_TABLE ? DynamoDBDocumentClient.from(new DynamoDBClient({ region: env.AWS_REGION })) : null;
const dataPath = new URL('./data/', import.meta.url);
if (!db) await mkdir(dataPath, { recursive: true, mode: 0o700 });
let owner;
async function readOwner() {
  if (db) return (await db.send(new GetCommand({ TableName: env.STATE_TABLE, Key: { pk: 'OWNER' }, ConsistentRead: true }))).Item?.identity;
  return JSON.parse(await readFile(new URL('owner.json', dataPath), 'utf8'));
}
async function createOwner(identity) {
  if (db) return db.send(new PutCommand({
    TableName: env.STATE_TABLE, Item: { pk: 'OWNER', identity },
    ConditionExpression: 'attribute_not_exists(pk)',
  }));
  return writeFile(new URL('owner.json', dataPath), JSON.stringify(identity, null, 2), { mode: 0o600, flag: 'wx' });
}
try { owner = await readOwner(); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!db && tenants.some(t => t.autoBinding?.enabled)) throw Error('Automatic identity requires persistent DynamoDB state');
if (!env.SESSION_SECRET || !env.FEISHU_APP_SECRET) throw Error('Missing server credentials');
const origin = () => {
  const value = env.PUBLIC_ORIGIN;
  if (!value || new URL(value).protocol !== 'https:') throw Error('PUBLIC_ORIGIN must be HTTPS');
  return new URL(value).origin;
};
const reportServices = createReportServices(env, origin);
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));
app.disable('x-powered-by');
// Cloud traffic arrives through the existing API Gateway; local preview binds to loopback.
app.set('trust proxy', env.STATE_TABLE ? 1 : 'loopback');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    frameSrc: ['https://*.quicksight.aws.amazon.com'],
    frameAncestors: ["'self'", 'https://*.feishu.cn'],
    upgradeInsecureRequests: null,
  } },
  frameguard: false,
  referrerPolicy: { policy: 'no-referrer' },
}));
app.use(express.json({ limit: '8kb' }));
class DynamoSessionStore extends session.Store {
  get(sid, cb) {
    db.send(new GetCommand({ TableName: env.STATE_TABLE, Key: { pk: `SESSION#${sid}` }, ConsistentRead: true }))
      .then(r => cb(null, r.Item && r.Item.expiresAt > Date.now() / 1000 ? r.Item.session : null)).catch(cb);
  }
  set(sid, data, cb) {
    db.send(new PutCommand({ TableName: env.STATE_TABLE, Item: {
      pk: `SESSION#${sid}`, session: JSON.parse(JSON.stringify(data)),
      expiresAt: Math.ceil((data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 8 * 3600_000) / 1000),
    } })).then(() => cb?.()).catch(cb);
  }
  destroy(sid, cb) {
    db.send(new DeleteCommand({ TableName: env.STATE_TABLE, Key: { pk: `SESSION#${sid}` } })).then(() => cb?.()).catch(cb);
  }
}
app.use(session({
  name: '__Host-qsportal',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  ...(db ? { store: new DynamoSessionStore() } : {}),
  cookie: { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600_000, path: '/' },
}));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/auth', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const saveSession = req => new Promise((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
const feishu = async (path, options = {}) => {
  const res = await fetch(`https://open.feishu.cn/open-apis/${path}`, {
    ...options, signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  if (!res.ok || (body.code !== undefined && body.code !== 0)) {
    const error = new Error(`Feishu API failed (${body.code ?? res.status})`);
    error.name = 'FeishuApiError';
    throw error;
  }
  return body;
};
app.get('/healthz', (_req, res) => res.json({ ok: true, version: '0.2.1', mode: 'verified-report-identity' }));
app.get('/auth/enroll/:token', async (req, res) => {
  if (db) owner = await readOwner();
  if (owner || !safeEqual(req.params.token, env.ENROLLMENT_TOKEN)) return res.sendStatus(404);
  req.session.enrolling = true;
  await saveSession(req);
  res.redirect('/auth/start');
});
app.get('/auth/start', async (req, res) => {
  const requestedTenant = req.query.report_account;
  if (requestedTenant !== undefined) {
    const tenant = tenants.find(t => t.id === requestedTenant);
    if (!tenant || !reportServices.ready(tenant)) return res.status(400).send('此企业账号的登录尚未启用。');
    req.session.requestedReportTenant = tenant.id;
  } else delete req.session.requestedReportTenant;
  if (db) owner = await readOwner();
  if (!owner && !req.session.enrolling) {
    return res.status(403).send('测试尚未开放，请使用管理员的首次登录链接。');
  }
  req.session.oauthState = randomBytes(32).toString('hex');
  req.session.oauthCreatedAt = Date.now();
  const url = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  url.search = new URLSearchParams({
    app_id: env.FEISHU_APP_ID,
    redirect_uri: `${origin()}/auth/callback`,
    state: req.session.oauthState,
  }).toString();
  await saveSession(req);
  res.redirect(url.href);
});
app.get('/auth/callback', async (req, res) => {
  if (!safeEqual(req.query.state, req.session.oauthState)
    || Date.now() - req.session.oauthCreatedAt > 10 * 60_000
    || typeof req.query.code !== 'string') return res.status(400).send('登录请求已失效，请重新登录。');
  const enrolling = req.session.enrolling === true;
  const requestedReportTenant = req.session.requestedReportTenant;
  delete req.session.oauthState;
  delete req.session.oauthCreatedAt;
  delete req.session.enrolling;
  delete req.session.requestedReportTenant;
  await saveSession(req);
  const token = await feishu('authen/v2/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code', client_id: env.FEISHU_APP_ID,
      client_secret: env.FEISHU_APP_SECRET, code: req.query.code,
      redirect_uri: `${origin()}/auth/callback`,
    }),
  });
  const userResponse = await feishu('authen/v1/user_info', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const user = userResponse.data;
  if (!user?.open_id || !user?.tenant_key) throw Error('Incomplete Feishu identity');
  const identity = {
    openId: user.open_id, tenantKey: user.tenant_key,
    name: user.name,
  };
  if (db) owner = await readOwner();
  if (!owner && enrolling) {
    // Exclusive creation prevents concurrent first-login requests from replacing the owner.
    try {
      await createOwner(identity);
      owner = identity;
    } catch (error) {
      if (error.code !== 'EEXIST' && error.name !== 'ConditionalCheckFailedException') throw error;
      owner = await readOwner();
    }
  }
  if (!mayEnter(owner, identity, env.FEISHU_ACCESS_MODE || 'tester')) {
    await regenerate(req);
    return res.status(403).send('当前飞书身份未获准使用此应用，请联系应用管理员。');
  }
  await regenerate(req);
  req.session.user = identity;
  req.session.csrf = randomBytes(24).toString('hex');
  await saveSession(req);
  res.redirect(requestedReportTenant
    ? `/auth/report/start?tenant=${encodeURIComponent(requestedReportTenant)}` : '/');
});
const authorized = async (req, res, next) => {
  if (db) owner = await readOwner();
  if (!mayEnter(owner, req.session.user, env.FEISHU_ACCESS_MODE || 'tester')) return res.status(401).json({ error: '请先进入应用。' });
  next();
};
const csrf = (req, res, next) => {
  if (req.get('origin') !== origin() || !safeEqual(req.get('x-csrf-token'), req.session.csrf)) return res.sendStatus(403);
  next();
};
const localAttempts = new Map();
mountReportRoutes(app, {
  tenants, origin, gate: authorized, csrf, save: saveSession, regenerate,
  ...reportServices,
  async readBinding(tenantId) {
    if (db) return (await db.send(new GetCommand({
      TableName: env.STATE_TABLE, Key: { pk: `REPORT_IDENTITY#${tenantId}` }, ConsistentRead: true,
    }))).Item?.identity;
    try { return JSON.parse(await readFile(new URL(`report-identity-${encodeURIComponent(tenantId)}.json`, dataPath), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  },
  async createAutomaticBinding(identityKey, identity) {
    if (db) {
      try { await db.send(new TransactWriteCommand({TransactItems:automaticTransaction(env.STATE_TABLE,identityKey,identity)})); }
      catch(e) { if(e.name !== 'TransactionCanceledException')throw e; }
      return;
    }
    throw Error('Automatic identity requires persistent DynamoDB state');
  },
  async createBinding(tenantId, identity) {
    try {
      if (db) await db.send(new PutCommand({
        TableName: env.STATE_TABLE, Item: { pk: `REPORT_IDENTITY#${tenantId}`, identity },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      else await writeFile(new URL(`report-identity-${encodeURIComponent(tenantId)}.json`, dataPath),
        JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
    } catch (e) {
      if (e.name !== 'ConditionalCheckFailedException' && e.code !== 'EEXIST') throw e;
    }
  },
  async saveAttempt(state, sessionId) {
    const attempt = { sessionId, expiresAt: Math.floor(Date.now() / 1000) + 600 };
    if (db) await db.send(new PutCommand({
      TableName: env.STATE_TABLE, Item: { pk: `REPORT_LOGIN#${state}`, ...attempt },
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
    else localAttempts.set(state, attempt);
  },
  async deleteAttempt(state) {
    if (db) await db.send(new DeleteCommand({ TableName: env.STATE_TABLE, Key: { pk: `REPORT_LOGIN#${state}` } }));
    else localAttempts.delete(state);
  },
  async consumeAttempt(state, sessionId) {
    if (db) {
      try {
        await db.send(new DeleteCommand({
          TableName: env.STATE_TABLE, Key: { pk: `REPORT_LOGIN#${state}` },
          ConditionExpression: 'sessionId = :sid AND expiresAt > :now',
          ExpressionAttributeValues: { ':sid': sessionId, ':now': Math.floor(Date.now() / 1000) },
        }));
        return true;
      } catch (e) { if (e.name === 'ConditionalCheckFailedException') return false; throw e; }
    }
    const value = localAttempts.get(state);
    if (!value || value.sessionId !== sessionId || value.expiresAt <= Date.now() / 1000) return false;
    localAttempts.delete(state); return true;
  },
});
app.post('/auth/logout', authorized, csrf, (req, res) => req.session.destroy(error => {
  if (error) return res.status(500).json({ error: '退出未完成，请重试。' });
  res.clearCookie('__Host-qsportal', { path: '/', secure: true, sameSite: 'lax', httpOnly: true });
  res.sendStatus(204);
}));
app.use(express.static(new URL('./public/', import.meta.url).pathname, { etag: false, maxAge: 0 }));
app.use((error, _req, res, _next) => {
  // Never log OAuth codes, tokens, embed URLs or session cookies.
  console.error(JSON.stringify({ error: error.name, requestId: error.$metadata?.requestId }));
  res.status(502).json({ error: '服务暂时无法完成请求，请重试或联系应用管理员。', type: error.name });
});
if (!env.AWS_LAMBDA_FUNCTION_NAME) {
  app.listen(Number(env.PORT ?? 4317), '127.0.0.1', () => console.log('Portal listening on loopback'));
}
