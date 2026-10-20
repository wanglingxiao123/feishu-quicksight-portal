import { validateTenant } from '../portal-policy.mjs';
import { readFile } from 'node:fs/promises';
export function validateConfig(c){
 const text=JSON.stringify(c);
 if(/REPLACE_ME|123456789012|PASTE_YOUR/.test(text))throw Error('Replace example values in config.local.json before packaging');
 if(!/^[a-zA-Z][a-zA-Z0-9-]{0,63}$/.test(c.stackName))throw Error('Invalid stackName');
 if(!/^\d{12}$/.test(c.awsAccountId)||!/^([a-z]{2})-[a-z]+-\d$/.test(c.region))throw Error('Invalid AWS account or region (commercial AWS only)');
 if(!/^cli_[A-Za-z0-9]+$/.test(c.feishuAppId))throw Error('Invalid Feishu app ID');
 if(!c.runtimeSecretArn?.startsWith(`arn:aws:secretsmanager:${c.region}:${c.awsAccountId}:secret:`))throw Error('Runtime secret must be in the deployment account and region');
 if(!c.autoBinding?.enabled && !c.identityMappings?.length && !c.quickSightUserArn?.startsWith(`arn:aws:quicksight:${c.region}:${c.awsAccountId}:user/`))throw Error('This starter requires QuickSight in the deployment account and region');
 if(!['cognito','keycloak'].includes(c.oidc?.provider)||(!c.autoBinding?.enabled&&!c.identityMappings?.length&&!c.oidc.pilotLogin)||!c.accountLabel)throw Error('Missing identity configuration');
 const issuer=new URL(c.oidc.issuer);if(issuer.protocol!=='https:'||issuer.search||issuer.hash||c.oidc.issuer.endsWith('/'))throw Error('Use exact HTTPS issuer without trailing slash');
 if(typeof c.oidc.ready!=='boolean'||(c.oidc.ready&&!c.oidc.clientId))throw Error('Ready login requires clientId');
 if(c.oidc.provider==='cognito'){
  if(c.oidc.issuer!==`https://cognito-idp.${c.region}.amazonaws.com/${c.oidc.userPoolId}`)throw Error('Cognito issuer and user pool must match');
  const u=new URL(c.oidc.authorizationOrigin);if(u.protocol!=='https:'||u.origin!==c.oidc.authorizationOrigin||!u.hostname.endsWith(`.auth.${c.region}.amazoncognito.com`))throw Error('Use a Cognito hosted domain origin');
 }
 if(!['tester','tenant'].includes(c.feishuAccessMode || 'tester'))throw Error('Invalid feishuAccessMode');
 validateTenant(tenantFromConfig(c));
 return c;
}
export async function readConfig(){return validateConfig(JSON.parse(await readFile('config.local.json','utf8')));}
export function tenantFromConfig(c){return {id:'company',label:c.accountLabel,accountId:c.awsAccountId,region:c.region,
 autoBinding:c.autoBinding,identityMappings:c.identityMappings,issuer:c.oidc.issuer,provider:c.oidc.provider,pilotLogin:c.oidc.pilotLogin,pilotUserArn:c.quickSightUserArn,
 userPoolId:c.oidc.userPoolId,authorizationOrigin:c.oidc.authorizationOrigin,useExecutionRole:true,
 clientIdEnv:'REPORT_OIDC_CLIENT_ID',readyEnv:'REPORT_AUTH_READY'};}
