import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
await writeFile('runtime-secret.local.json',JSON.stringify({
 FEISHU_APP_SECRET:'PASTE_YOUR_FEISHU_APP_SECRET_HERE',
 SESSION_SECRET:randomBytes(48).toString('hex'),ENROLLMENT_TOKEN:randomBytes(32).toString('hex'),
},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log('Created runtime-secret.local.json (0600). Edit locally and store its JSON in Secrets Manager. Never commit or share it. Existing files are not overwritten.');
