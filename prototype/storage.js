/* Storage is shared by the browser preview and the isolated desktop bridge. */
const workbenchPreferences = {};
let workbenchReady = false;
let workbenchLastSaved = '';
let workbenchLastQueued = '';
let workbenchSaveTimer = null;
let workbenchSaveQueue = Promise.resolve();

function storageGet(key) {
  if (window.xiaoyuDesktop) return workbenchPreferences[key] || null;
  return localStorage.getItem(key);
}

function storageSet(key, value) {
  if (window.xiaoyuDesktop) {
    workbenchPreferences[key] = String(value);
    scheduleWorkbenchSave();
  } else {
    localStorage.setItem(key, value);
  }
}

function workbenchSnapshot() {
  return JSON.parse(JSON.stringify({ db: DB, preferences: workbenchPreferences }));
}

function updateStorageStatus(saved) {
  const label = document.getElementById('workspace-storage-status');
  if (label) label.textContent = saved
    ? '已保存'
    : '保存失败';
}

function persistWorkbench() {
  clearTimeout(workbenchSaveTimer);
  if (!workbenchReady) return Promise.resolve();
  const snapshot = workbenchSnapshot();
  const serialized = JSON.stringify(snapshot);
  if (serialized === workbenchLastQueued) {
    if (serialized === workbenchLastSaved) updateStorageStatus(true);
    return workbenchSaveQueue;
  }
  workbenchLastQueued = serialized;
  workbenchSaveQueue = workbenchSaveQueue.catch(() => {}).then(async () => {
    if (window.xiaoyuDesktop) await window.xiaoyuDesktop.save(snapshot);
    else localStorage.setItem('jw-workbench', serialized);
    workbenchLastSaved = serialized;
    updateStorageStatus(true);
  }).catch(error => {
    if (workbenchLastQueued === serialized) workbenchLastQueued = '';
    updateStorageStatus(false);
    showToast('保存失败：' + (error.message || '请检查本机存储空间'));
    throw error;
  });
  return workbenchSaveQueue;
}

function scheduleWorkbenchSave() {
  if (!workbenchReady) return;
  clearTimeout(workbenchSaveTimer);
  workbenchSaveTimer = setTimeout(() => { void persistWorkbench().catch(() => {}); }, 150);
}

function advanceWorkbenchDate() {
  const now = new Date();
  const today = [
    now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  if (DB.meta.today === today) return;
  DB.taskCalendar = DB.taskCalendar || {};
  DB.taskCalendar[DB.meta.today] = [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could];
  const scheduled = DB.taskCalendar[today] || [];
  DB.tasks = { must: [], should: [], could: [] };
  scheduled.forEach(task => {
    const bucket = ['P0', 'P1'].includes(task.priority) ? 'must' : task.priority === 'P4' ? 'could' : 'should';
    DB.tasks[bucket].push(task);
  });
  delete DB.taskCalendar[today];
  DB.meta.today = today;
  DB.meetings = [];
  DB.workday.blocks = [];
  DB.capacity.meeting = 0;
}

async function initializeWorkbenchStorage() {
  let snapshot;
  if (window.xiaoyuDesktop) snapshot = await window.xiaoyuDesktop.load();
  else {
    const raw = localStorage.getItem('jw-workbench');
    if (raw) {
      try { snapshot = JSON.parse(raw); }
      catch (error) { throw new Error('本地工作数据无法读取，已保留原始数据'); }
    }
  }
  if (snapshot && snapshot.db) {
    Object.assign(DB, snapshot.db);
    Object.assign(workbenchPreferences, snapshot.preferences || {});
  }
  advanceWorkbenchDate();
  workbenchReady = true;
  window.addEventListener('beforeunload', event => {
    if (!window.xiaoyuDesktop) {
      void persistWorkbench().catch(() => {});
      return;
    }
    // The desktop main process waits for persistWorkbench before closing.
  });
  if (!window.xiaoyuDesktop) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void persistWorkbench().catch(() => {});
    });
  }
}

async function requestPolish(payload) {
  if (window.xiaoyuDesktop) {
    try {
      const result = await window.xiaoyuDesktop.polish(payload);
      return { ok: true, status: 200, json: async () => result };
    } catch (error) {
      return { ok: false, status: 502, json: async () => ({ message: error.message }) };
    }
  }
  return fetch('/api/polish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}
