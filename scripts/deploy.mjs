import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { readConfig,tenantFromConfig } from './config.mjs';
import { awsContext } from './aws-context.mjs';
import { verifyIdentityClient } from '../identity-preflight.mjs';
const c=await readConfig(),{options,profile}=await awsContext(c);
if(JSON.stringify(JSON.parse(await readFile('.build/config-fingerprint.json','utf8')))!==JSON.stringify(c))throw Error('Configuration changed; run npm run package again');
if(c.oidc.ready){
 const r=await new CloudFormationClient(options).send(new DescribeStacksCommand({StackName:c.stackName}));
 const origin=r.Stacks[0].Outputs.find(x=>x.OutputKey==='ApplicationUrl').OutputValue;
 await verifyIdentityClient(tenantFromConfig(c),{REPORT_OIDC_CLIENT_ID:c.oidc.clientId},origin);
}
execFileSync('sam',['validate','--lint','--template-file','.build/template.json','--region',c.region],{stdio:'inherit'});
execFileSync('sam',['deploy','--template-file','.build/template.json','--stack-name',c.stackName,'--region',c.region,'--resolve-s3','--capabilities','CAPABILITY_IAM','--confirm-changeset','--no-fail-on-empty-changeset',...(profile?['--profile',profile]:[])],{stdio:'inherit'});
