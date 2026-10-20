/* global InBrowserConductor */
(function () {
  'use strict';

  const { install, ConductorWorker } = InBrowserConductor;
  const BASE = '/cossb';

  let client = null;
  let server = null;
  let refreshTimer = null;
  let currentView = null;

  const content = document.getElementById('content');
  const engineStatus = document.getElementById('engine-status');

  // ---------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------
  function parseRoute() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    if (p === BASE || p === '/') return { name: 'executions' };
    if (p === BASE + '/executions') return { name: 'executions' };
    if (p === BASE + '/workflows') return { name: 'workflows' };
    if (p === BASE + '/tasks') return { name: 'tasks' };
    if (p === BASE + '/queues') return { name: 'queues' };
    const m = p.match(new RegExp('^' + BASE + '/workflow/([^/]+)$'));
    if (m) return { name: 'workflow', id: decodeURIComponent(m[1]) };
    return { name: 'executions' };
  }

  function navigate(path) {
    history.pushState({}, '', path);
    render();
  }

  function navFor(name) {
    const map = { executions: '/cossb/executions', workflows: '/cossb/workflows', tasks: '/cossb/tasks', queues: '/cossb/queues' };
    return map[name];
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  async function boot() {
    const installed = await install({ store: 'localstorage', basePath: '/api', patchFetch: true, serviceWorker: false });
    client = installed.client;
    server = installed.server;

    engineStatus.classList.add('ready');
    engineStatus.querySelector('span:last-child').textContent = 'engine ready';

    await render();
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function statusBadge(status) {
    return `<span class="status ${esc(status)}">${esc(status)}</span>`;
  }

  function fmtTime(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString();
  }

  function shortId(id) {
    return id ? id.slice(0, 13) + '…' : '—';
  }

  function jsonStr(v) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  // ---------------------------------------------------------------------
  // Render dispatcher
  // ---------------------------------------------------------------------
  async function render() {
    clearInterval(refreshTimer);
    const route = parseRoute();
    const nav = document.querySelectorAll('.nav-item');
    nav.forEach((n) => n.classList.toggle('active', n.dataset.route === navFor(route.name)));

    if (route.name === 'executions') return renderExecutions();
    if (route.name === 'workflows') return renderWorkflows();
    if (route.name === 'tasks') return renderTasks();
    if (route.name === 'queues') return renderQueues();
    if (route.name === 'workflow') return renderWorkflowDetail(route.id);
  }

  // ---------------------------------------------------------------------
  // Executions view
  // ---------------------------------------------------------------------
  let execState = { name: '', status: '', freeText: '', start: 0, size: 25 };

  async function renderExecutions() {
    currentView = 'executions';
    content.innerHTML = `
      <div class="page-header">
        <h1>Executions</h1>
        <div class="sub">Workflow executions in this browser, matching the Conductor OSS executions view.</div>
      </div>
      <div class="toolbar">
        <input id="f-name" type="text" placeholder="Workflow name…" value="${esc(execState.name)}" />
        <select id="f-status">
          <option value="">All statuses</option>
          ${['RUNNING','PAUSED','COMPLETED','FAILED','TIMED_OUT','TERMINATED'].map((s) =>
            `<option value="${s}" ${execState.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <input id="f-free" class="grow" type="text" placeholder="Search (free text)…" value="${esc(execState.freeText)}" />
        <button class="primary" id="btn-search">Search</button>
        <button id="btn-reset">Reset</button>
        <button id="btn-start-toggle">Start workflow</button>
      </div>
      <div id="start-form" class="start-form">
        <div class="row">
          <select id="start-name"></select>
          <input id="start-input" type="text" placeholder='{"key": "value"}' value='{}' style="flex:1" />
          <button class="primary" id="btn-start">Start</button>
        </div>
      </div>
      <div class="card" id="exec-table"></div>
    `;

    document.getElementById('btn-search').onclick = () => {
      execState.name = document.getElementById('f-name').value.trim();
      execState.status = document.getElementById('f-status').value;
      execState.freeText = document.getElementById('f-free').value.trim();
      execState.start = 0;
      loadExecutions();
    };
    document.getElementById('btn-reset').onclick = () => {
      execState = { name: '', status: '', freeText: '', start: 0, size: 25 };
      renderExecutions();
    };
    document.getElementById('btn-start-toggle').onclick = async () => {
      const form = document.getElementById('start-form');
      form.classList.toggle('open');
      if (form.classList.contains('open')) {
        const sel = document.getElementById('start-name');
        const defs = await client.metadataResource.getAllWorkflowDefs();
        const names = [...new Set(defs.map((d) => d.name))];
        sel.innerHTML = names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('') || '<option value="">(none)</option>';
      }
    };
    document.getElementById('btn-start').onclick = async () => {
      const name = document.getElementById('start-name').value;
      let input = {};
      try { input = JSON.parse(document.getElementById('start-input').value || '{}'); } catch { /* ignore */ }
      await client.workflowResource.startWorkflow({ name, version: 1, input });
      document.getElementById('start-form').classList.remove('open');
      loadExecutions();
    };

    await loadExecutions();
    refreshTimer = setInterval(loadExecutions, 3000);
  }

  async function loadExecutions() {
    const table = document.getElementById('exec-table');
    if (!table) return;
    const clauses = [];
    if (execState.name) clauses.push(`workflowType = '${execState.name}'`);
    if (execState.status) clauses.push(`status = '${execState.status}'`);
    const query = clauses.join(' AND ') || undefined;

    let res;
    try {
      res = await client.workflowResource.search({
        query, freeText: execState.freeText || undefined,
        start: execState.start, size: execState.size, sort: 'startTime:DESC',
      });
    } catch (e) {
      table.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
      return;
    }

    const rows = (res.results || []).map((w) => `
      <tr data-id="${esc(w.workflowId)}">
        <td><strong>${esc(w.workflowType)}</strong></td>
        <td class="mono">${esc(shortId(w.workflowId))}</td>
        <td class="num">${esc(w.version)}</td>
        <td>${statusBadge(w.status)}</td>
        <td class="mono">${esc(fmtTime(w.startTime))}</td>
        <td class="mono">${esc(fmtTime(w.endTime))}</td>
        <td class="mono">${esc(w.correlationId || '—')}</td>
      </tr>`).join('');

    const total = res.totalHits || 0;
    table.innerHTML = `
      <table>
        <thead><tr><th>Workflow</th><th>ID</th><th class="num">Ver</th><th>Status</th><th>Start</th><th>End</th><th>Correlation</th></tr></thead>
        <tbody>${rows || ''}</tbody>
      </table>
      ${total === 0 ? '<div class="empty">No executions found. Start a workflow or run the <a href="/">demo</a>.</div>' : ''}
      <div class="pager">
        <button class="small" id="pg-prev" ${execState.start === 0 ? 'disabled' : ''}>← Prev</button>
        <span>${execState.start + 1}–${Math.min(execState.start + execState.size, total)} of ${total}</span>
        <button class="small" id="pg-next" ${execState.start + execState.size >= total ? 'disabled' : ''}>Next →</button>
      </div>
    `;

    table.querySelectorAll('tbody tr').forEach((tr) => {
      tr.onclick = () => navigate(`${BASE}/workflow/${tr.dataset.id}`);
    });
    const prev = table.querySelector('#pg-prev');
    const next = table.querySelector('#pg-next');
    if (prev) prev.onclick = () => { execState.start = Math.max(0, execState.start - execState.size); loadExecutions(); };
    if (next) next.onclick = () => { execState.start += execState.size; loadExecutions(); };
  }

  // ---------------------------------------------------------------------
  // Workflow detail view
  // ---------------------------------------------------------------------
  async function renderWorkflowDetail(id) {
    currentView = 'workflow';
    content.innerHTML = `<div class="loading">Loading workflow…</div>`;
    let wf;
    try {
      wf = await client.workflowResource.getWorkflow(id, true);
    } catch (e) {
      content.innerHTML = `<div class="page-header"><h1>Execution</h1></div><div class="empty">Not found: ${esc(id)}</div>`;
      return;
    }

    const actions = [
      ['pause', 'Pause'], ['resume', 'Resume'], ['retry', 'Retry'], ['restart', 'Restart'],
      ['terminate', 'Terminate'], ['remove', 'Remove'],
    ];

    const tasks = (wf.tasks || []).map((t, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="mono">${esc(t.referenceTaskName)}</td>
        <td class="mono">${esc(t.taskType)}</td>
        <td>${statusBadge(t.status)}</td>
        <td class="mono">${esc(t.workerId || '—')}</td>
        <td class="mono">${esc(fmtTime(t.startTime))}</td>
        <td class="mono">${esc(fmtTime(t.endTime))}</td>
        <td class="mono">${esc(t.retryCount || 0)}</td>
        <td class="mono">${esc(t.reasonForIncompletion || '')}</td>
      </tr>`).join('');

    content.innerHTML = `
      <div class="page-header">
        <div style="display:flex;align-items:center;gap:12px;">
          <h1 style="margin:0">${esc(wf.workflowName)}</h1>
          ${statusBadge(wf.status)}
        </div>
        <div class="sub mono" style="margin-top:4px">${esc(wf.workflowId)}</div>
      </div>

      <div class="actions-row">
        ${actions.map(([act, label]) => `<button data-act="${act}" class="${act === 'remove' || act === 'terminate' ? 'danger' : ''}">${label}</button>`).join('')}
      </div>

      <div class="detail-grid">
        <div class="card" style="padding:16px">
          <div class="section-title" style="margin-top:0">Details</div>
          <div class="kv">
            <span class="k">Name</span><span class="v">${esc(wf.workflowName)}</span>
            <span class="k">Version</span><span class="v">${esc(wf.workflowVersion)}</span>
            <span class="k">Status</span><span class="v">${esc(wf.status)}</span>
            <span class="k">Correlation ID</span><span class="v">${esc(wf.correlationId || '—')}</span>
            <span class="k">Start time</span><span class="v">${esc(fmtTime(wf.startTime))}</span>
            <span class="k">End time</span><span class="v">${esc(fmtTime(wf.endTime))}</span>
            <span class="k">Reason</span><span class="v">${esc(wf.reasonForIncompletion || '—')}</span>
            <span class="k">Failed tasks</span><span class="v">${esc((wf.failedReferenceTaskNames || []).join(', ') || '—')}</span>
          </div>
        </div>
        <div class="card" style="padding:16px">
          <div class="section-title" style="margin-top:0">Input</div>
          <pre class="json">${esc(jsonStr(wf.input))}</pre>
          <div class="section-title">Output</div>
          <pre class="json">${esc(jsonStr(wf.output))}</pre>
        </div>
      </div>

      <div class="section-title">Tasks</div>
      <div class="card">
        <table>
          <thead><tr><th class="num">#</th><th>Reference</th><th>Type</th><th>Status</th><th>Worker</th><th>Start</th><th>End</th><th class="num">Retries</th><th>Reason</th></tr></thead>
          <tbody>${tasks || ''}</tbody>
        </table>
        ${(wf.tasks || []).length === 0 ? '<div class="empty">No tasks.</div>' : ''}
      </div>
    `;

    content.querySelectorAll('.actions-row button').forEach((btn) => {
      btn.onclick = async () => {
        const act = btn.dataset.act;
        try {
          if (act === 'terminate') await client.workflowResource.terminate(id, 'terminated from control plane');
          else if (act === 'pause') await client.workflowResource.pause(id);
          else if (act === 'resume') await client.workflowResource.resume(id);
          else if (act === 'retry') await client.workflowResource.retry(id);
          else if (act === 'restart') await client.workflowResource.restart(id);
          else if (act === 'remove') { await client.workflowResource.remove(id); navigate(navFor('executions')); return; }
        } catch (e) { alert('Action failed: ' + e.message); }
        await renderWorkflowDetail(id);
      };
    });

    refreshTimer = setInterval(() => renderWorkflowDetail(id), 3000);
  }

  // ---------------------------------------------------------------------
  // Workflow definitions view
  // ---------------------------------------------------------------------
  async function renderWorkflows() {
    currentView = 'workflows';
    const defs = await client.metadataResource.getAllWorkflowDefs();
    const rows = defs.map((d) => `
      <tr>
        <td><strong>${esc(d.name)}</strong></td>
        <td class="num">${esc(d.version)}</td>
        <td>${esc(d.description || '—')}</td>
        <td>${esc(d.ownerEmail || '—')}</td>
        <td class="num">${esc((d.tasks || []).length)}</td>
        <td class="num">${esc(d.timeoutSeconds || 0)}s</td>
      </tr>`).join('');

    content.innerHTML = `
      <div class="page-header">
        <h1>Workflow Definitions</h1>
        <div class="sub">Registered workflow definitions (blueprints).</div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Name</th><th class="num">Version</th><th>Description</th><th>Owner</th><th class="num">Tasks</th><th class="num">Timeout</th></tr></thead>
          <tbody>${rows || ''}</tbody>
        </table>
        ${defs.length === 0 ? '<div class="empty">No workflow definitions registered.</div>' : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Task definitions view
  // ---------------------------------------------------------------------
  async function renderTasks() {
    currentView = 'tasks';
    const defs = await client.metadataResource.getAllTaskDefs();
    const rows = defs.map((d) => `
      <tr>
        <td class="mono"><strong>${esc(d.name)}</strong></td>
        <td class="num">${esc(d.retryCount != null ? d.retryCount : 3)}</td>
        <td class="mono">${esc(d.retryLogic || 'FIXED')}</td>
        <td class="num">${esc(d.retryDelaySeconds ?? 60)}s</td>
        <td class="num">${esc(d.timeoutSeconds || 0)}s</td>
        <td class="mono">${esc(d.timeoutPolicy || 'TIME_OUT_WF')}</td>
        <td class="mono">${esc(d.responseTimeoutSeconds ?? 3600)}s</td>
      </tr>`).join('');

    content.innerHTML = `
      <div class="page-header">
        <h1>Task Definitions</h1>
        <div class="sub">Registered task definitions for worker (SIMPLE) tasks.</div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Name</th><th class="num">Retries</th><th>Retry Logic</th><th class="num">Retry Delay</th><th class="num">Timeout</th><th>Timeout Policy</th><th class="num">Response Timeout</th></tr></thead>
          <tbody>${rows || ''}</tbody>
        </table>
        ${defs.length === 0 ? '<div class="empty">No task definitions registered.</div>' : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Queues view
  // ---------------------------------------------------------------------
  async function renderQueues() {
    currentView = 'queues';
    const sizes = await client.queueResource.getQueueSizes();
    const entries = Object.entries(sizes || {}).sort((a, b) => b[1] - a[1]);
    const rows = entries.map(([name, size]) => `
      <tr><td class="mono"><strong>${esc(name)}</strong></td><td class="num">${esc(size)}</td></tr>`).join('');

    content.innerHTML = `
      <div class="page-header">
        <h1>Queues</h1>
        <div class="sub">Pending task counts per task type (ready to be polled by workers).</div>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>Task Type</th><th class="num">Pending</th></tr></thead>
          <tbody>${rows || ''}</tbody>
        </table>
        ${entries.length === 0 ? '<div class="empty">All queues are empty.</div>' : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------------
  // Navigation & boot
  // ---------------------------------------------------------------------
  window.addEventListener('click', (e) => {
    const a = e.target.closest('a.nav-item');
    if (a) {
      e.preventDefault();
      navigate(a.dataset.route);
    }
  });
  window.addEventListener('popstate', render);

  window.addEventListener('DOMContentLoaded', () => {
    boot().catch((e) => {
      engineStatus.querySelector('span:last-child').textContent = 'failed: ' + e.message;
      content.innerHTML = `<div class="empty">Failed to start engine: ${esc(e.message)}</div>`;
    });
  });
})();
