// Feishu entry authorization and report identity authorization are deliberately separate.
export function mayEnter(owner, user, mode = 'tester') {
 return Boolean(owner?.tenantKey && user?.openId && user.tenantKey === owner.tenantKey
  && (mode === 'tenant' || (mode === 'tester' && user.openId === owner.openId)));
}
export function resolvedTenant(tenant, mappingId) {
 if (!tenant) return undefined;
 if (!tenant.identityMappings?.length) return mappingId ? undefined : tenant;
 const mapping = tenant.identityMappings.find(m => m.id === mappingId && m.enabled !== false);
 return mapping ? { ...tenant, pilotLogin: mapping.login, pilotUserArn: mapping.quickSightUserArn,
  mappingId: mapping.id, expectedSubject: mapping.subject } : undefined;
}
export function identityStorageKey(tenant) {
 return tenant.mappingId ? `${tenant.id}#${tenant.mappingId}` : tenant.id;
}
