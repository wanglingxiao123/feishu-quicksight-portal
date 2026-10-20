import { createHash, randomBytes } from 'node:crypto';

export async function verifyIdentityClient(tenant, env, origin, fetcher = fetch) {
  if (!tenant.issuer || !env[tenant.clientIdEnv]) {
    throw Error(`Identity setup incomplete: ${tenant.id}. Register the application callback before deploying.`);
  }
  const discovery = await fetcher(`${tenant.issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!discovery.ok) throw Error(`Identity discovery failed: ${tenant.id}`);
  const config = await discovery.json();
  const cognito = tenant.provider === 'cognito';
  if (cognito && (tenant.issuer !== `https://cognito-idp.${tenant.region}.amazonaws.com/${tenant.userPoolId}`
    || !tenant.authorizationOrigin?.endsWith(`.auth.${tenant.region}.amazoncognito.com`))) {
    throw Error(`Unexpected Cognito configuration: ${tenant.id}`);
  }
  // Cognito supports S256 but doesn't advertise it in discovery metadata.
  if (config.issuer !== tenant.issuer || (!cognito && !config.code_challenge_methods_supported?.includes('S256'))) {
    throw Error(`Unexpected issuer or missing PKCE support: ${tenant.id}`);
  }
  const callback = `${origin}/auth/report/callback`, state = randomBytes(24).toString('hex');
  const url = new URL(config.authorization_endpoint);
  if (url.protocol !== 'https:' || url.origin !== (cognito ? tenant.authorizationOrigin : new URL(tenant.issuer).origin)) {
    throw Error(`Unexpected authorization endpoint: ${tenant.id}`);
  }
  url.search = new URLSearchParams({
    client_id: env[tenant.clientIdEnv], redirect_uri: callback,
    response_type: 'code', scope: 'openid profile email', state,
    nonce: randomBytes(24).toString('hex'), prompt: 'none',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'),
  });
  const result = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const location = result.headers.get('location');
  await result.arrayBuffer();
  if (![302, 303].includes(result.status) || !location) {
    throw Error(`Client or callback is not registered: ${tenant.id}. No deployment performed.`);
  }
  const returned = new URL(location, url);
  // Classic Cognito Hosted UI ignores prompt=none. Validate its login redirect instead.
  if (cognito && returned.origin === tenant.authorizationOrigin && returned.pathname === '/login'
    && ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type']
      .every(key => returned.searchParams.get(key) === url.searchParams.get(key))) {
    const login = await fetcher(returned, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const html = await login.text();
    if (login.status !== 200 || !/type=["']password["']/i.test(html)) {
      throw Error(`Cognito login page unavailable: ${tenant.id}`);
    }
    return { tenant: tenant.id, callbackValidated: true, authenticated: false };
  }
  if (`${returned.origin}${returned.pathname}` !== callback || returned.searchParams.get('state') !== state
    || !['login_required', 'interaction_required', 'consent_required'].includes(returned.searchParams.get('error'))) {
    throw Error(`Identity callback validation failed: ${tenant.id}. No deployment performed.`);
  }
  return { tenant: tenant.id, callbackValidated: true };
}
