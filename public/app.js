const $ = id => document.getElementById(id);
let csrfToken, identity, allDashboards = [], selected, generation = 0, accounts = [], expiryTimer, gateRequired = true;
function show(id) { document.body.dataset.view = id; if (id !== 'viewer') setExpanded(false); for (const name of ['login', 'catalog', 'viewer']) $(name).hidden = name !== id; }
function status(message = '') { $('status').textContent = message; }
function clearReport() {
  ++generation; clearTimeout(expiryTimer);
  identity = undefined; selected = undefined; allDashboards = [];
  $('dashboard-frame').removeAttribute('src'); $('cards').replaceChildren();
  $('profile').hidden = true; $('profile').open = false;
  $('profile-name').textContent = '个人中心'; $('profile-identity').textContent = '';
  $('profile-company').textContent = ''; $('search').value = ''; $('empty-state').hidden = true;
}
function loginChoice() {
  const account = accounts.find(a => a.id === $('account-picker').value);
  const enabled = Boolean(account?.ready);
  $('login-button').setAttribute('aria-disabled', String(!enabled));
  if (enabled) $('login-button').href = gateRequired
    ? `/auth/start?report_account=${encodeURIComponent(account.id)}`
    : `/auth/report/start?tenant=${encodeURIComponent(account.id)}`;
  else $('login-button').removeAttribute('href');
  $('login-note').textContent = !account ? '请选择要登录的 QuickSight 账户。'
    : enabled ? '登录完成后返回你的报表。' : '此QuickSight 账户的登录接入尚未完成。';
}
async function loginScreen() {
  clearReport(); show('login');
  const request = generation;
  let res = await fetch('/api/access');
  if (request !== generation) return;
  if (res.status === 401) {
    csrfToken = undefined; gateRequired = true;
    res = await fetch('/api/login-options');
  } else gateRequired = false;
  if (!res.ok) throw Error('登录状态暂时无法检查，请刷新重试。');
  const access = await res.json();
  if (request !== generation) return;
  csrfToken = access.csrfToken; accounts = access.accounts;
  $('account-picker').replaceChildren(new Option('请选择 QuickSight 账户', ''));
  for (const a of accounts) $('account-picker').append(new Option(a.label, a.id));
  // No company is inferred from configuration order or Feishu identity.
  $('account-picker').value = ''; $('account-choice').hidden = false;
  $('login-description').textContent = '登录报表账号，查看你有权限访问的报表。';
  loginChoice();
}
async function api(url, options = {}) {
  const request = generation;
  const res = await fetch(url, { ...options, headers: { 'X-CSRF-Token': csrfToken ?? '', ...options.headers } });
  if (request !== generation) throw new DOMException('Superseded request', 'AbortError');
  if (res.status === 401) { await loginScreen(); throw Error('请重新登录报表账号。'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})); throw Error(body.error ?? '请求失败，请重试。');
  }
  return res.status === 204 ? null : res.json();
}
function render() {
  if (!identity) return;
  const term = $('search').value.toLocaleLowerCase().trim();
  const items = allDashboards.filter(d => d.name.toLocaleLowerCase().includes(term)).sort((a, b) =>
    a.name.trim().localeCompare(b.name.trim(), 'zh-CN', { numeric: true }) * ($('sort').value === 'desc' ? -1 : 1));
  $('count').textContent = term ? `${items.length} / ${allDashboards.length}` : `${items.length}`; $('cards').replaceChildren();
  for (const d of items) {
    const button = document.createElement('button'); button.className = 'card';
    const icon = document.createElement('span'); icon.className = 'chart-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 16v-4m5 4V7m5 9v-6"/></svg>';
    const title = document.createElement('h2'); title.textContent = d.name.trim();
    const bottom = document.createElement('div'); bottom.className = 'card-bottom';
    const company = document.createElement('span'); company.textContent = 'QuickSight 报表';
    const arrow = document.createElement('span'); arrow.textContent = '查看报表 →';
    bottom.append(company, arrow); button.append(icon, title, bottom);
    button.addEventListener('click', () => open(d)); $('cards').append(button);
  }
  $('empty-state').hidden = items.length > 0;
  $('empty-title').textContent = term ? '没有找到匹配的报表' : '暂无可查看的报表';
  $('empty-description').textContent = term ? '试试更短的关键词，或清除搜索查看全部报表。' : '请确认登录账号，或联系报表拥有者开通访问权限。';
  $('clear-search').hidden = !term; status();
}
async function load() {
  const request = ++generation;
  $('refresh').disabled = true; $('cards').setAttribute('aria-busy', 'true'); $('empty-state').hidden = true; status('正在加载你的报表…');
  try {
    const result = await api('/api/dashboards');
    if (request !== generation || !identity) return;
    allDashboards = result.dashboards; render();
  } catch (e) { if (e.name !== 'AbortError') status(e.message); }
  finally { $('refresh').disabled = false; $('cards').setAttribute('aria-busy', 'false'); }
}
async function open(d) {
  if (!identity || !d) return;
  selected = d; const request = ++generation; show('viewer'); status();
  $('dashboard-title').textContent = d.name; $('dashboard-frame').title = d.name;
  $('dashboard-frame').removeAttribute('src'); $('dashboard-frame').hidden = true;
  $('frame-hint').textContent = '正在打开报表…'; $('reload').disabled = true;
  try {
    const result = await api(`/api/dashboards/${encodeURIComponent(d.id)}/embed`, { method: 'POST' });
    if (request !== generation || !identity) return;
    $('dashboard-frame').src = result.embedUrl; $('dashboard-frame').hidden = false;
    $('frame-hint').textContent = '正在载入报表内容…';
  } catch (e) { if (e.name !== 'AbortError' && request === generation) { $('frame-hint').textContent = ''; status(`${e.message} 可点击“重新加载”重试。`); } }
  finally { $('reload').disabled = false; }
}
async function switchAccount() {
  const token = csrfToken;
  clearReport(); show('login'); status('正在退出当前报表账号…');
  try {
    const res = await fetch('/auth/report/clear', { method: 'POST', headers: { 'X-CSRF-Token': token ?? '' } });
    if (!res.ok && res.status !== 401) throw Error('账号切换尚未完成，请刷新后重试。');
    await loginScreen(); status();
  } catch (e) {
    $('login-button').removeAttribute('href'); $('login-button').setAttribute('aria-disabled', 'true');
    status(e.message);
  }
}
function setExpanded(expanded) {
  document.body.classList.toggle('expanded', expanded);
  $('expand').setAttribute('aria-pressed', String(expanded));
  $('expand').textContent = expanded ? '收起视图' : '展开视图';
}
$('expand').addEventListener('click', () => setExpanded(!document.body.classList.contains('expanded')));
$('dashboard-frame').addEventListener('load', () => {
  if ($('dashboard-frame').getAttribute('src') && !$('viewer').hidden) $('frame-hint').textContent = '';
});
$('sort').addEventListener('change', render);
for (const view of ['grid', 'list']) $(view + '-view').addEventListener('click', () => {
  $('cards').classList.toggle('list', view === 'list');
  $('grid-view').setAttribute('aria-pressed', String(view === 'grid'));
  $('list-view').setAttribute('aria-pressed', String(view === 'list'));
});
if (matchMedia('(max-width: 640px)').matches) $('list-view').click();
$('clear-search').addEventListener('click', () => { $('search').value = ''; render(); $('search').focus(); });
$('search').addEventListener('input', render);
$('account-picker').addEventListener('change', loginChoice);
$('refresh').addEventListener('click', load);
$('reload').addEventListener('click', () => open(selected));
$('back').addEventListener('click', () => {
  ++generation; selected = undefined; $('dashboard-frame').removeAttribute('src'); show('catalog'); render();
});
$('switch-account').addEventListener('click', switchAccount);
$('logout').addEventListener('click', async () => {
  const token = csrfToken; clearReport(); show('login');
  try {
    const res = await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': token ?? '' } });
    if (!res.ok && res.status !== 401) throw Error('退出尚未完成，请刷新重试。');
    location.reload();
  } catch (e) { status(e.message); }
});
document.addEventListener('click', event => {
  if (!$('profile').contains(event.target)) $('profile').open = false;
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setExpanded(false);
  if (event.key === 'Escape' && $('profile').open) {
    $('profile').open = false; $('profile').querySelector('summary').focus();
  }
});
async function boot() {
  const request = generation;
  const res = await fetch('/api/me');
  if (request !== generation) return;
  if (res.status === 401) {
    await loginScreen();
    const error = new URLSearchParams(location.search).get('login_error');
    const messages = {
      identity_not_mapped:'此登录账号尚未配置报表访问权限，请联系应用管理员。',
      email_not_verified:'登录邮箱尚未验证，请先完成企业账号的邮箱验证。',
      email_domain_not_allowed:'此邮箱不在应用允许的企业邮箱范围内，请联系管理员。',
      quicksight_user_missing:'尚未找到对应的 QuickSight 用户，请联系管理员开通账号并核对邮箱。',
      quicksight_user_ambiguous:'存在多个相同邮箱的 QuickSight 用户，请联系管理员核对后重试。',
      quicksight_user_inactive:'对应的 QuickSight 用户尚未启用，请联系管理员。',
      identity_binding_conflict:'此报表用户已有关联身份，请联系管理员核对，应用不会覆盖原有关联。',
      identity_binding_changed:'你的登录身份信息发生变化，请联系管理员核对原有关联。',
      quicksight_identity_changed:'QuickSight 用户状态或身份发生变化，请联系管理员核对。',
    };
    status(error ? messages[error] || '报表账号登录未完成，请重新选择账号登录。' : '');
    if (error) history.replaceState(null, '', '/');
    return;
  }
  if (!res.ok) throw Error('登录检查失败，请刷新。');
  const me = await res.json();
  if (request !== generation) return;
  if (!identity || identity.tenantId !== me.tenantId || identity.quickSightUsername !== me.quickSightUsername) {
    clearReport(); show('catalog');
  }
  identity = me; csrfToken = me.csrfToken;
  $('profile-name').textContent = me.name; $('profile-identity').textContent = me.quickSightUsername;
  $('profile-company').textContent = me.account; $('profile-avatar').textContent = [...me.name][0];
  $('profile').hidden = false; $('logout').hidden = false;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => loginScreen().then(() => status('报表登录已过期，请重新登录。'))
    .catch(e => status(e.message)), Math.max(0, me.expiresAt - Date.now()));
  if (!$('viewer').hidden) return;
  show('catalog'); await load();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') boot().catch(e => status(e.message));
});
boot().catch(e => status(e.message));
