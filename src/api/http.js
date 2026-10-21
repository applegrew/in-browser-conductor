import { WorkflowStatus, TaskStatus } from '../enums.js';
import { ConductorError, NotFoundError, BadRequestError, ApplicationException } from '../errors.js';

/**
 * HTTP API layer implementing the Conductor OSS REST surface.
 *
 * `handleHttpRequest(request, server, options)` accepts a fetch-like Request
 * (or a plain `{ method, url, headers, body }`) and returns a plain response
 * object `{ status, headers, body }`. `toFetchResponse` converts it to a real
 * `Response` when available. The same handler powers the service worker
 * (real HTTP) and the direct in-memory router (no network).
 */

// ---------------------------------------------------------------------------
// Route table (paths relative to the `/api` base).
// ---------------------------------------------------------------------------

const routes = [
  // Metadata — workflow definitions
  { m: 'GET', p: '/metadata/workflow/names-and-versions', h: 'wfNamesAndVersions' },
  { m: 'GET', p: '/metadata/workflow/names', h: 'wfNames' },
  { m: 'GET', p: '/metadata/workflow/latest-versions', h: 'wfLatestVersions' },
  { m: 'GET', p: '/metadata/workflow/{name}/versions', h: 'wfVersions' },
  { m: 'GET', p: '/metadata/workflow/{name}', h: 'getWorkflowDef' },
  { m: 'GET', p: '/metadata/workflow', h: 'getAllWorkflowDefs' },
  { m: 'POST', p: '/metadata/workflow/validate', h: 'validateWorkflowDef' },
  { m: 'POST', p: '/metadata/workflow', h: 'createWorkflowDef' },
  { m: 'PUT', p: '/metadata/workflow', h: 'updateWorkflowDefs' },
  { m: 'DELETE', p: '/metadata/workflow/{name}/{version}', h: 'deleteWorkflowDef' },

  // Metadata — task definitions
  { m: 'GET', p: '/metadata/taskdefs', h: 'getAllTaskDefs' },
  { m: 'POST', p: '/metadata/taskdefs', h: 'createTaskDefs' },
  { m: 'PUT', p: '/metadata/taskdefs', h: 'updateTaskDef' },
  { m: 'GET', p: '/metadata/taskdefs/{taskType}', h: 'getTaskDef' },
  { m: 'DELETE', p: '/metadata/taskdefs/{taskType}', h: 'deleteTaskDef' },

  // Start workflow
  { m: 'POST', p: '/workflow/execute/{name}/{version}', h: 'executeWorkflow' },
  { m: 'POST', p: '/workflow', h: 'startWorkflow' },
  { m: 'POST', p: '/workflow/{name}', h: 'startWorkflowByName' },
  { m: 'POST', p: '/workflow/test', h: 'testWorkflow' },

  // Workflow — search & running
  { m: 'GET', p: '/workflow/search', h: 'searchWorkflows' },
  { m: 'GET', p: '/workflow/search-v2', h: 'searchWorkflowsV2' },
  { m: 'GET', p: '/workflow/running/{name}', h: 'runningWorkflows' },
  { m: 'GET', p: '/workflow/{name}/correlated/{correlationId}', h: 'workflowsByCorrelationId' },
  { m: 'POST', p: '/workflow/{name}/correlated', h: 'workflowsForCorrelationIds' },

  // Workflow — manage
  { m: 'PUT', p: '/workflow/decide/{workflowId}', h: 'decideWorkflow' },
  { m: 'GET', p: '/workflow/{workflowId}/status', h: 'workflowStatus' },
  { m: 'GET', p: '/workflow/{workflowId}/tasks', h: 'workflowTasks' },
  { m: 'PUT', p: '/workflow/{workflowId}/pause', h: 'pauseWorkflow' },
  { m: 'PUT', p: '/workflow/{workflowId}/resume', h: 'resumeWorkflow' },
  { m: 'POST', p: '/workflow/{workflowId}/restart', h: 'restartWorkflow' },
  { m: 'POST', p: '/workflow/{workflowId}/retry', h: 'retryWorkflow' },
  { m: 'POST', p: '/workflow/{workflowId}/rerun', h: 'rerunWorkflow' },
  { m: 'PUT', p: '/workflow/{workflowId}/skiptask/{taskReferenceName}', h: 'skipTask' },
  { m: 'POST', p: '/workflow/{workflowId}/resetcallbacks', h: 'resetCallbacks' },
  { m: 'DELETE', p: '/workflow/{workflowId}/remove', h: 'removeWorkflow' },
  { m: 'DELETE', p: '/workflow/{workflowId}/terminate-remove', h: 'terminateRemoveWorkflow' },
  { m: 'DELETE', p: '/workflow/{workflowId}', h: 'terminateWorkflow' },
  { m: 'GET', p: '/workflow/{workflowId}', h: 'getWorkflow' },

  // Task — poll & update
  { m: 'GET', p: '/tasks/poll/batch/{taskType}', h: 'batchPoll' },
  { m: 'GET', p: '/tasks/poll/{taskType}', h: 'poll' },
  { m: 'POST', p: '/tasks/queue/requeue/{taskType}', h: 'requeue' },
  { m: 'GET', p: '/tasks/queue/all/verbose', h: 'queueAllVerbose' },
  { m: 'GET', p: '/tasks/queue/all', h: 'queueAll' },
  { m: 'GET', p: '/tasks/queue/size', h: 'queueSize' },
  { m: 'GET', p: '/tasks/queue/polldata/all', h: 'pollDataAll' },
  { m: 'GET', p: '/tasks/queue/polldata', h: 'pollData' },
  { m: 'GET', p: '/tasks/search-v2', h: 'searchTasksV2' },
  { m: 'GET', p: '/tasks/search', h: 'searchTasks' },
  { m: 'POST', p: '/tasks/update-v2', h: 'updateTaskV2' },
  { m: 'POST', p: '/tasks/{workflowId}/{taskRefName}/{status}/sync', h: 'updateTaskByRefSync' },
  { m: 'POST', p: '/tasks/{workflowId}/{taskRefName}/{status}', h: 'updateTaskByRef' },
  { m: 'POST', p: '/tasks', h: 'updateTask' },
  { m: 'GET', p: '/tasks/{taskId}/log', h: 'getTaskLogs' },
  { m: 'POST', p: '/tasks/{taskId}/log', h: 'addTaskLog' },
  { m: 'GET', p: '/tasks/{taskId}', h: 'getTask' },

  // Event handlers
  { m: 'GET', p: '/event/{event}', h: 'getEventHandler' },
  { m: 'DELETE', p: '/event/{event}', h: 'deleteEventHandler' },
  { m: 'GET', p: '/event', h: 'getEventHandlers' },
  { m: 'POST', p: '/event', h: 'registerEventHandler' },
  { m: 'PUT', p: '/event', h: 'registerEventHandler' },

  // Queues (alias)
  { m: 'GET', p: '/queue/all', h: 'queueAll' },
  { m: 'GET', p: '/queue/all/verbose', h: 'queueAllVerbose' },
  { m: 'GET', p: '/queue/size', h: 'queueSize' },
  { m: 'GET', p: '/queue/sizes', h: 'queueAll' },

  // Health
  { m: 'GET', p: '/health', h: 'health' },
  { m: 'GET', p: '/version', h: 'version' },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchRoute(method, path) {
  const pathSegs = path.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.m !== method) continue;
    const segs = route.p.split('/').filter(Boolean);
    if (segs.length !== pathSegs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].startsWith('{') && segs[i].endsWith('}')) {
        params[segs[i].slice(1, -1)] = decodeURIComponent(pathSegs[i]);
      } else if (segs[i] !== pathSegs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handler context & response helpers
// ---------------------------------------------------------------------------

class Ctx {
  constructor(server, params, query, body, headers, method) {
    this.server = server;
    this.params = params;
    this.query = query;
    this.body = body;
    this.headers = headers;
    this.method = method;
  }
  json() {
    if (this._parsed) return this._parsed;
    if (!this.body) return {};
    try {
      this._parsed = JSON.parse(this.body);
    } catch {
      throw new BadRequestError('Invalid JSON body');
    }
    return this._parsed;
  }
  text() {
    return this.body || '';
  }
  /** Case-insensitive header lookup. Handles plain objects and Headers. */
  header(name) {
    const needle = String(name).toLowerCase();
    const src = this.headers || {};
    if (typeof src.get === 'function') {
      return src.get(needle) ?? src.get(name) ?? undefined;
    }
    for (const key of Object.keys(src)) {
      if (String(key).toLowerCase() === needle) return src[key];
    }
    return undefined;
  }
}

const send = (status, body, contentType) => ({
  status,
  headers: contentType ? { 'Content-Type': contentType } : {},
  body,
});

const json = (status, obj) => send(status, JSON.stringify(obj), 'application/json');
const text = (status, str) => send(status, String(str), 'text/plain;charset=UTF-8');
const empty = (status) => ({ status, headers: {}, body: null });

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handlers = {
  health: async () => json(200, { status: 'UP' }),
  version: async () => json(200, { version: 'in-browser-conductor', conductor: 'OSS-compatible' }),

  // metadata workflow
  getAllWorkflowDefs: async (c) => json(200, await c.server.getAllWorkflowDefs()),
  createWorkflowDef: async (c) => {
    await c.server.registerWorkflowDef(c.json());
    return empty(200);
  },
  updateWorkflowDefs: async (c) => {
    const body = c.json();
    const res = await c.server.updateWorkflowDefs(Array.isArray(body) ? body : [body]);
    return json(200, res);
  },
  getWorkflowDef: async (c) => {
    const def = await c.server.getWorkflowDef(c.params.name, c.query.version != null ? Number(c.query.version) : undefined);
    if (!def) throw new NotFoundError(`Workflow def not found: ${c.params.name}`);
    return json(200, def);
  },
  deleteWorkflowDef: async (c) => {
    await c.server.deleteWorkflowDef(c.params.name, Number(c.params.version));
    return empty(200);
  },
  validateWorkflowDef: async (c) => {
    try {
      c.server.validateWorkflowDef(c.json());
      return empty(200);
    } catch (e) {
      throw new BadRequestError(e.message);
    }
  },
  wfNamesAndVersions: async (c) => json(200, await c.server.getWorkflowDefsNamesAndVersions()),
  wfNames: async (c) => json(200, await c.server.getWorkflowNames()),
  wfLatestVersions: async (c) => {
    const defs = await c.server.getAllWorkflowDefs();
    const latest = {};
    for (const d of defs) if (!latest[d.name] || d.version > latest[d.name].version) latest[d.name] = d;
    return json(200, Object.values(latest));
  },
  wfVersions: async (c) => json(200, await c.server.getWorkflowVersions(c.params.name)),

  // metadata taskdefs
  getAllTaskDefs: async (c) => json(200, await c.server.getAllTaskDefs()),
  createTaskDefs: async (c) => {
    const body = c.json();
    await c.server.registerTaskDefs(Array.isArray(body) ? body : [body]);
    return empty(200);
  },
  updateTaskDef: async (c) => {
    await c.server.updateTaskDef(c.json());
    return empty(200);
  },
  getTaskDef: async (c) => {
    const def = await c.server.getTaskDef(c.params.taskType);
    if (!def) throw new NotFoundError(`Task def not found: ${c.params.taskType}`);
    return json(200, def);
  },
  deleteTaskDef: async (c) => {
    await c.server.deleteTaskDef(c.params.taskType);
    return empty(200);
  },

  // start workflow
  startWorkflow: async (c) => {
    const id = await c.server.startWorkflow(c.json());
    return text(200, id);
  },
  startWorkflowByName: async (c) => {
    const body = c.json();
    const id = await c.server.startWorkflow({
      name: c.params.name,
      version: c.query.version != null ? Number(c.query.version) : undefined,
      correlationId: c.query.correlationId,
      priority: c.query.priority != null ? Number(c.query.priority) : undefined,
      input: body,
      idempotencyKey: c.header('x-idempotency-key') || undefined,
      idempotencyStrategy: c.header('x-on-conflict') || undefined,
    });
    return text(200, id);
  },
  executeWorkflow: async (c) => {
    const body = c.json();
    const wf = await c.server.executeWorkflow(
      { ...body, name: c.params.name, version: c.params.version === '0' ? undefined : Number(c.params.version) },
      { waitForSeconds: Number(c.query.waitForSeconds ?? 10), waitUntilTaskRef: c.query.waitUntilTaskRef }
    );
    return json(200, wf);
  },
  testWorkflow: async (c) => {
    const body = c.json();
    const def = body.workflowDef || (body.name ? await c.server.getWorkflowDef(body.name, body.version) : null);
    if (!def) throw new BadRequestError('workflowDef or name/version required');
    // Simulate: schedule every task once with mocked outputs.
    const tasks = (def.tasks || []).map((t, i) => {
      const mock = (body.taskRefToMockOutput || {})[t.taskReferenceName] || [{}];
      const m = mock[0] || {};
      return {
        taskId: `mock-task-${i}`,
        taskType: t.type,
        referenceTaskName: t.taskReferenceName,
        taskDefName: t.name,
        status: m.status || 'COMPLETED',
        outputData: m.output || {},
        inputData: {},
      };
    });
    return json(200, {
      workflowId: 'test-workflow',
      workflowName: def.name,
      workflowVersion: def.version,
      status: WorkflowStatus.COMPLETED,
      input: body.input || {},
      output: {},
      tasks,
    });
  },

  // workflow retrieve
  getWorkflow: async (c) => {
    const wf = await c.server.getWorkflow(c.params.workflowId, c.query.includeTasks !== 'false');
    if (!wf) throw new NotFoundError(`Workflow not found: ${c.params.workflowId}`);
    return json(200, wf);
  },
  workflowStatus: async (c) => {
    const st = await c.server.getWorkflowStatus(c.params.workflowId, {
      includeOutput: c.query.includeOutput === 'true',
      includeVariables: c.query.includeVariables === 'true',
    });
    if (!st) throw new NotFoundError(`Workflow not found: ${c.params.workflowId}`);
    return json(200, st);
  },
  workflowTasks: async (c) => {
    const res = await c.server.getTasksForWorkflow(c.params.workflowId, {
      start: Number(c.query.start ?? 0),
      count: Number(c.query.count ?? 15),
      status: c.query.status,
    });
    if (!res) throw new NotFoundError(`Workflow not found: ${c.params.workflowId}`);
    return json(200, res);
  },
  runningWorkflows: async (c) => {
    const ids = await c.server.getRunningWorkflows(c.params.name, Number(c.query.version ?? 1), c.query.startTime, c.query.endTime);
    return json(200, ids);
  },
  workflowsByCorrelationId: async (c) => {
    const list = await c.server.getWorkflowsByCorrelationId(
      c.params.name,
      c.params.correlationId,
      c.query.includeClosed === 'true',
      c.query.includeTasks === 'true'
    );
    return json(200, list);
  },
  workflowsForCorrelationIds: async (c) => {
    const map = await c.server.getWorkflowsForCorrelationIds(c.params.name, c.json(), c.query.includeClosed === 'true', c.query.includeTasks === 'true');
    return json(200, map);
  },

  // workflow manage
  pauseWorkflow: async (c) => empty(await c.server.pause(c.params.workflowId) ? 200 : 404),
  resumeWorkflow: async (c) => empty(await c.server.resume(c.params.workflowId) ? 200 : 404),
  restartWorkflow: async (c) => empty(await c.server.restart(c.params.workflowId, { useLatestDefinitions: c.query.useLatestDefinitions === 'true' }) ? 200 : 404),
  retryWorkflow: async (c) => empty(await c.server.retry(c.params.workflowId, { resumeSubworkflowTasks: c.query.resumeSubworkflowTasks === 'true' }) ? 200 : 404),
  rerunWorkflow: async (c) => {
    const wf = await c.server.rerun(c.params.workflowId, c.json());
    return json(200, wf ? wf.workflowId : null);
  },
  skipTask: async (c) => {
    await c.server.skipTask(c.params.workflowId, c.params.taskReferenceName, c.json());
    return empty(200);
  },
  resetCallbacks: async (c) => empty(200),
  decideWorkflow: async (c) => {
    await c.server.decide(c.params.workflowId);
    return empty(200);
  },
  terminateWorkflow: async (c) => {
    await c.server.terminate(c.params.workflowId, c.query.reason || '');
    return empty(200);
  },
  removeWorkflow: async (c) => {
    await c.server.remove(c.params.workflowId, { archiveWorkflow: c.query.archiveWorkflow !== 'false' });
    return empty(200);
  },
  terminateRemoveWorkflow: async (c) => {
    await c.server.terminate(c.params.workflowId, c.query.reason || '');
    await c.server.remove(c.params.workflowId, { archiveWorkflow: c.query.archiveWorkflow !== 'false' });
    return empty(200);
  },
  searchWorkflows: async (c) => json(200, await c.server.searchWorkflows(searchArgs(c))),
  searchWorkflowsV2: async (c) => {
    const res = await c.server.searchWorkflows(searchArgs(c));
    // Resolve full workflows for v2.
    const full = [];
    for (const s of res.results) {
      const wf = await c.server.getWorkflow(s.workflowId, true);
      if (wf) full.push(wf);
    }
    return json(200, { totalHits: res.totalHits, results: full });
  },

  // tasks
  getTask: async (c) => {
    const t = await c.server.getTask(c.params.taskId);
    if (!t) throw new NotFoundError(`Task not found: ${c.params.taskId}`);
    return json(200, t);
  },
  poll: async (c) => {
    const t = await c.server.poll(c.params.taskType, c.query.workerid || null, c.query.domain || null);
    return t ? json(200, t) : empty(204);
  },
  batchPoll: async (c) => {
    const list = await c.server.batchPoll(c.params.taskType, c.query.workerid || null, c.query.domain || null, Number(c.query.count ?? 1), Number(c.query.timeout ?? 100));
    return json(200, list);
  },
  updateTask: async (c) => {
    const id = await c.server.updateTask(c.json());
    return text(200, id);
  },
  updateTaskV2: async (c) => {
    const next = await c.server.updateTaskV2(c.json());
    return next ? json(200, next) : empty(204);
  },
  updateTaskByRef: async (c) => {
    await c.server.updateTaskByRef(c.params.workflowId, c.params.taskRefName, c.params.status, c.json(), c.query.workerid || null);
    return empty(200);
  },
  updateTaskByRefSync: async (c) => {
    await c.server.updateTaskByRef(c.params.workflowId, c.params.taskRefName, c.params.status, c.json(), c.query.workerid || null);
    const wf = await c.server.getWorkflow(c.params.workflowId, true);
    return json(200, wf);
  },
  addTaskLog: async (c) => {
    await c.server.addTaskLog(c.params.taskId, c.text());
    return empty(200);
  },
  getTaskLogs: async (c) => {
    const logs = await c.server.getTaskLogs(c.params.taskId);
    return logs && logs.length ? json(200, logs) : empty(204);
  },
  queueAll: async (c) => json(200, await c.server.getQueueSizes()),
  queueAllVerbose: async (c) => {
    const sizes = await c.server.getQueueSizes();
    const verbose = {};
    for (const [k, v] of Object.entries(sizes)) verbose[k] = { size: v, shards: { 0: v } };
    return json(200, verbose);
  },
  queueSize: async (c) => text(200, await c.server.getQueueSize(c.query.taskType || '')),
  requeue: async (c) => text(200, await c.server.requeue(c.params.taskType)),
  pollData: async (c) => json(200, []),
  pollDataAll: async (c) => json(200, []),
  searchTasks: async (c) => json(200, await c.server.searchTasks(searchArgs(c))),
  searchTasksV2: async (c) => json(200, await c.server.searchTasks(searchArgs(c))),

  // events
  getEventHandlers: async (c) => json(200, await c.server.getEventHandlers()),
  getEventHandler: async (c) => {
    const h = await c.server.getEventHandler(c.params.event);
    if (!h) throw new NotFoundError(`Event handler not found: ${c.params.event}`);
    return json(200, h);
  },
  registerEventHandler: async (c) => empty(200),
  deleteEventHandler: async (c) => {
    await c.server.deleteEventHandler(c.params.event);
    return empty(200);
  },
};

function searchArgs(c) {
  return {
    query: c.query.query || null,
    freeText: c.query.freeText || null,
    start: Number(c.query.start ?? 0),
    size: Number(c.query.size ?? 100),
    sort: c.query.sort || null,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleHttpRequest(request, server, { basePath = '/api' } = {}) {
  try {
    const method = (request.method || 'GET').toUpperCase();
    const url = new URL(request.url, 'http://localhost');
    let path = url.pathname;

    if (path.startsWith(basePath)) path = path.slice(basePath.length);
    if (!path.startsWith('/')) path = '/' + path;
    path = path.replace(/\/+$/, '') || '/';

    const query = {};
    for (const [k, v] of url.searchParams.entries()) query[k] = v;

    let body = null;
    if (method !== 'GET' && method !== 'HEAD') {
      body = typeof request.text === 'function' ? await request.text() : (request.body != null ? String(request.body) : null);
    }

    const matched = matchRoute(method, path);
    if (!matched) {
      return toErrorResponse(new NotFoundError(`No such endpoint: ${method} ${path}`));
    }

    const ctx = new Ctx(server, matched.params, query, body, request.headers || {}, method);
    const handler = handlers[matched.route.h];
    if (!handler) {
      return toErrorResponse(new ConductorError('Handler not implemented', { status: 501 }));
    }

    return await handler(ctx);
  } catch (e) {
    return toErrorResponse(e);
  }
}

export function toErrorResponse(e) {
  const status = e instanceof ConductorError ? e.status : e instanceof ApplicationException ? 500 : 500;
  const message = e && e.message ? e.message : String(e);
  const body = { status, message };
  if (e && e.code) body.code = e.code;
  if (e && e.details) body.details = e.details;
  return json(status, body);
}

/** Convert a plain response object into a `Response` when available. */
export function toFetchResponse(res) {
  if (typeof Response !== 'undefined') {
    const init = { status: res.status, headers: res.headers };
    return new Response(res.body ?? null, init);
  }
  return res;
}
