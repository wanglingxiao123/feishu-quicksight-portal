import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { readConfig } from './config.mjs';
import { awsContext } from './aws-context.mjs';
const c=await readConfig(),{options}=await awsContext(c);
const r=await new CloudFormationClient(options).send(new DescribeStacksCommand({StackName:c.stackName}));
console.log(JSON.stringify(Object.fromEntries(r.Stacks[0].Outputs.map(x=>[x.OutputKey,x.OutputValue])),null,2));
