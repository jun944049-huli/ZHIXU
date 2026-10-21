/* Shared state, icons and helpers */

let savedTheme = 'light';
try { savedTheme = storageGet('jw-theme') || 'light'; } catch (e) { /* ignore */ }

const state = {
  view: 'today',
  todayDate: null,
  todayRange: 'day',
  todayMenu: false,
  projectId: 'p1',
  projectTab: 'overview',
  report: 'weekly',
  reportDate: DB.meta.today,
  inboxId: 'i1',
  fieldsTab: 'task',
  captureSource: '飞书',
  impactOption: 'scope',
  profileDraft: { color: '' },
  chatMessages: null,
  chatModel: 'DeepSeek',
  chatContext: 'auto',
  chatSending: false,
  chatRequestId: 0,
  chatShortcuts: null,
  chatShortcutsDraft: [],
  polishSource: '',
  polishText: '',
  polishTone: '简洁',
  polishResult: '',
  polishLoading: false,
  polishStatus: 'local',
  polishStatusText: '',
  polishRequestId: 0,
  polishTimer: null,
  theme: savedTheme
};

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  inbox: '<path d="M5 4h14l2 9v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2-9z"/><path d="M3 13h4l2 3h6l2-3h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  layout: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  sparkles: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5l11 7-11 7V5z" fill="currentColor" stroke="none"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  shield: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/>',
  zap: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  flag: '<path d="M4 21V4M4 4h11l-2 4 2 4H4"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  filter: '<path d="M3 4h18l-7 8v7l-4 2v-9L3 4z"/>',
  target2: '<circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3v9h9z"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h5a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h7"/>',
  lightbulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3 11v4h6v-4a6 6 0 0 0-3-11z"/>'
};

function icon(name, size = 16, cls = '') {
  const body = ICONS[name] || ICONS.sparkles;
  return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function projectById(id) {
  return DB.projects.find(p => p.id === id) || null;
}

function allWorkbenchTasks() {
  return [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could,
    ...Object.values(DB.taskCalendar || {}).flat()];
}

function assistantName() {
  return (DB.settings && String(DB.settings.assistantName || '').trim()) || '小鱼';
}

function deepseekKey() {
  return String((DB.settings && DB.settings.deepseekKey) || '').trim();
}

function detectAIProvider(baseUrl, model) {
  const b = String(baseUrl || '').toLowerCase();
  const m = String(model || '').toLowerCase();
  if (b.includes('deepseek') || m.startsWith('deepseek')) return 'DeepSeek';
  if (b.includes('openai') || /^gpt-|^o[134]/.test(m)) return 'OpenAI';
  if (b.includes('moonshot') || b.includes('kimi') || m.includes('moonshot') || m.includes('kimi')) return 'Moonshot / Kimi';
  if (b.includes('bigmodel') || b.includes('zhipu') || m.includes('glm')) return '智谱 GLM';
  if (b.includes('dashscope') || b.includes('aliyun') || m.includes('qwen')) return '阿里通义千问';
  if (b.includes('minimax') || m.includes('minimax') || m.includes('abab')) return 'MiniMax';
  if (b.includes('anthropic') || m.includes('claude')) return 'Anthropic';
  if (b.includes('generativelanguage') || b.includes('googleapis') || m.includes('gemini')) return 'Google Gemini';
  if (b.includes('localhost') || b.includes('127.0.0.1') || b.includes('ollama')) return 'Ollama / 本地';
  return 'OpenAI 兼容';
}

function aiProviderConfig() {
  const s = DB.settings || {};
  const custom = s.customProvider || {};
  if (s.aiProvider === 'custom' && custom.apiKey && custom.baseUrl && custom.model) {
    return {
      id: 'custom',
      name: custom.name || custom.detected || '自定义供应商',
      baseUrl: String(custom.baseUrl || '').replace(/\/+$/, ''),
      apiKey: String(custom.apiKey || ''),
      model: String(custom.model || ''),
      detected: custom.detected || ''
    };
  }
  const key = deepseekKey();
  if (key) {
    return {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: key,
      model: 'deepseek-chat',
      detected: 'DeepSeek'
    };
  }
  return { id: 'local', name: '本地规则', baseUrl: '', apiKey: '', model: '', detected: '' };
}

function aiProviderName() {
  return aiProviderConfig().name;
}

function hasAIProvider() {
  return aiProviderConfig().id !== 'local';
}

function refreshAIProviderUI() {
  const cfg = aiProviderConfig();
  const nameEl = document.getElementById('sidebar-ai-name');
  const statusEl = document.getElementById('sidebar-ai-status');
  const pulse = document.getElementById('sidebar-ai-pulse');
  if (nameEl) nameEl.textContent = cfg.name;
  if (statusEl) statusEl.textContent = cfg.id === 'local' ? '未配置' : '已连接';
  if (pulse) pulse.className = 'pulse' + (cfg.id === 'local' ? ' off' : '');
  const pill = document.getElementById('topbar-ai-pill');
  if (pill) {
    pill.innerHTML = `<span class="dot ${cfg.id === 'local' ? 'off' : ''}"></span><strong>${esc(cfg.name)}</strong><span>${cfg.id === 'local' ? '未配置 · 本地规则' : '已连接 · ' + esc(cfg.model)}</span>`;
  }
}

function saveSettings() {
  try {
    storageSet('jw-settings', JSON.stringify(DB.settings || {}));
  } catch (e) { /* ignore */ }
}

function projectNotesFor(id) {
  if (!DB.projectNotes) DB.projectNotes = {};
  if (!Array.isArray(DB.projectNotes[id])) DB.projectNotes[id] = [];
  return DB.projectNotes[id];
}

function saveProjectNotes() {
  try {
    storageSet('jw-project-notes', JSON.stringify(DB.projectNotes || {}));
  } catch (e) { /* ignore */ }
}

function parseISODate(iso) {
  const parts = String(iso || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDaysISO(iso, days) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function weekdayCN(iso) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseISODate(iso).getDay()];
}

function formatDateFull(iso) {
  const d = parseISODate(iso);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${weekdayCN(iso)}`;
}

function formatDateShort(iso) {
  const d = parseISODate(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${weekdayCN(iso)}`;
}

function startOfWeekISO(iso) {
  const d = parseISODate(iso);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return toISODate(d);
}

function nextMondayISO(iso) {
  const d = parseISODate(iso);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 1 ? 7 : (8 - day) % 7));
  return toISODate(d);
}

function formatDateRange(startIso, endIso) {
  const s = parseISODate(startIso);
  const e = parseISODate(endIso);
  const sm = s.getMonth() + 1;
  const em = e.getMonth() + 1;
  return sm === em
    ? `${sm} 月 ${s.getDate()}–${e.getDate()} 日`
    : `${sm} 月 ${s.getDate()} 日 – ${em} 月 ${e.getDate()} 日`;
}

function tasksOnDate(iso) {
  if (iso === DB.meta.today) return [...DB.tasks.must, ...DB.tasks.should, ...DB.tasks.could];
  return (DB.taskCalendar && DB.taskCalendar[iso]) || [];
}

function tasksInRange(startIso, endIso) {
  const out = [];
  let cur = startIso;
  while (cur <= endIso) {
    tasksOnDate(cur).forEach(t => out.push(Object.assign({}, t, { _date: cur })));
    cur = addDaysISO(cur, 1);
  }
  return out;
}

function parseEstimateHours(value) {
  const s = String(value || '').trim().toLowerCase();
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/);
  if (h) return Number(h[1]);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m/);
  if (m) return Number(m[1]) / 60;
  return 0;
}

function formatHours(hours) {
  const n = Math.max(0, Math.round(Number(hours || 0) * 10) / 10);
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(1)}h`;
}

function healthLabel(h) {
  return h === 'red' ? '风险' : h === 'amber' ? '关注' : '正常';
}

function sourceClass(s) {
  if (s === '飞书') return 'boss';
  if (s === '邮件') return 'client';
  if (s === '会议') return 'meeting';
  return 'self';
}

function confidenceTone(c) {
  if (c >= 85) return 'green';
  if (c >= 65) return 'amber';
  return 'red';
}

function avatar(member, size = 'sm') {
  return `<span class="avatar ${size}" style="background:${member.c}" title="${esc(member.i)}">${esc(member.i)}</span>`;
}

function projectChip(id) {
  const p = projectById(id);
  if (!p) return `<span class="proj"><i style="background:var(--ink-3)"></i>个人</span>`;
  return `<span class="proj"><i style="background:${p.color}"></i>${esc(p.name)}</span>`;
}

function pct(n) {
  return Math.max(0, Math.min(100, n));
}
