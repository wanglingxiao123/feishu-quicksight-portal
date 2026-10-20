import { createHash } from 'node:crypto';
export class IdentityLinkError extends Error {
  constructor(code) { super(code); this.name='IdentityLinkError'; this.code=code; }
}
const hash=value=>createHash('sha256').update(value).digest('hex');
export function automaticMappingId(issuer,subject) { return `auto-${hash(JSON.stringify([issuer,subject]))}`; }
export function automaticPolicyHash(tenant) {
 return hash(JSON.stringify({issuer:tenant.issuer,account:tenant.accountId,region:tenant.region,namespace:tenant.autoBinding?.namespace,
  domains:[...(tenant.autoBinding?.allowedEmailDomains||[])].map(x=>x.toLowerCase()).sort()}));
}
export function verifiedAutomaticEmail(tenant,claims) {
 if(!tenant.autoBinding?.enabled||claims?.iss!==tenant.issuer||typeof claims.sub!=='string'||!claims.sub
  ||(tenant.provider==='cognito'&&claims.token_use!=='id'))throw new IdentityLinkError('invalid_identity');
 if(claims.email_verified!==true)throw new IdentityLinkError('email_not_verified');
 const email=normalizeEmail(claims.email);if(!email)throw new IdentityLinkError('email_not_verified');
 const domains=tenant.autoBinding.allowedEmailDomains||[];
 if(domains.length&&!domains.includes(email.split('@')[1]))throw new IdentityLinkError('email_domain_not_allowed');
 return email;
}
export function normalizeEmail(value) {
 if(typeof value!=='string')return undefined;
 const email=value.trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:undefined;
}
export function automaticUserMatches(tenant,binding,user) {
 return Boolean(user?.Active===true&&user.Arn===binding.quickSightUserArn&&user.PrincipalId
  &&user.PrincipalId===binding.quickSightPrincipalId&&normalizeEmail(user.Email)===binding.email
  &&user.Arn.startsWith(`arn:aws:quicksight:${tenant.region}:${tenant.accountId}:user/${tenant.autoBinding.namespace}/`));
}
export function resolvedAutomaticTenant(tenant,mappingId,binding) {
 if(!tenant?.autoBinding?.enabled||!/^auto-[a-f0-9]{64}$/.test(mappingId||'')||!binding?.automatic
  ||binding.enabled!==true||binding.tenantId!==tenant.id||binding.issuer!==tenant.issuer
  ||mappingId!==automaticMappingId(binding.issuer,binding.subject)
  ||binding.policyHash!==automaticPolicyHash(tenant)
  ||!binding.quickSightUserArn?.startsWith(`arn:aws:quicksight:${tenant.region}:${tenant.accountId}:user/${tenant.autoBinding.namespace}/`))return undefined;
 return {...tenant,mappingId,pilotLogin:binding.login,pilotUserArn:binding.quickSightUserArn,expectedSubject:binding.subject};
}
// Called only after OIDC signature, audience, nonce, state and PKCE validation.
export async function resolveAutomaticLogin(tenant,claims,{readBinding,createAutomaticBinding,listUsers,describeUser,reservedArns=[]}) {
 const email=verifiedAutomaticEmail(tenant,claims),mappingId=automaticMappingId(tenant.issuer,claims.sub),key=`${tenant.id}#${mappingId}`;
 let binding=await readBinding(key);
 if(binding){
  if(reservedArns.includes(binding.quickSightUserArn))throw new IdentityLinkError('identity_binding_conflict');
  const resolved=resolvedAutomaticTenant(tenant,mappingId,binding);
  if(!resolved||binding.email!==email)throw new IdentityLinkError('identity_binding_changed');
  if(!automaticUserMatches(tenant,binding,await describeUser(resolved)))throw new IdentityLinkError('quicksight_identity_changed');
  return {tenant:resolved,binding};
 }
 const candidates=(await listUsers(tenant)).filter(u=>normalizeEmail(u.Email)===email);
 if(!candidates.length)throw new IdentityLinkError('quicksight_user_missing');
 // Inactive duplicates also make the match ambiguous. Never pick the first entry.
 if(candidates.length!==1)throw new IdentityLinkError('quicksight_user_ambiguous');
 const user=candidates[0];
 if(!user.Active||!user.PrincipalId||!user.Arn?.startsWith(`arn:aws:quicksight:${tenant.region}:${tenant.accountId}:user/${tenant.autoBinding.namespace}/`))throw new IdentityLinkError('quicksight_user_inactive');
 if(reservedArns.includes(user.Arn))throw new IdentityLinkError('identity_binding_conflict');
 const candidate={automatic:true,enabled:true,tenantId:tenant.id,issuer:tenant.issuer,subject:claims.sub,
  quickSightUserArn:user.Arn,quickSightPrincipalId:user.PrincipalId,email,policyHash:automaticPolicyHash(tenant),
  login:claims['cognito:username']||claims.preferred_username||email,name:claims.name||claims.preferred_username||email};
 await createAutomaticBinding(key,candidate); // Atomic subject record and reverse ownership lock.
 binding=await readBinding(key);
 const resolved=resolvedAutomaticTenant(tenant,mappingId,binding);
 if(!resolved||binding.email!==email||binding.quickSightUserArn!==candidate.quickSightUserArn
  ||binding.quickSightPrincipalId!==candidate.quickSightPrincipalId)throw new IdentityLinkError('identity_binding_conflict');
 return {tenant:resolved,binding};
}
export function automaticLockKey(binding) { return `REPORT_USER_LOCK#${hash(binding.quickSightUserArn)}`; }
export function automaticTransaction(table,key,binding) {
 return [
  {Put:{TableName:table,Item:{pk:`REPORT_IDENTITY#${key}`,identity:binding},ConditionExpression:'attribute_not_exists(pk)'}},
  {Put:{TableName:table,Item:{pk:automaticLockKey(binding),issuer:binding.issuer,subject:binding.subject,identityKey:key},ConditionExpression:'attribute_not_exists(pk)'}},
 ];
}
