import test from 'node:test';
import assert from 'node:assert/strict';
import { mayEnter,resolvedTenant } from '../access-policy.mjs';
import { selectIdentityTenant } from '../report-session.mjs';
const owner={openId:'owner',tenantKey:'company'},employee={openId:'employee',tenantKey:'company'};
test('tenant mode admits own employees, denies outsiders, and preserves tester mode',()=>{
 assert.equal(mayEnter(owner,employee,'tenant'),true);
 assert.equal(mayEnter(owner,employee,'tester'),false);
 assert.equal(mayEnter(owner,owner,'tester'),true);
 assert.equal(mayEnter(owner,{...employee,tenantKey:'outsider'},'tenant'),false);
 assert.equal(mayEnter(null,employee,'tenant'),false);
 assert.equal(mayEnter(owner,employee,'unknown'),false);
});
test('unmapped, ambiguous and wrong-subject identities fail closed',()=>{
 const t={id:'company',issuer:'https://identity.example',identityMappings:[{id:'one',login:'alice',quickSightUserArn:'test',subject:'subject-one'}]};
 assert.equal(selectIdentityTenant(t,{iss:t.issuer,sub:'other',preferred_username:'alice'}),undefined);
 assert.equal(selectIdentityTenant(t,{iss:t.issuer,sub:'subject-one',preferred_username:'bob'}),undefined);
 assert.equal(selectIdentityTenant(t,{iss:t.issuer,sub:'subject-one',preferred_username:'alice'}).mappingId,'one');
 assert.equal(resolvedTenant(t,undefined),undefined);
});
