import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyIdentityClient } from '../identity-preflight.mjs';
const tenant = { id: 'test-company', issuer: 'https://sso.example/realm', clientIdEnv: 'TEST_CLIENT' };
const env = { TEST_CLIENT: 'report-portal' }, origin = 'https://portal.example';
const discovery = () => Response.json({ issuer: tenant.issuer,
  authorization_endpoint: `${tenant.issuer}/auth`, code_challenge_methods_supported: ['S256'] });
test('deployment stops before AWS writes when client is missing or callback rejected', async () => {
  await assert.rejects(verifyIdentityClient(tenant, {}, origin), /setup incomplete/);
  await assert.rejects(verifyIdentityClient(tenant, env, origin, async url => String(url).includes('well-known')
    ? discovery() : new Response('Client not found', { status: 400 })), /not registered/);
});
test('registered provider must return the exact callback and matching state without a session', async () => {
  const result = await verifyIdentityClient(tenant, env, origin, async url => {
    if (String(url).includes('well-known')) return discovery();
    const auth = new URL(url);
    assert.equal(auth.searchParams.get('prompt'), 'none');
    assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    const callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), error: 'login_required' });
    return new Response(null, { status: 302, headers: { location: callback.href } });
  });
  assert.equal(result.callbackValidated, true);
});
test('wrong redirect domain or issuer is rejected', async () => {
  await assert.rejects(verifyIdentityClient(tenant, env, origin, async url => {
    if (String(url).includes('well-known')) return discovery();
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/callback?error=login_required' } });
  }), /callback validation failed/);
  await assert.rejects(verifyIdentityClient(tenant, env, origin, async () => Response.json({
    issuer: 'https://evil.example', code_challenge_methods_supported: ['S256'],
  })), /Unexpected issuer/);
});
const cognito = {id:'pilot',provider:'cognito',region:'us-east-1',userPoolId:'us-east-1_test',issuer:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test',authorizationOrigin:'https://test.auth.us-east-1.amazoncognito.com',clientIdEnv:'TEST_CLIENT'};
function cognitoFetch({wrongCallback=false,wrongHost=false}={}) {return async url=>{
  const u=new URL(url);
  if(u.pathname.endsWith('openid-configuration'))return Response.json({issuer:cognito.issuer,authorization_endpoint:`${cognito.authorizationOrigin}/oauth2/authorize`});
  if(u.pathname==='/login')return new Response('<input type="password">');
  u.pathname='/login';if(wrongCallback)u.searchParams.set('redirect_uri','https://evil.example');if(wrongHost)u.hostname='evil.example';
  return new Response(null,{status:302,headers:{location:u.href}});
};}
test('classic Cognito accepts S256 without discovery advertisement and verifies login redirect',async()=>{
 const result=await verifyIdentityClient(cognito,env,origin,cognitoFetch());assert.equal(result.callbackValidated,true);assert.equal(result.authenticated,false);
});
test('Cognito rejects substituted callback or login host',async()=>{
 await assert.rejects(verifyIdentityClient(cognito,env,origin,cognitoFetch({wrongCallback:true})),/callback validation failed/);
 await assert.rejects(verifyIdentityClient(cognito,env,origin,cognitoFetch({wrongHost:true})),/callback validation failed/);
});
