import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateConfig,tenantFromConfig } from '../scripts/config.mjs';
import { makeTemplate } from '../scripts/template.mjs';
import { validateTenant } from '../portal-policy.mjs';
const c={stackName:'test-portal',region:'us-east-1',awsAccountId:'111111111111',feishuAppId:'cli_example',runtimeSecretArn:'arn:aws:secretsmanager:us-east-1:111111111111:secret:example',quickSightUserArn:'arn:aws:quicksight:us-east-1:111111111111:user/default/test-reader',accountLabel:'Example',oidc:{provider:'cognito',issuer:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example',userPoolId:'us-east-1_example',authorizationOrigin:'https://example.auth.us-east-1.amazoncognito.com',clientId:'',pilotLogin:'reader',ready:false}};
test('starter validates isolated target and explicitly disabled bootstrap',()=>{
 validateConfig(c);validateTenant(tenantFromConfig(c));
 assert.throws(()=>validateConfig({...c,quickSightUserArn:c.quickSightUserArn.replace('111111111111','222222222222')}),/same deployment account|deployment account/);
 assert.throws(()=>validateConfig({...c,oidc:{...c.oidc,ready:true}}),/clientId/);
});
test('template scopes access and keeps secrets out of plaintext config',()=>{
 const t=makeTemplate(c),r=t.Resources;
 assert.equal(r.StateTable.DeletionPolicy,'Retain');
 assert.equal(r.PortalFunction.Properties.Environment.Variables.REPORT_AUTH_READY,'false');
 assert.match(r.PortalFunction.Properties.Environment.Variables.SESSION_SECRET,/^\{\{resolve:secretsmanager:/);
 const statements=r.PortalRole.Properties.Policies[0].PolicyDocument.Statement;
 const embed=statements.find(s=>s.Action==='quicksight:GenerateEmbedUrlForRegisteredUser');
 assert.equal(embed.Resource,c.quickSightUserArn);
 assert.equal(embed.Condition.Null['quicksight:AllowedEmbeddingDomains'],'false');
 assert.equal(JSON.stringify(statements).includes('GenerateEmbedUrlForAnonymousUser'),false);
 assert.equal(statements.some(s=>s.Resource==='*'),false);
});
test('shipped example cannot be deployed unchanged',async()=>{
 const example=JSON.parse(await readFile('config/example.json','utf8'));
 assert.throws(()=>validateConfig(example),/Replace example/);
});


test('automatic mode deploys without per-user mappings and scopes ListUsers to one namespace',()=>{
 const auto={...c,quickSightUserArn:undefined,oidc:{...c.oidc,pilotLogin:undefined},autoBinding:{enabled:true,namespace:'default',allowedEmailDomains:['example.com']},identityMappings:[]};
 validateConfig(auto);
 const t=makeTemplate(auto),s=t.Resources.PortalRole.Properties.Policies[0].PolicyDocument.Statement;
 assert.equal(s.find(x=>x.Action==='quicksight:ListUsers').Resource,'arn:aws:quicksight:us-east-1:111111111111:user/default/*');
 assert.deepEqual(s.find(x=>x.Action==='quicksight:GenerateEmbedUrlForRegisteredUser').Resource,['arn:aws:quicksight:us-east-1:111111111111:user/default/*']);
});
