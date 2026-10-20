import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { unzipSync } from 'fflate';
import { zipRuntime, deploymentArtifact, isMissingStack, isEmptyChangeSet, reviewChanges } from '../scripts/deploy-support.mjs';

test('deployment ZIP contains only the staged runtime and does not follow symlinks', async t => {
  const root = await mkdtemp(`${tmpdir()}/portal-zip-`);
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(`${root}/runtime/public`, { recursive: true });
  await writeFile(`${root}/runtime/handler.mjs`, 'export const handler = () => {};');
  await writeFile(`${root}/runtime/public/app.js`, 'console.log("app")');
  await writeFile(`${root}/runtime-secret.local.json`, 'sensitive-test-fixture');
  await symlink(`${root}/runtime-secret.local.json`, `${root}/runtime/linked-secret`);
  const first = await zipRuntime(`${root}/runtime`);
  assert.deepEqual(first, await zipRuntime(`${root}/runtime`));
  assert.deepEqual(Object.keys(unzipSync(first)).sort(), ['handler.mjs', 'public/app.js']);
});

test('artifact paths isolate stacks and code changes without changing the API resource', () => {
  const c = { awsAccountId: '111111111111', region: 'us-east-1', stackName: 'test-portal' };
  const template = { Resources: { PortalApi: { Type: 'AWS::Serverless::HttpApi' }, PortalFunction: { Properties: { CodeUri: 'runtime/' } } } };
  const one = deploymentArtifact(c, Buffer.from('one'), template);
  const two = deploymentArtifact(c, Buffer.from('two'), template);
  assert.equal(one.bucket, 'feishu-portal-111111111111-us-east-1');
  assert.match(one.key, /^test-portal\/[a-f0-9]{64}\.zip$/);
  assert.notEqual(one.key, two.key);
  assert.equal(template.Resources.PortalFunction.Properties.CodeUri, 'runtime/');
  assert.deepEqual(one.template.Resources.PortalApi, template.Resources.PortalApi);
});

test('missing-stack and empty-update handling never conceal authorization or validation errors', () => {
  assert.equal(isMissingStack({ name: 'ValidationError', message: 'Stack with id test does not exist' }), true);
  assert.equal(isMissingStack({ name: 'AccessDenied', message: 'Stack with id test does not exist' }), false);
  assert.equal(isMissingStack({ name: 'ValidationError', message: 'Bad parameter' }), false);
  assert.equal(isEmptyChangeSet({ Status: 'FAILED', StatusReason: "The submitted information didn't contain changes." }), true);
  assert.equal(isEmptyChangeSet({ Status: 'FAILED', StatusReason: 'AccessDenied' }), false);
  assert.deepEqual(reviewChanges({ Changes: [{ ResourceChange: {
    Action: 'Modify', LogicalResourceId: 'PortalFunction', ResourceType: 'AWS::Lambda::Function', Replacement: 'False',
  } }] }), [{ action: 'Modify', logicalId: 'PortalFunction', type: 'AWS::Lambda::Function', replacement: 'False' }]);
});
