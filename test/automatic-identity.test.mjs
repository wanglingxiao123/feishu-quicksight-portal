import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAutomaticLogin,automaticMappingId,automaticLockKey,automaticTransaction,resolvedAutomaticTenant,verifiedAutomaticEmail} from '../automatic-identity.mjs';
const tenant={id:'company',accountId:'111111111111',region:'us-east-1',issuer:'https://identity.example',provider:'cognito',autoBinding:{enabled:true,namespace:'default',allowedEmailDomains:['example.com']}};
const claims={iss:tenant.issuer,sub:'subject-alice',token_use:'id',email:'Alice@example.com',email_verified:true,'cognito:username':'alice'};
const user={Arn:'arn:aws:quicksight:us-east-1:111111111111:user/default/alice',Email:'alice@example.com',Active:true,PrincipalId:'principal-alice'};
function harness(users=[user]){
 const records=new Map(),locks=new Map();let listCalls=0,described=user;
 return {records,locks,setUser:u=>described=u,get listCalls(){return listCalls;},deps:{
 readBinding:async key=>records.get(key),
 createAutomaticBinding:async(key,b)=>{if(records.has(key)||locks.has(automaticLockKey(b)))return;records.set(key,b);locks.set(automaticLockKey(b),key);},
 listUsers:async()=>{listCalls++;return users;},describeUser:async()=>described,
 }};
}
test('first verified login creates binding; repeat login reuses it without listing directory',async()=>{
 const h=harness();const first=await resolveAutomaticLogin(tenant,claims,h.deps);
 assert.equal(first.binding.quickSightUserArn,user.Arn);assert.equal(first.binding.quickSightPrincipalId,user.PrincipalId);
 assert.equal(h.records.size,1);assert.equal(h.locks.size,1);
 await resolveAutomaticLogin(tenant,claims,h.deps);assert.equal(h.listCalls,1);
 assert.equal(first.tenant.mappingId,automaticMappingId(tenant.issuer,claims.sub));
});
test('unverified, absent or wrong-domain email and wrong token/issuer never query directory',async()=>{
 const h=harness();for(const changes of [{email_verified:false},{email:undefined},{email:'a@outside.example'},{iss:'https://evil.example'},{token_use:'access'},{sub:''}]){
 await assert.rejects(resolveAutomaticLogin(tenant,{...claims,...changes},h.deps));}
 assert.equal(h.listCalls,0);assert.equal(h.records.size,0);
});
test('missing, duplicate, inactive and wrong-namespace users fail closed',async()=>{
 for(const [users,code]of [[[],'quicksight_user_missing'],[[user,{...user,Active:false}],'quicksight_user_ambiguous'],[[{...user,Active:false}],'quicksight_user_inactive'],[[{...user,Arn:user.Arn.replace('/default/','/other/')}],'quicksight_user_inactive']]){
 const h=harness(users);await assert.rejects(resolveAutomaticLogin(tenant,claims,h.deps),e=>e.code===code);assert.equal(h.records.size,0);
 }
});
test('email cannot take over explicit mapping or earlier different subject even concurrently',async()=>{
 const h=harness();await assert.rejects(resolveAutomaticLogin(tenant,claims,{...h.deps,reservedArns:[user.Arn]}),e=>e.code==='identity_binding_conflict');
 const results=await Promise.allSettled([resolveAutomaticLogin(tenant,claims,h.deps),resolveAutomaticLogin(tenant,{...claims,sub:'different-subject'},h.deps)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.records.size,1);assert.equal(h.locks.size,1);
});
test('changed email, policy, disabled binding or recreated QuickSight principal never silently relink',async()=>{
 const h=harness(),first=await resolveAutomaticLogin(tenant,claims,h.deps);
 await assert.rejects(resolveAutomaticLogin(tenant,{...claims,email:'new@example.com'},h.deps),e=>e.code==='identity_binding_changed');
 h.setUser({...user,PrincipalId:'new-principal'});
 await assert.rejects(resolveAutomaticLogin(tenant,claims,h.deps),e=>e.code==='quicksight_identity_changed');
 assert.equal(resolvedAutomaticTenant({...tenant,autoBinding:{...tenant.autoBinding,namespace:'other'}},first.tenant.mappingId,first.binding),undefined);
 first.binding.enabled=false;
 await assert.rejects(resolveAutomaticLogin(tenant,claims,h.deps),e=>e.code==='identity_binding_changed');
});
test('DynamoDB subject and reverse-owner writes are conditional in one transaction without TTL',()=>{
 const b={quickSightUserArn:user.Arn,issuer:tenant.issuer,subject:claims.sub};const writes=automaticTransaction('test-table','company#auto-example',b);
 assert.equal(writes.length,2);for(const x of writes){assert.equal(x.Put.ConditionExpression,'attribute_not_exists(pk)');assert.equal(x.Put.Item.expiresAt,undefined);}
 assert.notEqual(writes[0].Put.Item.pk,writes[1].Put.Item.pk);
});
test('Keycloak requires boolean verified email and enforces issuer',()=>{
 assert.equal(verifiedAutomaticEmail({...tenant,provider:'keycloak'},{...claims,token_use:undefined}),'alice@example.com');
 assert.throws(()=>verifiedAutomaticEmail({...tenant,provider:'keycloak'},{...claims,email_verified:'true'}));
});
