import { mkdir, rm, copyFile, writeFile, readFile, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { readConfig, tenantFromConfig } from './config.mjs';
import { makeTemplate } from './template.mjs';
const c=await readConfig();
execFileSync('npm',['run','check'],{stdio:'inherit'});execFileSync('npm',['test'],{stdio:'inherit'});
await rm('.build/runtime',{recursive:true,force:true});await mkdir('.build/runtime',{recursive:true});
const files=['access-policy.mjs','server.mjs','handler.mjs','report-routes.mjs','report-session.mjs','report-services.mjs','portal-policy.mjs','package.json','package-lock.json'];
for(const file of files)await copyFile(file,`.build/runtime/${file}`);
await cp('public','.build/runtime/public',{recursive:true});
await writeFile('.build/runtime/tenants.json',JSON.stringify([tenantFromConfig(c)],null,2));
execFileSync('npm',['ci','--omit=dev','--ignore-scripts'],{cwd:'.build/runtime',stdio:'inherit'});
await writeFile('.build/template.json',JSON.stringify(makeTemplate(c),null,2));
// No local .env, secret file, private notes, screenshots, test data or Git history enters the artifact.
await writeFile('.build/config-fingerprint.json',JSON.stringify(c,null,2));
console.log('Built .build/template.json and runtime/. No AWS resources were changed.');
