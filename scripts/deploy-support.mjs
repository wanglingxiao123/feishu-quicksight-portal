import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

export async function zipRuntime(directory) {
  const files = {};
  async function walk(path, prefix = '') {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await walk(`${path}/${entry.name}`, `${name}/`);
      else if (entry.isFile()) files[name] = new Uint8Array(await readFile(`${path}/${entry.name}`));
    }
  }
  await walk(directory);
  return Buffer.from(zipSync(files, { level: 6, mtime: new Date('2000-01-01T00:00:00Z') }));
}

export function deploymentArtifact(c, archive, template) {
  const bucket = `feishu-portal-${c.awsAccountId}-${c.region}`;
  const key = `${c.stackName}/${createHash('sha256').update(archive).digest('hex')}.zip`;
  const deployed = structuredClone(template);
  deployed.Resources.PortalFunction.Properties.CodeUri = { Bucket: bucket, Key: key };
  return { bucket, key, template: deployed };
}

export function isMissingStack(error) {
  return error.name === 'ValidationError' && /Stack with id .+ does not exist/.test(error.message);
}

export function isEmptyChangeSet(description) {
  return description.Status === 'FAILED'
    && /didn't contain changes|No updates are to be performed/i.test(description.StatusReason || '');
}

export function reviewChanges(description) {
  return (description.Changes || []).map(({ ResourceChange: r }) => ({
    action: r.Action, logicalId: r.LogicalResourceId, type: r.ResourceType,
    replacement: r.Replacement || 'N/A',
  }));
}
