import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(import.meta.dirname, '..');
const evidence = join(root, '.desktop-test');
mkdirSync(evidence, { recursive: true });
const profile = mkdtempSync(join(evidence, 'stakeholder-profile-'));
const { ELECTRON_RUN_AS_NODE, ...environment } = process.env;
const errors = [];
let application, page;
const launch = async () => {
  application = await electron.launch({
    executablePath: process.env.XIAOYU_TEST_EXE || join(root, 'node_modules/electron/dist/electron.exe'),
    args: process.env.XIAOYU_TEST_EXE ? [] : [join(root, 'out/main/index.js')],
    cwd: root, env: { ...environment, XIAOYU_DATA_DIR: profile }
  });
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof workbenchReady !== 'undefined' && workbenchReady);
};
const add = async (name, role = '') => {
  await page.locator('[data-action="project-stakeholder-add"]').click();
  const row = page.locator('.stakeholder-editor-row').last();
  await row.locator('[data-stakeholder-name]').fill(name);
  await row.locator('[data-stakeholder-role]').fill(role);
};
const save = async () => {
  await page.locator('[data-action="save-project"]').click();
  await page.locator('.project-editor').waitFor({ state: 'detached' });
  await page.evaluate(() => persistWorkbench());
};
const manage = () => page.locator('[data-action="edit-project-stakeholders"]').click();
const close = () => page.locator('#modal-root [data-action="close-modal"]').first().click();
try {
  await launch();
  await page.evaluate(() => {
    projectById('p1').customValues = { 'inactive-stakeholder-fixture': '原有扩展值' };
    state.view = 'project'; state.projectId = 'p1'; state.projectTab = 'overview'; render();
  });
  const original = await page.evaluate(() => JSON.stringify({ p: projectById('p1'), detail: detailForProject(projectById('p1')) }));
  await manage();
  const oldCount = await page.locator('.stakeholder-editor-row').count();
  await page.locator('#project-goal').fill('取消应保留原项目目标');
  await page.locator('[data-stakeholder-name]').first().fill('不应保存');
  await add('取消新增', '客户');
  await page.locator('[data-action="project-stakeholder-remove"]').first().click();
  await close();
  assert.equal(await page.evaluate(() => JSON.stringify({ p: projectById('p1'), detail: detailForProject(projectById('p1')) })), original);

  await manage();
  assert.equal(await page.locator('.stakeholder-editor-row').count(), oldCount);
  await page.locator('#project-goal').fill('编辑干系人时保留的项目目标');
  await page.locator('[data-stakeholder-name]').first().fill('Alice Wang');
  await page.locator('[data-stakeholder-role]').first().fill('业务负责人');
  await add('<script>客户甲</script>', '外部审批');
  assert.equal(await page.locator('[data-stakeholder-name]').first().inputValue(), 'Alice Wang');
  assert.equal(await page.locator('#project-goal').inputValue(), '编辑干系人时保留的项目目标');
  await add('', '待补姓名');
  await page.locator('[data-action="save-project"]').click();
  assert.match(await page.locator('#project-stakeholder-error').innerText(), /请填写第/);
  assert.equal(await page.locator('.project-editor').count(), 1);
  assert.equal(await page.evaluate(() => JSON.stringify({ p: projectById('p1'), detail: detailForProject(projectById('p1')) })), original);
  await page.locator('[data-action="project-stakeholder-remove"]').last().click();
  assert.equal(await page.locator('[data-stakeholder-name]').last().inputValue(), '<script>客户甲</script>');
  await save();
  const saved = await page.evaluate(() => ({ p: projectById('p1'), detail: detailForProject(projectById('p1')) }));
  const before = JSON.parse(original);
  assert.equal(saved.detail.stakeholders.length, oldCount + 1);
  assert.equal(saved.detail.stakeholders[0].i, 'AW');
  assert.equal(saved.detail.stakeholders[0].role, '业务负责人');
  for (const key of ['risks', 'milestones', 'docs', 'activity']) assert.deepEqual(saved.detail[key], before.detail[key]);
  for (const [key, value] of Object.entries(before.p.customValues)) assert.equal(saved.p.customValues[key], value);
  assert.deepEqual(saved.p.members, before.p.members);
  assert.equal(saved.p.goal, '编辑干系人时保留的项目目标');
  assert.match(await page.locator('.project-stakeholder-panel').innerText(), /Alice Wang.*业务负责人/s);
  assert.match(await page.locator('.project-stakeholder-panel').innerText(), /<script>客户甲<\/script>/);
  assert.equal(await page.locator('.project-stakeholder-panel script').count(), 0);
  await application.close();
  await launch();
  await page.evaluate(() => { state.view = 'project'; state.projectId = 'p1'; state.projectTab = 'overview'; render(); });
  assert.deepEqual(await page.evaluate(() => DB.projectDetails.p1.stakeholders), saved.detail.stakeholders);
  await manage();
  while (await page.locator('.stakeholder-editor-row').count()) {
    await page.locator('[data-action="project-stakeholder-remove"]').first().click();
  }
  await save();
  assert.match(await page.locator('.project-stakeholder-panel').innerText(), /0 人.*尚未添加干系人/s);
  await manage();
  assert.equal(await page.locator('.stakeholder-editor-row').count(), 0);
  await close();

  await page.locator('.nav [data-view="projects"]').click();
  await page.locator('#view [data-action="new-project"]').click();
  await page.locator('#project-name').fill('干系人专项验收项目');
  await add('新项目客户', '客户代表');
  await add('新项目成员');
  await save();
  const newId = await page.evaluate(() => state.projectId);
  await application.close();
  await launch();
  assert.deepEqual(await page.evaluate(() => DB.projectDetails.p1.stakeholders), []);
  assert.equal(await page.evaluate(id => DB.projectDetails[id].stakeholders[1].role, newId), '项目成员');
  await page.evaluate(id => { state.view = 'project'; state.projectId = id; state.projectTab = 'overview'; render(); }, newId);
  await manage();
  await page.locator('[data-action="project-stakeholder-remove"]').first().click();
  await page.locator('[data-stakeholder-name]').fill('修改后的成员');
  await page.locator('[data-stakeholder-role]').fill('验收负责人');
  await save();
  assert.match(await page.locator('.project-stakeholder-panel').innerText(), /1 人.*修改后的成员.*验收负责人/s);
  await application.close();
  application = null;
  const database = new DatabaseSync(join(profile, 'workbench.sqlite'), { readOnly: true });
  try {
    const snapshot = JSON.parse(database.prepare('SELECT payload FROM workbench WHERE id = 1').get().payload);
    assert.deepEqual(snapshot.db.projectDetails.p1.stakeholders, []);
    assert.equal(snapshot.db.projectDetails[newId].stakeholders.length, 1);
    assert.equal(snapshot.db.projectDetails[newId].stakeholders[0].name, '修改后的成员');
    assert.equal(snapshot.db.projectDetails[newId].stakeholders[0].role, '验收负责人');
  } finally { database.close(); }
  assert.deepEqual(errors, []);
  const result = { passed: true, originalPeople: oldCount, addEditRemove: true, cancelKeepsData: true,
    validationKeepsDraft: true, oldProjectDataPreserved: true, emptyListPersisted: true,
    realRestartAndSQLite: true, newId, profile };
  writeFileSync(join(evidence, 'stakeholder-audit.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(await page?.locator('body').innerText().catch(() => 'Window unavailable'));
  throw error;
} finally { await application?.close(); }
