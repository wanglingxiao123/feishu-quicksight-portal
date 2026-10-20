import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { readConfig,tenantFromConfig } from './config.mjs';
import { awsContext } from './aws-context.mjs';
import { verifyIdentityClient } from '../identity-preflight.mjs';
const c=await readConfig(),{options}=await awsContext(c);
const r=await new CloudFormationClient(options).send(new DescribeStacksCommand({StackName:c.stackName}));
const origin=r.Stacks[0].Outputs.find(x=>x.OutputKey==='ApplicationUrl').OutputValue;
await verifyIdentityClient(tenantFromConfig(c),{REPORT_OIDC_CLIENT_ID:c.oidc.clientId},origin);
console.log('OIDC client/callback preflight passed; real user login and dashboard verification are still required.');
