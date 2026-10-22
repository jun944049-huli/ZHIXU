/* Imported documents and editable analysis share the workbench snapshot. */
function documentById(id) {
  return DB.documents.find(doc => doc.id === id);
}

function documentEngineChoices() {
  const provider = aiProviderConfig();
  return [['local', '本地规则'], ...(provider.id !== 'local' ? [['ai', provider.name + ' · ' + provider.model]] : [])];
}

function openDocumentImport(target = 'chat') {
  state.documentImportResults = new Map();
  state.importTarget = target;
  state.importProjectId = target === 'project' ? projectById(state.projectId)?.id || '' :
    projectById(state.chatContext)?.id || '';
  localModal('上传并分析附件', `<div class="form-grid">
    <div class="field full"><label for="text-file">Word / Excel / PDF / PowerPoint / 文本 · 每个文件不超过 50 MB</label>
    <input class="input" type="file" id="text-file" multiple accept=".doc,.docx,.xlsx,.pdf,.pptx,.txt,.md,.csv"></div>
    ${selectField('import-project', '项目归属', [['', '自动识别；新项目待确认'], ...DB.projects.map(p => [p.id, p.name])], state.importProjectId)}
    ${selectField('document-engine', '分析方式', documentEngineChoices(), hasAIProvider() ? 'ai' : 'local')}
    ${textField('document-instructions', '通用分析指令', DB.documentInstructions || '提取可执行任务、负责人、截止日期和交付物；缺失信息标记待确认，不推测承诺。')}
    </div><p class="small muted mt-12">${window.xiaoyuDesktop?.importDocument
      ? '支持 DOC、DOCX、XLSX、PDF、PPTX、TXT、MD、CSV。旧版 XLS、PPT 请先另存为 XLSX、PPTX。'
      : '浏览器预览支持文本；Word、Excel、PDF 和 PPTX 请使用桌面版。'}</p>
    <p class="small muted mt-12">原文件先保存，再解析正文。解析失败可从附件记录重新解析或导出原文件。扫描 PDF 需先 OCR。</p>
    <p class="small muted mt-12">选择 AI 时，正文会发送到已配置的供应商；本地规则只提取行动语句，自定义分析指令由 AI 处理。</p>
    <div id="document-import-status" class="small mt-12" role="status" aria-live="polite"></div>
    <div id="document-import-results" class="document-import-results"></div>`,
    `<button class="btn" data-action="document-library">${icon('file', 13)} 附件记录 · 待确认 ${DB.documents.filter(d => !d.projectId).length}</button>
    <button class="btn btn-primary" data-action="document-import">${icon('upload', 13)} 上传并分析</button>`, 'document-import-modal');
}

async function analyzeImportedDocument(doc) {
  if (doc.parseError || !doc.content.trim()) throw new Error('正文尚未解析成功，请先重新解析原文件');
  const provider = aiProviderConfig();
  const input = { text: doc.content, name: doc.title, today: DB.meta.today,
    instructions: doc.instructions, projects: DB.projects.map(p => ({ id: p.id, name: p.name })) };
  if (doc.analysisEngine !== 'local' && provider.id !== 'local') input.provider = {
    apiKey: provider.apiKey, baseUrl: provider.baseUrl, model: provider.model, provider: provider.name,
    protocol: provider.protocol || 'auto'
  };
  if (window.xiaoyuDesktop?.analyzeDocument) return window.xiaoyuDesktop.analyzeDocument(input);
  const matches = DB.projects.filter(p => (doc.title + '\n' + doc.content).includes(p.name));
  const lines = doc.content.split('\n').map(line => line.trim()).filter(Boolean);
  return { summary: lines.slice(0, 6).join('\n').slice(0, 3000),
    projectId: matches.length === 1 ? matches[0].id : null,
    projectName: doc.title.replace(/\.[^.]+$/, ''),
    tasks: [...new Set(lines.filter(line => line.length >= 5 &&
      !/^(?:#+\s|项目(?:名称)?[：:])/.test(line) && !DB.projects.some(project => project.name === line) &&
      /完成|提交|交付|整理|确认|设计|开发|测试|上线|验收|跟进/.test(line)))]
      .slice(0, 80).map(line => ({ title: line.slice(0, 200), evidence: line.slice(0, 1000),
        due: '', assignee: '', priority: 'P2', estimateHours: 0 })),
    mode: '本地规则', warnings: ['浏览器使用本地规则，需检查候选任务。'] };
}

async function importDocuments() {
  if (state.documentImportBusy) return;
  const fileInput = document.getElementById('text-file');
  const files = [...(fileInput?.files || [])];
  if (!files.length || files.length > 10) { showToast('请一次选择 1 至 10 个文件'); return; }
  const projectId = fieldValue('import-project');
  if (projectId && !projectById(projectId)) { showToast('所选项目已不存在，请重新选择'); return; }
  const instructions = fieldValue('document-instructions').slice(0, 4000);
  const analysisEngine = fieldValue('document-engine') || 'local';
  DB.documentInstructions = instructions;
  state.documentImportBusy = true;
  const results = state.documentImportResults ||= new Map();
  const button = document.querySelector('[data-action="document-import"]');
  if (button) button.disabled = true;
  const controls = ['text-file', 'import-project', 'document-engine', 'document-instructions']
    .map(id => document.getElementById(id)).filter(Boolean);
  controls.forEach(control => { control.disabled = true; });
  const imported = [], failures = [];
  try {
    for (const [index, file] of files.entries()) {
      const previous = results.get(file);
      if (previous?.status === 'saved' && previous.id && documentById(previous.id)) { imported.push(previous.id); continue; }
      const status = document.getElementById('document-import-status');
      if (document.getElementById('text-file') === fileInput && status) {
        status.textContent = `正在解析和分析 ${index + 1}/${files.length}：${file.name}`;
      }
      try {
        if (!/\.(doc|docx|xlsx|pdf|pptx|txt|md|csv)$/i.test(file.name)) throw new Error('格式不支持；旧版 XLS、PPT 请另存为 XLSX、PPTX');
        if (!file.size) throw new Error('文件为空，请选择包含正文的文件');
        if (file.size > 50 * 1024 * 1024) throw new Error('文件超过 50 MB，请压缩或拆分后上传');
        let parsed;
        if (window.xiaoyuDesktop?.importDocument) {
          parsed = await window.xiaoyuDesktop.importDocument({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
        } else {
          if (!/\.(txt|md|csv)$/i.test(file.name)) throw new Error('此格式请使用桌面版上传');
          const text = await file.text();
          if (text.includes('\0') || !text.trim() || text.length > 120000) throw new Error('文本无效或正文超过 12 万字');
          parsed = { text, warnings: [] };
        }
        const existing = parsed.assetId && DB.documents.find(doc => doc.assetId === parsed.assetId &&
          (!projectId || doc.projectId === projectId));
        if (existing && !existing.parseError) {
          imported.push(existing.id);
          results.set(file, { id: existing.id, status: 'saved', reason: '已存在于附件记录，未重复导入' });
          continue;
        }
        const totalLimit = window.xiaoyuDesktop ? 10000000 : 1500000;
        if (DB.documents.reduce((sum, doc) => sum + (doc.id === existing?.id ? 0 : doc.content.length), 0) + parsed.text.length > totalLimit) {
          throw new Error('本机文档正文总量已达上限，请先导出整理；原文件已保留在附件目录');
        }
        const before = existing ? JSON.parse(JSON.stringify(existing)) : null;
        const doc = existing || { id: newRecordId('document'), projectId: null, title: file.name, createdAt: new Date().toISOString() };
        Object.assign(doc, { content: parsed.text, assetId: parsed.assetId || null, warnings: parsed.warnings || [],
          instructions, analysisEngine, requestedProjectId: projectId, parseError: parsed.parseError || '' });
        if (!existing) DB.documents.push(doc);
        try { await persistWorkbench(); }
        catch (error) {
          if (existing) Object.assign(existing, before);
          else DB.documents.splice(DB.documents.indexOf(doc), 1);
          throw new Error('本地记录保存失败：' + documentFailureReason(error));
        }
        imported.push(doc.id);
        if (doc.parseError) {
          const reason = '原文件已保存，正文解析失败：' + doc.parseError + '。可重试或从附件记录导出原文件。';
          failures.push(`${file.name}：${reason}`);
          results.set(file, { id: doc.id, status: 'failed', reason });
          continue;
        }
        if (document.getElementById('text-file') === fileInput && status) status.textContent =
          `原文件已保存，正在分析 ${index + 1}/${files.length}：${file.name}`;
        await finishDocumentAnalysis(doc, projectId);
        const warning = [...(doc.warnings || []), ...(doc.analysis?.warnings || [])]
          .find(message => /未完成|失败|暂未/.test(message));
        results.set(file, { id: doc.id, status: 'saved', reason: warning || '原文件与正文已保存' });
      } catch (error) {
        const reason = documentFailureReason(error);
        failures.push(`${file.name}：${reason}`);
        results.set(file, { status: 'failed', reason });
      }
    }
    render();
    if (document.getElementById('text-file') === fileInput) {
      if (failures.length) {
        document.getElementById('document-import-status').textContent =
          `已保存原文件 ${imported.length} 个，${failures.length} 个需重试。所选文件已保留。`;
        document.getElementById('document-import-results').innerHTML = files.map(file => {
          const result = results.get(file);
          return `<div class="document-import-result ${result.status === 'failed' ? 'failed' : 'saved'}">
            <b>${esc(file.name)} · ${result.status === 'failed' ? result.id ? '原文件已保存 · 解析待重试' : '上传失败' : '已保存'}</b>
            <p>${esc(result.reason)}</p>${result.id ? `<button class="btn btn-sm" data-action="document-open"
              data-id="${esc(result.id)}">查看与修改</button>` : ''}</div>`;
        }).join('');
        if (button) button.textContent = '重试失败文件';
      } else if (imported.length === 1) openDocumentEditor(imported[0]);
      else openDocumentLibrary();
    }
    showToast(`已保存 ${imported.length} 个原文件${failures.length ? `，${failures.length} 个需重试` : ''}`);
  } finally {
    state.documentImportBusy = false;
    if (button?.isConnected) button.disabled = false;
    controls.forEach(control => { if (control.isConnected) control.disabled = false; });
  }
}

async function finishDocumentAnalysis(doc, projectId) {
  try {
    doc.analysis = await analyzeImportedDocument(doc);
    doc.analysis.tasks.forEach(task => { task.id = newRecordId('draft'); task.selected = true; });
    const matched = projectId || doc.analysis.projectId;
    if (matched && projectById(matched)) await applyDocumentToProject(doc, matched);
    else await persistWorkbench();
  } catch (error) {
    doc.warnings.push('自动分析未完成，原文件已保存：' + documentFailureReason(error));
    try { await persistWorkbench(); }
    catch { doc.warnings.push('分析结果暂未写入数据库，请检查磁盘空间后重试保存。'); }
  }
}

async function reparseSavedDocument() {
  const doc = documentById(state.documentId);
  if (!doc?.assetId || state.documentReparsing) return;
  if (!window.xiaoyuDesktop?.reparseDocument) { showToast('请使用更新后的桌面版重新解析'); return; }
  state.documentReparsing = true;
  const button = document.querySelector('[data-action="document-reparse"]');
  if (button) { button.disabled = true; button.textContent = '正在解析原文件…'; }
  doc.instructions = fieldValue('document-edit-instructions').slice(0, 4000);
  doc.analysisEngine = fieldValue('document-engine') || 'local';
  try {
    const result = await window.xiaoyuDesktop.reparseDocument({ assetId: doc.assetId });
    if (!result.parseError) {
      const total = DB.documents.reduce((sum, other) => sum + (other.id === doc.id ? 0 : other.content.length), 0);
      if (total + result.text.length > 10000000) throw new Error('正文总量已达上限，请先导出整理附件记录');
      doc.content = result.text;
      doc.warnings = result.warnings;
      doc.parseError = '';
      if (!doc.analysis?.tasks?.length) await finishDocumentAnalysis(doc, doc.requestedProjectId || doc.projectId);
    } else doc.parseError = result.parseError;
    await persistWorkbench();
    if (document.querySelector('[data-action="document-reparse"]') === button) openDocumentEditor(doc.id);
    showToast(doc.parseError ? '原文件仍已保留，解析失败：' + doc.parseError : '原文件已重新解析');
  } finally {
    state.documentReparsing = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = '重新解析原文件'; }
  }
}

function documentFailureReason(error) {
  return String(error?.message || '导入失败，请重试')
    .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
    .slice(0, 1200);
}

function openDocumentLibrary(errors = []) {
  if (!Array.isArray(errors)) errors = [];
  localModal('附件记录与待确认项目',
    `${errors.length ? `<div class="integration-notice">${errors.map(error => `<p>${esc(error)}</p>`).join('')}</div>` : ''}
    <div class="feature-list">${DB.documents.slice().reverse().map(doc => `<div class="feature-list-row">
      <div class="document-list-label"><b>${esc(doc.title)}</b><p class="small muted">${esc(projectById(doc.projectId)?.name || '待确认项目')}
      · ${esc(doc.parseError ? '原文件已保存 · 解析待重试' : doc.analysis?.mode || '待分析')} · ${doc.analysis?.tasks?.length || 0} 条拆解</p></div>
      <button class="btn btn-sm" data-action="document-open" data-id="${esc(doc.id)}">查看与修改</button></div>`).join('') || '暂无附件'}</div>`,
    `<button class="btn btn-primary" data-action="chat-attachment">${icon('upload', 13)} 上传附件</button>`, 'document-library');
}

function openDocumentEditor(id, keepDraft = false) {
  const doc = documentById(id);
  if (!doc) { showToast('附件已不存在'); return; }
  state.documentId = id;
  if (!keepDraft) {
    state.documentDraft = JSON.parse(JSON.stringify(doc.analysis || {
      summary: '', projectName: doc.title.replace(/\.[^.]+$/, ''), tasks: [], mode: '待分析', warnings: []
    }));
    state.documentDraft.projectId = projectById(doc.projectId)?.id || doc.analysis?.proposedProjectId || '';
    state.documentDraft.tasks.forEach(task => {
      task.id ||= newRecordId('draft');
      if (task.taskId) {
        const found = taskLocation(task.taskId);
        if (found) Object.assign(task, { title: found.task.title, assignee: found.task.assignee || '',
          due: /^\d{4}-\d{2}-\d{2}$/.test(found.task.due) ? found.task.due : '',
          priority: found.task.priority, estimateHours: found.task.estimate === '待估时' ? 0 : parseEstimateHours(found.task.estimate) });
      }
    });
  }
  const draft = state.documentDraft;
  const warnings = [...new Set([...(doc.parseError ? ['原文件已保存，正文解析失败：' + doc.parseError] : []),
    ...(doc.warnings || []), ...(draft.warnings || [])])];
  localModal(doc.title, `<div class="document-analysis-status"><span class="chip">${esc(draft.mode)}</span>
    <span class="small muted">${esc(projectById(doc.projectId)?.name || '待确认项目')} · ${doc.content.length} 字</span></div>
    ${warnings.length ? `<div class="integration-notice">${warnings.map(text => `<p>${esc(text)}</p>`).join('')}</div>` : ''}
    <div class="form-grid">
      ${selectField('document-project', '项目归属', [['', '待确认，暂不归档'], ['new', '创建新项目'], ...DB.projects.map(p => [p.id, p.name])], draft.projectId)}
      ${inputField('document-project-name', '新项目名称', draft.projectName || '', 'text', `maxlength="150" ${draft.projectId === 'new' ? '' : 'disabled'}`)}
      ${selectField('document-engine', '分析方式', documentEngineChoices(), doc.analysisEngine || 'local')}
      ${textField('document-summary', '摘要与交付物', draft.summary)}
      ${textField('document-edit-instructions', '通用分析指令', doc.instructions || DB.documentInstructions || '')}
    </div>
    <div class="row document-task-heading"><h3>任务拆解 · ${draft.tasks.length}</h3>
      <button class="btn btn-sm" data-action="document-task-add">${icon('plus', 12)} 添加任务</button></div>
    <div class="document-task-list">${draft.tasks.map((task, index) => `<fieldset class="document-task-row" data-document-task="${index}">
      <legend class="small muted">${index + 1} · ${task.taskId ? taskLocation(task.taskId) ? '已生成任务' : '任务已移除' : '候选任务'}</legend>
      <div class="document-task-title"><label class="document-choice"><input type="checkbox" id="draft-selected-${index}" ${task.selected !== false ? 'checked' : ''} ${task.taskId ? 'disabled' : ''}>生成</label>
        <input class="input" id="draft-title-${index}" aria-label="任务 ${index + 1} 标题" value="${esc(task.title)}" maxlength="200">
        ${task.taskId ? '' : `<button class="icon-btn sm" data-action="document-task-remove" data-index="${index}" title="移除候选任务" aria-label="移除候选任务 ${index + 1}">${icon('trash', 13)}</button>`}</div>
      <div class="document-task-fields">
        ${inputField(`draft-owner-${index}`, '负责人', task.assignee, 'text', 'maxlength="100"')}
        ${inputField(`draft-due-${index}`, '截止日期', task.due, 'date')}
        ${selectField(`draft-priority-${index}`, '优先级', ['P0', 'P1', 'P2', 'P3', 'P4'].map(p => [p, p]), task.priority)}
        ${inputField(`draft-hours-${index}`, '预计小时 · 0 为待估时', task.estimateHours, 'number', 'min="0" max="200" step="0.1"')}
      </div><p class="small muted document-evidence">来源：${esc(task.evidence || '人工补充')}</p></fieldset>`).join('') || '<p class="small muted">未发现明确行动项，可修改指令后重新分析或添加任务。</p>'}</div>
    <details class="document-source"><summary>原文与来源</summary><pre class="document-content">${esc(doc.content)}</pre></details>`,
    `<button class="btn btn-sm" data-action="document-library">${icon('arrowLeft', 12)} 附件记录</button>
    ${doc.assetId ? '<button class="btn btn-sm" data-action="document-original">导出原文件</button>' : ''}
    ${doc.parseError && doc.assetId ? '<button class="btn btn-sm" data-action="document-reparse">重新解析原文件</button>' : ''}
    <button class="btn btn-sm" data-action="document-export">导出文本</button>
    <button class="btn btn-sm" data-action="document-reanalyze">${icon('sparkles', 12)} 重新分析</button>
    <button class="btn btn-sm" data-action="document-save">保存修改</button>
    <button class="btn btn-primary btn-sm" data-action="document-apply">${draft.projectId === 'new' ? '创建项目并归档' : doc.projectId ? '保存到项目' : '确认项目并归档'}</button>`,
    'document-editor');
}

function readDocumentDraft() {
  const draft = state.documentDraft;
  if (!draft || !document.getElementById('document-summary')) throw new Error('请重新打开附件');
  draft.projectId = fieldValue('document-project');
  draft.projectName = fieldValue('document-project-name');
  draft.summary = fieldValue('document-summary');
  draft.instructions = fieldValue('document-edit-instructions').slice(0, 4000);
  draft.analysisEngine = fieldValue('document-engine') || 'local';
  draft.tasks.forEach((task, index) => {
    task.selected = document.getElementById(`draft-selected-${index}`).checked;
    task.title = fieldValue(`draft-title-${index}`);
    task.assignee = fieldValue(`draft-owner-${index}`);
    task.due = fieldValue(`draft-due-${index}`);
    task.priority = fieldValue(`draft-priority-${index}`);
    task.estimateHours = Number(fieldValue(`draft-hours-${index}`));
  });
  return draft;
}

function updateDocumentDraft(operation, index) {
  try {
    const draft = readDocumentDraft();
    if (operation === 'add') {
      if (draft.tasks.length >= 80) { showToast('每份附件最多 80 条任务'); return; }
      draft.tasks.push({ id: newRecordId('draft'), title: '', assignee: '', due: '', priority: 'P2', estimateHours: 0, evidence: '', selected: true });
    } else if (!draft.tasks[Number(index)]?.taskId) draft.tasks.splice(Number(index), 1);
    openDocumentEditor(state.documentId, true);
  } catch (error) { showToast(error.message); }
}

function validateDocumentDraft(draft) {
  if (draft.summary.length > 6000) throw new Error('摘要不能超过 6000 字');
  for (const task of draft.tasks) {
    if (!task.selected) continue;
    if (!task.title || task.title.length > 200 || !Number.isFinite(task.estimateHours) ||
        task.estimateHours < 0 || task.estimateHours > 200 ||
        (task.due && (!/^\d{4}-\d{2}-\d{2}$/.test(task.due) || Number.isNaN(Date.parse(task.due))))) {
      throw new Error('请检查任务标题、日期和预计小时（0 至 200）');
    }
  }
}

async function applyDocumentToProject(doc, projectId) {
  const project = projectById(projectId);
  if (!project) throw new Error('项目已不存在，请重新选择');
  validateDocumentDraft(doc.analysis);
  for (const detail of Object.values(DB.projectDetails)) {
    detail.docs = (detail.docs || []).filter(item => item.id !== doc.id);
  }
  DB.projectDetails[projectId] ||= detailForProject(project);
  DB.projectDetails[projectId].docs.push({ id: doc.id, title: doc.title, icon: /\.xlsx$/i.test(doc.title) ? 'table' : 'file',
    meta: `${doc.analysis.mode} · ${doc.analysis.tasks.length} 条拆解` });
  doc.projectId = projectId;
  doc.analysis.projectId = projectId;
  for (const task of doc.analysis.tasks) {
    if (task.selected === false) continue;
    let found = task.taskId ? taskLocation(task.taskId) : null;
    if (task.taskId && !found) continue;
    const record = found?.task || { id: newRecordId('task'), done: false, createdAt: new Date().toISOString(),
      sourceDocumentId: doc.id, note: `附件：${doc.title}\n${task.evidence || '人工补充'}` };
    const previousDue = record.due;
    Object.assign(record, { title: task.title, assignee: task.assignee, project: projectId,
      due: task.due || '待确认', priority: task.priority, estimate: task.estimateHours ? `${task.estimateHours}h` : '待估时' });
    const bucket = ['P0', 'P1'].includes(task.priority) ? 'must' : !task.due || task.priority === 'P4' ? 'could' : 'should';
    if (!found) {
      task.taskId = record.id;
      addConfirmedTask(record, task.due || DB.meta.today, bucket);
    } else if (!record.done) {
      const date = task.due && found.date === previousDue ? task.due : found.date;
      found.list.splice(found.index, 1);
      addConfirmedTask(record, date, bucket);
    }
  }
  doc.updatedAt = new Date().toISOString();
  updateTaskCapacity();
  await persistWorkbench();
}

async function saveDocumentEditor(apply = false) {
  if (state.documentSaving) return;
  const doc = documentById(state.documentId);
  if (!doc) throw new Error('附件已不存在');
  const draft = readDocumentDraft();
  validateDocumentDraft(draft);
  let projectId = draft.projectId;
  if (apply && !projectId) throw new Error('请选择已有项目，或选择创建新项目');
  if (projectId && projectId !== 'new' && !projectById(projectId)) throw new Error('项目已不存在，请重新选择');
  if (apply && projectId === 'new' && !draft.projectName) throw new Error('请填写新项目名称');
  if (!apply && doc.projectId && projectId !== doc.projectId) throw new Error('项目归属已修改，请点击确认归档并保存任务');
  state.documentSaving = true;
  try {
    if (apply && projectId === 'new') {
      const existing = DB.projects.find(project => project.name === draft.projectName);
      if (existing) throw new Error('同名项目已存在，请直接选择已有项目');
      const project = { id: newRecordId('project'), name: draft.projectName, code: 'DOC', goal: draft.summary.slice(0, 1000),
        owner: DB.user.name, progress: 0, planned: 0, open: 0, risks: 0, health: 'green', color: DB.user.color,
        next: '待安排', nextDate: '—', updated: '刚刚', members: [{ i: DB.user.initials, c: DB.user.color }],
        createdAt: new Date().toISOString() };
      DB.projects.push(project);
      DB.projectDetails[project.id] = { ...detailForProject(project), milestones: [] };
      projectId = project.id;
      draft.projectId = projectId;
    }
    doc.instructions = draft.instructions;
    doc.analysisEngine = draft.analysisEngine;
    DB.documentInstructions = draft.instructions;
    doc.analysis = JSON.parse(JSON.stringify(draft));
    if (apply || (doc.projectId && projectId === doc.projectId)) await applyDocumentToProject(doc, projectId);
    else {
      // Saving an unconfirmed project choice does not create or move any project.
      doc.analysis.projectId = doc.projectId || null;
      doc.analysis.proposedProjectId = projectId;
      await persistWorkbench();
    }
    render();
    openDocumentEditor(doc.id);
    showToast(apply ? '文档与任务已保存到项目' : '修改已保存；项目归档等待确认');
  } finally { state.documentSaving = false; }
}

async function reanalyzeDocument(confirmed = false) {
  if (state.documentAnalyzing) return;
  const doc = documentById(state.documentId);
  const draft = confirmed ? state.documentReanalysisDraft : readDocumentDraft();
  if (!doc) throw new Error('附件已不存在');
  if (!draft) throw new Error('请重新打开附件后分析');
  if (!confirmed && draft.tasks.some(task => task.taskId)) {
    state.documentReanalysisDraft = draft;
    localModal('重新分析附件', '<p>将使用当前指令重新生成摘要和候选任务。已有任务会保留，相同来源的任务会合并；修改及新增任务等待你保存到项目后生效。</p>',
      `<button class="btn" data-action="document-open" data-id="${esc(doc.id)}">取消</button>
      <button class="btn btn-primary" data-action="document-reanalyze-confirm">确认重新分析</button>`);
    return;
  }
  state.documentReanalysisDraft = null;
  state.documentAnalyzing = true;
  const button = document.querySelector('[data-action="document-reanalyze"]');
  if (button) { button.disabled = true; button.textContent = '分析中…'; }
  try {
    doc.instructions = draft.instructions;
    doc.analysisEngine = draft.analysisEngine;
    DB.documentInstructions = draft.instructions;
    const result = await analyzeImportedDocument(doc);
    result.tasks.forEach(task => { task.id = newRecordId('draft'); task.selected = true; });
    for (const previous of draft.tasks.filter(task => task.taskId)) {
      const match = result.tasks.find(task => !task.taskId &&
        (task.evidence === previous.evidence || task.title === previous.title));
      if (match) match.taskId = previous.taskId;
      else result.tasks.push(previous);
    }
    if (result.tasks.length > 80) throw new Error('合并后的任务超过 80 条，请先整理现有任务');
    result.proposedProjectId = draft.projectId;
    doc.analysis = result;
    await persistWorkbench();
    openDocumentEditor(doc.id);
  } finally {
    state.documentAnalyzing = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = '重新分析'; }
  }
}

async function exportDocumentOriginal() {
  const doc = documentById(state.documentId);
  if (!doc?.assetId || !window.xiaoyuDesktop?.exportOriginal) throw new Error('此附件没有保存原文件');
  const result = await window.xiaoyuDesktop.exportOriginal({ assetId: doc.assetId, name: doc.title });
  if (result.saved) showToast('原文件已导出');
}
