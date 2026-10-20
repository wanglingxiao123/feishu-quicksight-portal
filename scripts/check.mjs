import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
for (const dir of ['.', 'scripts', 'test', 'public']) {
 for(const file of readdirSync(dir).filter(x=>/\.(mjs|js)$/.test(x))) execFileSync(process.execPath,['--check',`${dir}/${file}`],{stdio:'inherit'});
}
console.log('Syntax checks passed');
