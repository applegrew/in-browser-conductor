/**
 * Fetch-based client mirroring the Conductor SDK surface. Point `baseURL` at
 * the in-browser server (e.g. `/api`) and any code written against the
 * Conductor REST API works unchanged.
 */
export class ConductorClient {
  constructor({ baseURL = '/api', headers = {}, fetch: fetcher = null } = {}) {
    this.baseURL = baseURL.replace(/\/$/, '');
    this.headers = headers;
    this._fetch = fetcher || ((...a) => globalThis.fetch(...a));
    this.metadataResource = new MetadataResource(this);
    this.workflowResource = new WorkflowResource(this);
    this.taskResource = new TaskResource(this);
    this.queueResource = new QueueResource(this);
    this.eventResource = new EventResource(this);
  }

  async request(method, path, { body = undefined, query = {}, headers = {}, raw = false } = {}) {
    const url = new URL(this.baseURL + path, 'http://localhost');
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const opts = { method, headers: { ...this.headers, ...headers } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await this._fetch(url.pathname + url.search, opts);
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try { detail = JSON.parse(text); } catch { /* ignore */ }
      const err = new Error(detail?.message || `Conductor request failed: ${res.status}`);
      err.status = res.status;
      err.details = detail;
      throw err;
    }
    if (raw) return text;
    if (!text) return null;
    const ct = res.headers && res.headers.get ? res.headers.get('content-type') : '';
    if (ct && ct.includes('json')) return JSON.parse(text);
    // Plain-text responses (e.g. workflow ids).
    return text;
  }
}

class MetadataResource {
  constructor(c) { this.c = c; }
  registerWorkflowDef(def) { return this.c.request('POST', '/metadata/workflow', { body: def }); }
  updateWorkflowDefs(defs) { return this.c.request('PUT', '/metadata/workflow', { body: defs }); }
  getWorkflowDef(name, version) {
    return this.c.request('GET', `/metadata/workflow/${encodeURIComponent(name)}`, { query: { version } });
  }
  getAllWorkflowDefs() { return this.c.request('GET', '/metadata/workflow'); }
  unregisterWorkflowDef(name, version) {
    return this.c.request('DELETE', `/metadata/workflow/${encodeURIComponent(name)}/${version}`);
  }
  registerTaskDefs(defs) { return this.c.request('POST', '/metadata/taskdefs', { body: defs }); }
  updateTaskDef(def) { return this.c.request('PUT', '/metadata/taskdefs', { body: def }); }
  getTaskDef(type) { return this.c.request('GET', `/metadata/taskdefs/${encodeURIComponent(type)}`); }
  getAllTaskDefs() { return this.c.request('GET', '/metadata/taskdefs'); }
  unregisterTaskDef(type) { return this.c.request('DELETE', `/metadata/taskdefs/${encodeURIComponent(type)}`); }
}

class WorkflowResource {
  constructor(c) { this.c = c; }
  startWorkflow(request) {
    return this.c.request('POST', '/workflow', { body: request, raw: true });
  }
  startWorkflowByName(name, input, { version, correlationId, priority } = {}) {
    return this.c.request('POST', `/workflow/${encodeURIComponent(name)}`, {
      body: input, query: { version, correlationId, priority }, raw: true,
    });
  }
  executeWorkflow(name, version, input, { waitForSeconds = 10, waitUntilTaskRef } = {}) {
    return this.c.request('POST', `/workflow/execute/${encodeURIComponent(name)}/${version}`, {
      body: { name, version, input }, query: { waitForSeconds, waitUntilTaskRef },
    });
  }
  getWorkflow(workflowId, includeTasks = true) {
    return this.c.request('GET', `/workflow/${workflowId}`, { query: { includeTasks } });
  }
  getWorkflowStatus(workflowId, { includeOutput = false, includeVariables = false } = {}) {
    return this.c.request('GET', `/workflow/${workflowId}/status`, { query: { includeOutput, includeVariables } });
  }
  getWorkflowTasks(workflowId, { start = 0, count = 15, status } = {}) {
    return this.c.request('GET', `/workflow/${workflowId}/tasks`, { query: { start, count, status } });
  }
  getRunningWorkflow(name, version, startTime, endTime) {
    return this.c.request('GET', `/workflow/running/${encodeURIComponent(name)}`, { query: { version, startTime, endTime } });
  }
  getWorkflows(name, correlationId, includeClosed = false, includeTasks = false) {
    return this.c.request('GET', `/workflow/${encodeURIComponent(name)}/correlated/${encodeURIComponent(correlationId)}`, {
      query: { includeClosed, includeTasks },
    });
  }
  getWorkflowsByCorrelationIds(name, correlationIds, includeClosed = false, includeTasks = false) {
    return this.c.request('POST', `/workflow/${encodeURIComponent(name)}/correlated`, {
      body: correlationIds, query: { includeClosed, includeTasks },
    });
  }
  pause(workflowId) { return this.c.request('PUT', `/workflow/${workflowId}/pause`); }
  resume(workflowId) { return this.c.request('PUT', `/workflow/${workflowId}/resume`); }
  restart(workflowId, useLatestDefinitions = false) {
    return this.c.request('POST', `/workflow/${workflowId}/restart`, { query: { useLatestDefinitions } });
  }
  retry(workflowId, resumeSubworkflowTasks = false) {
    return this.c.request('POST', `/workflow/${workflowId}/retry`, { query: { resumeSubworkflowTasks } });
  }
  rerun(workflowId, body) { return this.c.request('POST', `/workflow/${workflowId}/rerun`, { body }); }
  terminate(workflowId, reason) {
    return this.c.request('DELETE', `/workflow/${workflowId}`, { query: { reason } });
  }
  remove(workflowId, archiveWorkflow = true) {
    return this.c.request('DELETE', `/workflow/${workflowId}/remove`, { query: { archiveWorkflow } });
  }
  search({ start = 0, size = 100, sort, freeText, query } = {}) {
    return this.c.request('GET', '/workflow/search', { query: { start, size, sort, freeText, query } });
  }
}

class TaskResource {
  constructor(c) { this.c = c; }
  getTask(taskId) { return this.c.request('GET', `/tasks/${taskId}`); }
  poll(taskType, workerId, domain) {
    return this.c.request('GET', `/tasks/poll/${encodeURIComponent(taskType)}`, { query: { workerid: workerId, domain } });
  }
  batchPoll(taskType, workerId, domain, count = 1, timeout = 100) {
    return this.c.request('GET', `/tasks/poll/batch/${encodeURIComponent(taskType)}`, { query: { workerid: workerId, domain, count, timeout } });
  }
  updateTask(result) { return this.c.request('POST', '/tasks', { body: result, raw: true }); }
  updateTaskV2(result) { return this.c.request('POST', '/tasks/update-v2', { body: result }); }
  updateTaskByRef(workflowId, taskRefName, status, output, workerId) {
    return this.c.request('POST', `/tasks/${workflowId}/${encodeURIComponent(taskRefName)}/${status}`, { body: output, query: { workerid: workerId } });
  }
  log(taskId, message) {
    return this.c.request('POST', `/tasks/${taskId}/log`, { body: message, headers: { 'Content-Type': 'text/plain' } });
  }
  getLogs(taskId) { return this.c.request('GET', `/tasks/${taskId}/log`); }
  search({ start = 0, size = 100, sort, freeText, query } = {}) {
    return this.c.request('GET', '/tasks/search', { query: { start, size, sort, freeText, query } });
  }
}

class QueueResource {
  constructor(c) { this.c = c; }
  getQueueSizes() { return this.c.request('GET', '/tasks/queue/all'); }
}

class EventResource {
  constructor(c) { this.c = c; }
  registerHandler(handler) { return this.c.request('POST', '/event', { body: handler }); }
  getHandlers() { return this.c.request('GET', '/event'); }
  getHandler(name) { return this.c.request('GET', `/event/${encodeURIComponent(name)}`); }
  unregisterHandler(name) { return this.c.request('DELETE', `/event/${encodeURIComponent(name)}`); }
}
