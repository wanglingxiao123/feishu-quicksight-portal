import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import {
  CloudFormationClient, DescribeStacksCommand, ValidateTemplateCommand,
  CreateChangeSetCommand, DescribeChangeSetCommand, ExecuteChangeSetCommand, DeleteChangeSetCommand,
} from '@aws-sdk/client-cloudformation';
import {
  S3Client, HeadBucketCommand, CreateBucketCommand, PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand, PutBucketVersioningCommand, PutBucketPolicyCommand,
  PutBucketTaggingCommand, GetBucketTaggingCommand, GetBucketPolicyCommand, PutObjectCommand,
} from '@aws-sdk/client-s3';
import { readConfig, tenantFromConfig } from './config.mjs';
import { awsContext } from './aws-context.mjs';
import { verifyIdentityClient } from '../identity-preflight.mjs';
import { zipRuntime, deploymentArtifact, isMissingStack, isEmptyChangeSet, reviewChanges } from './deploy-support.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function confirm(question) {
  if (!process.stdin.isTTY) throw Error('Use an interactive terminal to review deployment. No --yes bypass is supported.');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(`${question} 输入 yes 继续：`)).trim() === 'yes'; }
  finally { rl.close(); }
}
const c = await readConfig(), { options } = await awsContext(c);
if (JSON.stringify(JSON.parse(await readFile('.build/config-fingerprint.json', 'utf8'))) !== JSON.stringify(c)) {
  throw Error('Configuration changed; run npm run package again');
}
const cf = new CloudFormationClient(options), s3 = new S3Client(options);
let previous;
try { previous = (await cf.send(new DescribeStacksCommand({ StackName: c.stackName }))).Stacks[0]; }
catch (error) { if (!isMissingStack(error)) throw error; }
if (previous && !['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(previous.StackStatus)) {
  throw Error(`Stack ${c.stackName} is ${previous.StackStatus}; inspect it before retrying. It will not be deleted or recreated.`);
}
if (c.oidc.ready) {
  if (!previous) throw Error('First deployment must use oidc.ready=false; register its callback before enabling login');
  const origin = previous.Outputs.find(x => x.OutputKey === 'ApplicationUrl').OutputValue;
  await verifyIdentityClient(tenantFromConfig(c), { REPORT_OIDC_CLIENT_ID: c.oidc.clientId }, origin);
}
const archive = await zipRuntime('.build/runtime');
const artifact = deploymentArtifact(c, archive, JSON.parse(await readFile('.build/template.json', 'utf8')));
const templateBody = JSON.stringify(artifact.template);
if (Buffer.byteLength(templateBody) > 51_200) throw Error('Template exceeds the inline CloudFormation size limit');
await cf.send(new ValidateTemplateCommand({ TemplateBody: templateBody }));
console.log(JSON.stringify({
  account: c.awsAccountId, region: c.region, stack: c.stackName,
  operation: previous ? 'UPDATE' : 'CREATE', artifactBucket: artifact.bucket,
  resources: Object.entries(artifact.template.Resources).map(([id, r]) => ({ id, type: r.Type })),
}, null, 2));
if (!await confirm('请核对目标账户、区域、资源栈及资源。是否准备部署包？')) {
  console.log('已取消，未修改 AWS 资源。'); process.exit(0);
}
let exists = true;
try { await s3.send(new HeadBucketCommand({ Bucket: artifact.bucket, ExpectedBucketOwner: c.awsAccountId })); }
catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; exists = false; }
const bucketArgs = { Bucket: artifact.bucket, ExpectedBucketOwner: c.awsAccountId };
if (!exists) {
  await s3.send(new CreateBucketCommand({
    Bucket: artifact.bucket,
    ...(c.region === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: c.region } }),
  }));
  await s3.send(new PutBucketTaggingCommand({
    ...bucketArgs, Tagging: { TagSet: [{ Key: 'Project', Value: 'feishu-quicksight-portal' }] },
  }));
} else {
  const tags = await s3.send(new GetBucketTaggingCommand(bucketArgs));
  if (!tags.TagSet.some(t => t.Key === 'Project' && t.Value === 'feishu-quicksight-portal')) {
    throw Error('Existing bucket is not marked as a portal deployment bucket; refusing to overwrite its settings');
  }
}
await s3.send(new PutPublicAccessBlockCommand({ ...bucketArgs, PublicAccessBlockConfiguration: {
  BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true,
} }));
await s3.send(new PutBucketEncryptionCommand({ ...bucketArgs, ServerSideEncryptionConfiguration: {
  Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
} }));
await s3.send(new PutBucketVersioningCommand({ ...bucketArgs, VersioningConfiguration: { Status: 'Enabled' } }));
let bucketPolicy = { Version: '2012-10-17', Statement: [] };
if (exists) {
  try { bucketPolicy = JSON.parse((await s3.send(new GetBucketPolicyCommand(bucketArgs))).Policy); }
  catch (error) { if (error.name !== 'NoSuchBucketPolicy') throw error; }
}
const tlsStatement = { Sid: 'PortalDenyInsecureTransport', Effect: 'Deny', Principal: '*',
    Action: 's3:*', Resource: [`arn:aws:s3:::${artifact.bucket}`, `arn:aws:s3:::${artifact.bucket}/*`],
    Condition: { Bool: { 'aws:SecureTransport': 'false' } } };
bucketPolicy.Statement = [].concat(bucketPolicy.Statement || []).filter(s => s.Sid !== tlsStatement.Sid);
bucketPolicy.Statement.push(tlsStatement);
await s3.send(new PutBucketPolicyCommand({ ...bucketArgs, Policy: JSON.stringify(bucketPolicy) }));
await s3.send(new PutObjectCommand({
  ...bucketArgs, Key: artifact.key, Body: archive, ContentType: 'application/zip', ServerSideEncryption: 'AES256',
}));
const change = await cf.send(new CreateChangeSetCommand({
  StackName: c.stackName, ChangeSetName: `portal-${Date.now()}`,
  ChangeSetType: previous ? 'UPDATE' : 'CREATE', TemplateBody: templateBody, Capabilities: ['CAPABILITY_IAM'],
  Description: 'Portal SDK deployment; review before execution',
}));
await writeFile('.build/last-change-set.json', JSON.stringify({ stack: c.stackName, changeSetId: change.Id }, null, 2));
let description;
for (let n = 0; n < 180; n++) {
  description = await cf.send(new DescribeChangeSetCommand({ ChangeSetName: change.Id }));
  if (['CREATE_COMPLETE', 'FAILED'].includes(description.Status)) break;
  if (n % 6 === 0) console.log(`Change set: ${description.Status}`);
  await delay(5000);
}
if (isEmptyChangeSet(description)) {
  await cf.send(new DeleteChangeSetCommand({ ChangeSetName: change.Id }));
  console.log('没有应用变更，保留现有资源栈。'); process.exit(0);
}
if (description.Status !== 'CREATE_COMPLETE') throw Error(`Change set not ready: ${description.Status}: ${description.StatusReason || ''}`);
console.table(reviewChanges(description));
console.log(`Change set: ${change.Id}`);
if (!await confirm('请核对上方 CloudFormation 变更集。是否执行部署？')) {
  console.log('未执行。已上传的部署包与未执行变更集保留，供继续核对。'); process.exit(0);
}
await cf.send(new ExecuteChangeSetCommand({ ChangeSetName: change.Id }));
let status, sawInProgress = false;
for (let n = 0; n < 240; n++) {
  const stack = (await cf.send(new DescribeStacksCommand({ StackName: c.stackName }))).Stacks[0];
  if (stack.StackStatus !== status) { status = stack.StackStatus; console.log(`Stack: ${status}`); }
  if (status.endsWith('_IN_PROGRESS')) sawInProgress = true;
  const newOperationObserved = !previous || sawInProgress
    || new Date(stack.LastUpdatedTime || 0) > new Date(previous.LastUpdatedTime || previous.CreationTime || 0);
  if (newOperationObserved && ['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(status)) {
    console.log(JSON.stringify(Object.fromEntries(stack.Outputs.map(x => [x.OutputKey, x.OutputValue])), null, 2));
    process.exit(0);
  }
  if (status.includes('FAILED') || status.includes('ROLLBACK') || status === 'DELETE_COMPLETE') {
    throw Error(`Deployment did not succeed (${status}). Inspect CloudFormation events; do not delete the stack to retry.`);
  }
  await delay(5000);
}
throw Error(`Still waiting (${status}). Check CloudFormation status before another deployment.`);
