/* global InBrowserConductor, SAMPLES */

const { install, ConductorWorker } = InBrowserConductor;

const state = {
  client: null,
  server: null,
  workers: [],
  startedIds: [],
};

const logEl = document.getElementById('log');
const tbody = document.querySelector('#executions tbody');

function log(message) {
  const line = document.createElement('div');
  const t = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="t">[${t}]</span> ${escapeHtml(message)}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function statusBadge(status) {
  return `<span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

async function setup() {
  log('Installing in-browser Conductor engine (localStorage store)…');
  const installed = await install({
    store: 'localstorage',
    basePath: '/api',
    patchFetch: true,
    serviceWorker: false,
  });
  state.client = installed.client;
  state.server = installed.server;

  // Stream engine events to the log panel.
  state.server.onEvent((e) => {
    const p = e.payload || {};
    switch (e.type) {
      case 'workflow.started': log(`▶ workflow ${p.workflowId} started (${p.name})`); break;
      case 'workflow.completed': log(`✔ workflow ${p.workflowId} completed`); break;
      case 'workflow.failed': log(`✖ workflow ${p.workflowId} failed: ${p.reason || ''}`); break;
      case 'task.completed': log(`  task ${p.taskId} (${p.taskType}) completed`); break;
      case 'task.failed': log(`  task ${p.taskId} (${p.taskType}) failed`); break;
      case 'task.retried': log(`  task ${p.taskId} retried → ${p.retriedTaskId}`); break;
      default: break;
    }
  });

  // Register sample task definitions and workflows.
  await state.client.metadataResource.registerTaskDefs(SAMPLES.taskDefs);
  const defs = Object.values(SAMPLES.workflows);
  await state.client.metadataResource.updateWorkflowDefs(defs);
  log(`Registered ${defs.length} workflows and ${SAMPLES.taskDefs.length} task definitions.`);

  // Start a worker for each implemented task type.
  for (const [taskType, fn] of Object.entries(SAMPLES.workers)) {
    const worker = new ConductorWorker({
      taskType,
      baseURL: '/api',
      concurrency: 2,
      pollInterval: 250,
      executeTask: fn,
      onTaskComplete: ({ task }) => log(`  worker "${taskType}" finished ${task.taskId}`),
    });
    worker.start();
    state.workers.push(worker);
  }
  log(`Started ${state.workers.length} workers.`);

  await refresh();
}

async function startWorkflow(name, input) {
  const id = await state.client.workflowResource.startWorkflow({ name, version: 1, input });
  state.startedIds.unshift(id);
  log(`▶ started "${name}" → ${id}`);
  await refresh();
  // Keep refreshing briefly to capture async completions.
  setTimeout(refresh, 400);
  setTimeout(refresh, 1200);
}

async function refresh() {
  if (!state.client) return;
  for (const id of state.startedIds) {
    try {
      const wf = await state.client.workflowResource.getWorkflow(id, false);
      renderWorkflow(wf);
    } catch (e) {
      /* workflow may have been removed */
    }
  }
}

function renderWorkflow(wf) {
  let row = tbody.querySelector(`tr[data-id="${wf.workflowId}"]`);
  if (!row) {
    row = document.createElement('tr');
    row.setAttribute('data-id', wf.workflowId);
    tbody.prepend(row);
  }
  const output = wf.output && Object.keys(wf.output).length ? JSON.stringify(wf.output) : '—';
  row.innerHTML = `
    <td class="mono">${escapeHtml(wf.workflowId.slice(0, 13))}…</td>
    <td>${escapeHtml(wf.workflowName)}</td>
    <td>${statusBadge(wf.status)}</td>
    <td class="mono">${escapeHtml(output)}</td>
  `;
}

async function clearAll() {
  for (const id of state.startedIds) {
    try { await state.client.workflowResource.remove(id); } catch { /* ignore */ }
  }
  state.startedIds = [];
  tbody.innerHTML = '';
  log('Cleared executions.');
}

function bindButtons() {
  document.getElementById('btn-greeting').addEventListener('click', () => startWorkflow('greeting', { name: 'Ada' }));
  document.getElementById('btn-order').addEventListener('click', () => startWorkflow('order_processing', { orderId: 'ORD-42', amount: 99.5 }));
  document.getElementById('btn-inline').addEventListener('click', () => startWorkflow('inline_demo', {}));
  document.getElementById('btn-switch').addEventListener('click', () => startWorkflow('switch_demo', { tier: 'vip', user: 'alice' }));
  document.getElementById('btn-refresh').addEventListener('click', refresh);
  document.getElementById('btn-clear').addEventListener('click', clearAll);
}

window.addEventListener('DOMContentLoaded', () => {
  bindButtons();
  setup().catch((e) => log(`✖ setup failed: ${e.message}`));
});
