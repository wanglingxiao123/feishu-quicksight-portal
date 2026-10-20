import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright';

test('desktop and mobile UI require verified identity, never default a company, and discard old embeds after switching', async t => {
  const app = express(); app.use(express.static(new URL('../public/', import.meta.url).pathname));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  t.after(async () => { await browser.close(); await new Promise(r => server.close(r)); });
  for (const width of [1280, 390]) {
    await t.test(`viewport ${width}`, async () => {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const origin = `http://127.0.0.1:${server.address().port}`;
      let authenticated = false, listCalls = 0, releaseEmbed, embedRequested;
      const waitingForEmbed = new Promise(resolve => { embedRequested = resolve; });
      const embedGate = new Promise(resolve => { releaseEmbed = resolve; });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let status = 200, body;
        if (path === '/api/access') body = { csrfToken: 'test-csrf', accounts: [
          { id: 'company-a', label: 'Test Company A', ready: true },
          { id: 'company-b', label: 'Test Company B', ready: false },
        ] };
        else if (path === '/api/me') {
          status = authenticated ? 200 : 401;
          body = authenticated ? { name: 'Test Principal', quickSightUsername: 'role/test-user', account: 'Test Company A',
            tenantId: 'company-a', csrfToken: 'test-csrf', expiresAt: Date.now() + 3600_000 } : { error: 'login required' };
        } else if (path === '/api/dashboards') {
          listCalls++; body = { dashboards: [{ id: 'a-dashboard', name: 'Test dashboard' }] };
        } else if (path.endsWith('/embed')) {
          embedRequested(); await embedGate; body = { embedUrl: 'https://quicksight.example/stale-embed' };
        } else throw Error('Unexpected test request');
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.route('**/auth/report/clear', async route => {
        authenticated = false;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ csrfToken: 'new-test-csrf' }) });
      });
      await page.goto(origin);
      await page.locator('#account-choice').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#account-picker').inputValue(), '');
      assert.equal(await page.locator('#profile').isVisible(), false);
      assert.equal(await page.locator('#cards .card').count(), 0); assert.equal(listCalls, 0);
      assert.equal(await page.locator('#login-button').getAttribute('href'), null);
      await page.selectOption('#account-picker', 'company-b');
      assert.equal(await page.locator('#login-button').getAttribute('href'), null);
      await page.selectOption('#account-picker', 'company-a');
      assert.equal(await page.locator('#login-button').getAttribute('href'), '/auth/report/start?tenant=company-a');
      assert.equal(listCalls, 0);
      authenticated = true; await page.reload();
      await page.locator('#cards .card').waitFor();
      await page.locator('#profile summary').click();
      assert.equal(await page.locator('#profile-identity').innerText(), 'role/test-user');
      assert.equal(await page.locator('#profile-company').innerText(), 'Test Company A');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Escape');
      await page.locator('#cards .card').click(); await waitingForEmbed;
      await page.locator('#profile summary').click(); await page.locator('#switch-account').click();
      await page.locator('#account-choice').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#profile').isVisible(), false);
      releaseEmbed(); await page.waitForTimeout(100);
      assert.equal(await page.locator('#dashboard-frame').getAttribute('src'), null);
      assert.equal(await page.locator('#account-picker').inputValue(), '');
      assert.equal(await page.locator('#cards .card').count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
});
