import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const evidence = resolve('.desktop-test');
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const finishAnimations = () => page.evaluate(() => Promise.all(
  document.getAnimations().filter(animation =>
    animation.effect?.getComputedTiming().iterations !== Infinity
  ).map(animation => animation.finished.catch(() => {}))
));
try {
  await page.goto(process.env.XIAOYU_BROWSER_URL || 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator('#view [data-action="new-project"]').click();
  await page.locator('#project-name').fill('浏览器持久化验收');
  await page.locator('[data-action="save-project"]').click();
  await page.waitForFunction(() => DB.projects.some(p => p.name === '浏览器持久化验收'));
  const projectId = await page.evaluate(() => state.projectId);
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.evaluate(id => !!projectById(id), projectId), true);
  await page.locator(`[data-action="project"][data-id="${projectId}"]`).first().click();
  await page.locator('[data-action="delete-project"]').click();
  await page.locator('[data-action="confirm-delete-project"]').click();
  await page.waitForFunction(id => !projectById(id), projectId);
  await page.evaluate(() => persistWorkbench());
  await page.reload();
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
  assert.equal(await page.evaluate(id => !!projectById(id), projectId), false);
  await page.locator('[data-action="nav"][data-view="data"]').click();
  for (const id of ['feishu', 'dingtalk', 'wecom', 'mail', 'ics']) {
    await page.locator(`.connector-card[data-id="${id}"]`).click();
    assert.equal(await page.locator('[data-action="connector-save"]').isDisabled(), true);
    assert.match(await page.locator('.integration-notice').innerText(), /桌面测试版/);
    await page.locator('.integration-modal [data-action="close-modal"]').click();
  }
  await page.locator('[data-action="nav"][data-view="projects"]').first().click();
  await page.locator('.project-register').scrollIntoViewIfNeeded();
  await finishAnimations();
  await page.screenshot({ path: resolve(evidence, 'browser-project-register.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await finishAnimations();
  await page.screenshot({ path: resolve(evidence, 'browser-project-mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => ({
    width: innerWidth, document: document.documentElement.scrollWidth,
    view: document.querySelector('#view').getBoundingClientRect().right
  }));
  assert.ok(overflow.document <= overflow.width + 1 && overflow.view <= overflow.width + 1, JSON.stringify(overflow));
  await page.locator('#view [data-action="new-project"]').click();
  await finishAnimations();
  const modal = await page.locator('.project-editor').boundingBox();
  assert.ok(modal.x >= 0 && modal.x + modal.width <= 391);
  await page.screenshot({ path: resolve(evidence, 'browser-project-mobile-modal.png') });
  await page.locator('[data-action="project-stakeholder-add"]').click();
  await page.locator('[data-stakeholder-name]').fill('长姓名干系人项目审批负责人');
  await page.locator('[data-stakeholder-role]').fill('客户业务负责人及项目验收代表');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#project-stakeholders-title').scrollIntoViewIfNeeded();
    await finishAnimations();
    const dimensions = await page.locator('.project-editor').evaluate(element => ({
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      bodyWidth: element.querySelector('.modal-body').clientWidth,
      bodyScroll: element.querySelector('.modal-body').scrollWidth
    }));
    assert.ok(dimensions.left >= 0 && dimensions.right <= width && dimensions.bodyScroll <= dimensions.bodyWidth + 1,
      'stakeholder editor: ' + JSON.stringify(dimensions));
    const controls = await page.locator('.stakeholder-editor-row input, .stakeholder-editor-row button')
      .evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }));
    for (let i = 0; i < controls.length; i++) {
      assert.ok(controls[i].left >= dimensions.left && controls[i].right <= dimensions.right);
      for (const other of controls.slice(i + 1)) {
        const rect = controls[i];
        assert.ok(rect.right <= other.left || other.right <= rect.left || rect.bottom <= other.top || other.bottom <= rect.top);
      }
    }
    await page.screenshot({ path: resolve(evidence, `browser-stakeholders-${width}.png`) });
  }
  await page.locator('#project-name').fill('干系人布局验收项目');
  await page.locator('[data-stakeholder-name]').fill('Stakeholder'.repeat(8));
  await page.locator('[data-stakeholder-role]').fill('项目客户业务及验收负责人'.repeat(6));
  await page.locator('[data-action="save-project"]').click();
  await page.locator('.project-editor').waitFor({ state: 'detached' });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.project-stakeholder-panel').scrollIntoViewIfNeeded();
    await finishAnimations();
    const dimensions = await page.locator('.project-stakeholder-panel').evaluate(element => ({
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      width: element.clientWidth, scroll: element.scrollWidth
    }));
    assert.ok(dimensions.left >= 0 && dimensions.right <= width && dimensions.scroll <= dimensions.width + 1,
      'stakeholder overview: ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-stakeholders-overview-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-action="nav"][data-view="data"]').click();
  await page.locator('.connector-card[data-id="mail"]').click();
  await finishAnimations();
  const integrationModal = await page.locator('.integration-modal').boundingBox();
  assert.ok(integrationModal.x >= 0 && integrationModal.x + integrationModal.width <= 391);
  await page.screenshot({ path: resolve(evidence, 'browser-integration-mobile.png') });
  await page.locator('.integration-modal [data-action="close-modal"]').click();
  for (const view of ['today', 'chat', 'inbox', 'projects', 'reports', 'profile', 'data']) {
    await page.locator(`.nav [data-action="nav"][data-view="${view}"]`).click();
    await finishAnimations();
    const dimensions = await page.evaluate(() => ({
      width: innerWidth, document: document.documentElement.scrollWidth,
      right: document.querySelector('#view').getBoundingClientRect().right
    }));
    assert.ok(dimensions.document <= dimensions.width + 1 && dimensions.right <= dimensions.width + 1,
      view + ': ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-mobile-${view}.png`), fullPage: true });
  }
  await page.locator('.nav [data-view="inbox"]').click();
  await page.evaluate(() => {
    DB.inboxArchive.push({ id: 'browser-archive-check', title: '归档清空布局验收', deletedAt: new Date().toISOString() });
  });
  await page.locator('[data-action="inbox-archive"]').click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await finishAnimations();
    const title = await page.locator('#modal-root h2').boundingBox();
    const clear = await page.locator('[data-action="inbox-archive-clear"]').boundingBox();
    const close = await page.locator('#modal-root [data-action="close-modal"]').boundingBox();
    assert.ok(title.x + title.width <= clear.x && clear.x + clear.width <= close.x);
    assert.ok(close.x + close.width <= width);
    await page.screenshot({ path: resolve(evidence, `browser-archive-${width}.png`) });
  }
  await page.locator('[data-action="inbox-archive-clear"]').click();
  await page.locator('#modal-root [data-action="inbox-archive"]').click();
  assert.equal(await page.evaluate(() => DB.inboxArchive.some(i => i.id === 'browser-archive-check')), true);
  await page.locator('#modal-root [data-action="close-modal"]').click();
  await page.locator('.nav [data-view="chat"]').click();
  await page.locator('[data-action="chat-attachment"]').click();
  await page.locator('#text-file').setInputFiles({ name: '附件编辑布局验收.md', mimeType: 'text/markdown',
    buffer: Buffer.from('# 项目名称：移动附件验收\n完成设备清单整理\n提交验收材料') });
  await page.locator('[data-action="document-import"]').click();
  await page.locator('.document-editor').waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await finishAnimations();
    const dimensions = await page.locator('.document-editor').evaluate(element => ({
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      bodyWidth: element.querySelector('.modal-body').clientWidth,
      bodyScroll: element.querySelector('.modal-body').scrollWidth
    }));
    assert.ok(dimensions.left >= 0 && dimensions.right <= width && dimensions.bodyScroll <= dimensions.bodyWidth + 1,
      'document editor: ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-document-${width}.png`) });
  }
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await page.evaluate(() => {
    // Layout uses an isolated fake bridge; real requests are verified by the desktop audit.
    window.xiaoyuDesktop = {
      providerModels: async () => ({ models: ['image-model', 'text-model-with-a-long-provider-name'], endpoint: 'http://127.0.0.1/v1/models' }),
      providerDiagnose: async () => ({ ok: false, models: ['text-model-with-a-long-provider-name'],
        model: 'text-model-with-a-long-provider-name',
        checks: [{ name: '配置完整性', status: 'pass', detail: '地址与密钥已填写。' },
          { name: '模型列表', status: 'pass', detail: '已获取模型。', endpoint: 'http://127.0.0.1:12345/v1/models' },
          { name: '真实请求', status: 'fail', detail: 'HTTP 403：模型无权限。上游说明：model access denied; request-id=layout-test-long-response',
            endpoint: 'http://127.0.0.1:12345/compatible-gateway/v1/responses', durationMs: 183 }],
        suggestion: '检查当前密钥的模型授权和网关限制，输入内容已保留。' })
    };
  });
  await page.locator('[data-action="profile-settings"]').first().click();
  await page.locator('#custom-provider-base').fill('http://127.0.0.1:12345');
  await page.locator('#custom-provider-key').fill('layout-test-only');
  await page.waitForFunction(() => document.getElementById('custom-provider-model').value.includes('text-model'));
  await page.locator('[data-action="test-custom-provider"]').click();
  await page.locator('.provider-check.fail').waitFor();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('#custom-provider-diagnosis').scrollIntoViewIfNeeded();
    await finishAnimations();
    const dimensions = await page.locator('.profile-modal').evaluate(element => ({
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      bodyWidth: element.querySelector('.modal-body').clientWidth,
      bodyScroll: element.querySelector('.modal-body').scrollWidth
    }));
    assert.ok(dimensions.left >= 0 && dimensions.right <= width && dimensions.bodyScroll <= dimensions.bodyWidth + 1,
      'provider configuration: ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-provider-${width}.png`) });
  }
  await page.evaluate(() => { delete window.xiaoyuDesktop; });
  await page.locator('#modal-root [data-action="close-modal"]').first().click();
  await page.evaluate(() => {
    DB.settings.aiProvider = 'custom';
    DB.settings.customProvider = { name: '自定义供应商长名称布局验收',
      baseUrl: 'http://127.0.0.1', apiKey: 'layout-only', model: 'text-model-with-a-very-long-provider-model-name' };
    state.chatMessages = [{ role: 'assistant', model: 'text-model-with-a-very-long-provider-model-name',
      time: '现在', text: '请确认任务安排。', actionCard: modelChatCard({ type: 'task', title: '完成模型任务验收',
        projectId: 'p1', date: '2026-10-23', due: '2026-10-24', assignee: '小陈',
        estimateHours: 2, priority: 'P2' }, '安排验收') }];
    state.view = 'chat';
    render();
  });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await finishAnimations();
    const dimensions = await page.evaluate(() => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      composerWidth: document.querySelector('.composer-bar').clientWidth,
      composerScroll: document.querySelector('.composer-bar').scrollWidth,
      cardWidth: document.querySelector('.action-card').clientWidth,
      cardScroll: document.querySelector('.action-card').scrollWidth
    }));
    assert.ok(dimensions.scrollWidth <= width + 1 && dimensions.composerScroll <= dimensions.composerWidth + 1 &&
      dimensions.cardScroll <= dimensions.cardWidth + 1, 'model chat: ' + JSON.stringify(dimensions));
    await page.screenshot({ path: resolve(evidence, `browser-model-chat-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => {
    state.chatMessages.push(...Array.from({ length: 40 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', time: '布局验收', model: '布局验收',
      text: `第 ${index + 1} 条长对话\n${'检查滚动时输入区保持在窗口底部。'.repeat(12)}`
    })));
    render();
  });
  const chatLayouts = [];
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 1280, height: 720 }, { width: 390, height: 844 },
    { width: 390, height: 600 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await finishAnimations();
    await page.evaluate(() => scrollChatToBottom());
    const before = await page.locator('.chat-composer').boundingBox();
    const dimensions = await page.evaluate(() => {
      const thread = document.getElementById('chat-thread');
      const composer = document.querySelector('.chat-composer').getBoundingClientRect();
      return {
        width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight, composerBottom: composer.bottom,
        composerTop: composer.top, threadBottom: thread.getBoundingClientRect().bottom,
        threadHeight: thread.clientHeight, threadScroll: thread.scrollTop,
        lastMessageBottom: thread.lastElementChild.getBoundingClientRect().bottom
      };
    });
    assert.ok(dimensions.pageWidth <= viewport.width + 1 && dimensions.pageHeight <= viewport.height + 1 &&
      Math.abs(dimensions.composerBottom - viewport.height) <= 2 && dimensions.threadHeight >= 60 &&
      dimensions.threadBottom <= dimensions.composerTop + 1 &&
      dimensions.lastMessageBottom <= dimensions.threadBottom + 1, 'fixed composer: ' + JSON.stringify(dimensions));
    assert.ok(dimensions.threadScroll > 0, 'long thread must scroll');
    await page.locator('#chat-thread').hover();
    await page.mouse.wheel(0, -700);
    await page.waitForFunction(previous => document.getElementById('chat-thread').scrollTop < previous, dimensions.threadScroll);
    const after = await page.locator('.chat-composer').boundingBox();
    assert.ok(Math.abs(before.y - after.y) <= 1 && Math.abs(before.height - after.height) <= 1);
    assert.equal(await page.evaluate(() => scrollY), 0);
    if (await page.locator('.chat-rail').isVisible()) {
      await page.locator('.chat-rail').hover();
      await page.mouse.wheel(0, 1200);
      const rail = await page.locator('.chat-rail').evaluate(element => ({
        scroll: element.scrollTop, contentHeight: element.scrollHeight, height: element.clientHeight
      }));
      if (rail.contentHeight > rail.height + 1) {
        await page.waitForFunction(() => document.querySelector('.chat-rail').scrollTop > 0);
      }
      assert.equal(await page.evaluate(() => scrollY), 0);
    }
    await page.locator('#chat-input').fill('多行输入第一行\n第二行\n第三行');
    const send = await page.locator('[data-action="chat-send"]').boundingBox();
    assert.ok(send.y >= dimensions.composerTop && send.y + send.height <= viewport.height);
    await page.screenshot({ path: resolve(evidence, `browser-chat-fixed-${viewport.width}x${viewport.height}.png`) });
    chatLayouts.push({ viewport, ...dimensions });
  }
  await page.locator('.nav [data-view="projects"]').click();
  assert.equal(await page.locator('.view-chat').count(), 0);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  assert.ok(await page.evaluate(() => scrollY > 0), 'other pages must keep normal scrolling');
  await page.locator('.nav [data-view="chat"]').click();
  await finishAnimations();
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, projectId, overflow, chatLayouts }));
} finally {
  await browser.close();
}
