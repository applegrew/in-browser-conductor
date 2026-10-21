import { WorkflowStatus, TaskStatus, TaskType, TimeoutPolicy, IdempotencyStrategy } from '../enums.js';
import { uuid } from '../ids.js';
import { Decider } from './decider.js';
import {
  normalizeTaskDef,
  normalizeWorkflowDef,
  taskDefKey,
  createWorkflowInstance,
  createTaskRecord,
  latestTaskForRef,
  isTerminalWorkflow,
  isTerminalTask,
} from './model.js';
import {
  buildContext,
  latestTasksByRef,
  substitute,
  getTaskByRef,
} from '../expression.js';
import {
  isInlineSystemTask,
  isAsyncSystemTask,
  executeNoop,
  executeInline,
  executeJsonJq,
  executeEvent,
  executeHttp,
} from './system-tasks.js';
import { ApplicationException } from '../errors.js';
import { ConflictError, BadRequestError } from '../errors.js';

const MAX_DECIDE_STEPS = 10000;

export class ConductorServer {
  constructor({
    store,
    logger = null,
    sweeperIntervalMs = 500,
    workflowMessageQueueEnabled = false,
    now = () => Date.now(),
  } = {}) {
    this.store = store;
    this.logger = logger || console;
    this.sweeperIntervalMs = sweeperIntervalMs;
    this.workflowMessageQueueEnabled = workflowMessageQueueEnabled;
    this.now = now;
    this.decider = new Decider(this);
    this._tasks = new Map(); // taskId -> task (reference into workflow.tasks)
    this._queues = new Map(); // taskType -> taskId[]
    this._delayed = []; // { taskId, readyAt }
    this._inlineDefs = new Map(); // name:version -> def (dynamic workflows)
    this._eventHandlers = new Map(); // name -> handler
    this._taskDefCache = new Map(); // taskDef name -> def (sync lookups for decider)
    this._sweeper = null;
    this._subscribers = new Set();
    this._deciding = new Set(); // workflowIds currently being decided
    this._pendingDecide = new Set(); // workflowIds that need a re-decide
    this._idempotencyIndex = new Map(); // `${name}:${idempotencyKey}` -> workflowId[]
  }

  async init() {
    await this.store.init();
    this._tasks.clear();
    this._queues.clear();
    this._delayed = [];

    const workflows = await this.store.list('workflows');
    for (const wf of workflows) {
      for (const t of wf.tasks || []) {
        this._indexTask(t);
      }
      if (wf.idempotencyKey) this._indexIdempotencyKey(wf);
    }
    const handlers = await this.store.list('eventHandlers');
    for (const h of handlers) this._eventHandlers.set(h.name, h);

    const taskDefs = await this.store.list('taskDefs');
    for (const td of taskDefs) this._taskDefCache.set(td.name, td);

    this._startSweeper();
  }

  dispose() {
    if (this._sweeper) clearInterval(this._sweeper);
    this._sweeper = null;
  }

  onEvent(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  _emit(type, payload) {
    for (const fn of this._subscribers) {
      try {
        fn({ type, payload, timestamp: this.now() });
      } catch (e) {
        /* listener errors are ignored */
      }
    }
  }

  // ---- metadata: workflow definitions ----------------------------------

  async registerWorkflowDef(def, overwrite = false) {
    const normalized = normalizeWorkflowDef(def);
    this.validateWorkflowDef(normalized);
    const key = taskDefKey(normalized.name, normalized.version);
    const existing = await this.store.get('workflowDefs', key);
    if (existing && !overwrite) {
      // Conductor updates in place when name+version already exists.
    }
    await this.store.put('workflowDefs', key, normalized);
    this._emit('workflowDef.registered', { name: normalized.name, version: normalized.version });
    return normalized;
  }

  async updateWorkflowDefs(defs) {
    const success = [];
    const errors = {};
    for (const def of defs || []) {
      try {
        await this.registerWorkflowDef(def, true);
        success.push(def.name);
      } catch (e) {
        errors[def.name] = e.message;
      }
    }
    return { bulkSuccessfulResults: success, bulkErrorResults: errors };
  }

  async getWorkflowDef(name, version) {
    if (version != null) {
      const key = taskDefKey(name, version);
      const fromStore = await this.store.get('workflowDefs', key);
      if (fromStore) return fromStore;
      return this._inlineDefs.get(key);
    }
    // latest version
    const all = await this.getAllWorkflowDefs();
    let latest = null;
    for (const d of all) {
      if (d.name !== name) continue;
      if (!latest || d.version > latest.version) latest = d;
    }
    if (latest) return latest;
    // check inline defs
    let best = null;
    for (const [key, d] of this._inlineDefs.entries()) {
      if (d.name !== name) continue;
      if (!best || d.version > best.version) best = d;
    }
    return best;
  }

  async getAllWorkflowDefs() {
    const defs = await this.store.list('workflowDefs');
    defs.sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version);
    return defs;
  }

  async deleteWorkflowDef(name, version) {
    await this.store.delete('workflowDefs', taskDefKey(name, version));
    this._inlineDefs.delete(taskDefKey(name, version));
  }

  async getWorkflowDefsNamesAndVersions() {
    const defs = await this.getAllWorkflowDefs();
    const map = {};
    for (const d of defs) {
      (map[d.name] ||= []).push({ name: d.name, version: d.version });
    }
    return map;
  }

  async getWorkflowNames() {
    const defs = await this.getAllWorkflowDefs();
    return [...new Set(defs.map((d) => d.name))];
  }

  async getWorkflowVersions(name) {
    const defs = await this.getAllWorkflowDefs();
    return defs.filter((d) => d.name === name).map((d) => ({ name: d.name, version: d.version }));
  }

  validateWorkflowDef(def) {
    if (!def) throw new ApplicationException('Workflow definition is required');
    if (!def.name) throw new ApplicationException('Workflow definition is missing "name"');
    if (def.version == null) throw new ApplicationException('Workflow definition is missing "version"');
    if (!Array.isArray(def.tasks)) throw new ApplicationException('Workflow definition "tasks" must be an array');
    return true;
  }

  // ---- metadata: task definitions --------------------------------------

  async registerTaskDefs(defs) {
    for (const def of defs || []) {
      const normalized = normalizeTaskDef(def);
      if (!normalized) throw new ApplicationException('Task definition missing name');
      await this.store.put('taskDefs', normalized.name, normalized);
      this._taskDefCache.set(normalized.name, normalized);
      this._emit('taskDef.registered', { name: normalized.name });
    }
  }

  async updateTaskDef(def) {
    const normalized = normalizeTaskDef(def);
    if (!normalized) throw new ApplicationException('Task definition missing name');
    await this.store.put('taskDefs', normalized.name, normalized);
    this._taskDefCache.set(normalized.name, normalized);
    return normalized;
  }

  async getTaskDef(name) {
    return this.store.get('taskDefs', name);
  }

  getTaskDefSync(name) {
    return this._taskDefCache.get(name);
  }

  async getAllTaskDefs() {
    return this.store.list('taskDefs');
  }

  async deleteTaskDef(name) {
    await this.store.delete('taskDefs', name);
    this._taskDefCache.delete(name);
  }

  // ---- start workflows --------------------------------------------------

  async startWorkflow(request) {
    let def;
    if (request.workflowDef) {
      def = normalizeWorkflowDef(request.workflowDef);
      this.validateWorkflowDef(def);
      this._inlineDefs.set(taskDefKey(def.name, def.version), def);
    } else {
      if (!request.name) throw new ApplicationException('Workflow name is required');
      def = await this.getWorkflowDef(request.name, request.version);
      if (!def) throw new ApplicationException(`No workflow defined with name ${request.name}, version ${request.version ?? 'latest'}`);
    }

    // Idempotency: dedupe by (workflow name, idempotencyKey).
    if (request.idempotencyKey) {
      const existing = await this._checkIdempotency(def.name, request.idempotencyKey, request.idempotencyStrategy);
      if (existing) return existing;
    }

    const wf = createWorkflowInstance(def, request);
    await this.store.put('workflows', wf.workflowId, wf);
    if (wf.idempotencyKey) this._indexIdempotencyKey(wf);
    this._emit('workflow.started', { workflowId: wf.workflowId, name: wf.workflowName });
    await this._decide(wf.workflowId);
    return wf.workflowId;
  }

  _idempotencyKey(name, key) {
    return `${name}:${key}`;
  }

  _indexIdempotencyKey(wf) {
    const k = this._idempotencyKey(wf.workflowName, wf.idempotencyKey);
    const list = this._idempotencyIndex.get(k) || [];
    if (!list.includes(wf.workflowId)) list.push(wf.workflowId);
    this._idempotencyIndex.set(k, list);
  }

  _unindexIdempotencyKey(wf) {
    const k = this._idempotencyKey(wf.workflowName, wf.idempotencyKey);
    const list = (this._idempotencyIndex.get(k) || []).filter((id) => id !== wf.workflowId);
    if (list.length) this._idempotencyIndex.set(k, list);
    else this._idempotencyIndex.delete(k);
  }

  /**
   * Apply Conductor's idempotency strategy. Returns an existing workflow id
   * for RETURN_EXISTING, or null when a new execution should be started.
   * Throws ConflictError (409) for FAIL / FAIL_ON_RUNNING conflicts.
   */
  async _checkIdempotency(name, idempotencyKey, idempotencyStrategy) {
    const strategy = idempotencyStrategy || IdempotencyStrategy.FAIL;
    if (![IdempotencyStrategy.FAIL, IdempotencyStrategy.RETURN_EXISTING, IdempotencyStrategy.FAIL_ON_RUNNING].includes(strategy)) {
      throw new BadRequestError(`Invalid idempotencyStrategy: ${idempotencyStrategy}`);
    }

    const ids = this._idempotencyIndex.get(this._idempotencyKey(name, idempotencyKey)) || [];
    const existing = [];
    for (const id of ids) {
      const wf = await this.store.get('workflows', id);
      if (wf) existing.push(wf);
    }

    if (strategy === IdempotencyStrategy.RETURN_EXISTING) {
      return existing.length ? existing[0].workflowId : null;
    }
    if (strategy === IdempotencyStrategy.FAIL) {
      if (existing.length) {
        throw new ConflictError(
          `Workflow with idempotencyKey '${idempotencyKey}' is already running or completed`
        );
      }
      return null;
    }
    // FAIL_ON_RUNNING: only RUNNING or PAUSED executions block a new start.
    const running = existing.filter(
      (wf) => wf.status === WorkflowStatus.RUNNING || wf.status === WorkflowStatus.PAUSED
    );
    if (running.length) {
      throw new ConflictError(
        `Workflow with idempotencyKey '${idempotencyKey}' is already running`
      );
    }
    return null;
  }

  async executeWorkflow(request, { waitForSeconds = 10, waitUntilTaskRef = null } = {}) {
    const workflowId = await this.startWorkflow(request);
    const deadline = this.now() + waitForSeconds * 1000;
    const waitRefs = waitUntilTaskRef ? String(waitUntilTaskRef).split(',').map((s) => s.trim()).filter(Boolean) : [];
    return this._waitFor(workflowId, deadline, waitRefs);
  }

  async _waitFor(workflowId, deadline, waitRefs) {
    while (this.now() < deadline) {
      const wf = await this.store.get('workflows', workflowId);
      if (!wf) return null;
      if (isTerminalWorkflow(wf.status)) return wf;
      if (waitRefs.length) {
        const satisfied = waitRefs.some((ref) => {
          const t = getTaskByRef(wf, ref);
          return t && isTerminalTask(t.status);
        });
        if (satisfied) return wf;
      }
      await sleep(20);
    }
    return this.store.get('workflows', workflowId);
  }

  // ---- retrieve workflows ----------------------------------------------

  async getWorkflow(id, includeTasks = true) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    if (includeTasks === false) {
      const { tasks, ...rest } = wf;
      return rest;
    }
    return wf;
  }

  async getWorkflowStatus(id, { includeOutput = false, includeVariables = false } = {}) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    return {
      workflowId: wf.workflowId,
      workflowVersion: wf.workflowVersion,
      workflowName: wf.workflowName,
      correlationId: wf.correlationId,
      status: wf.status,
      startTime: wf.startTime,
      endTime: wf.endTime,
      updateTime: wf.updateTime,
      reasonForIncompletion: wf.reasonForIncompletion,
      output: includeOutput ? wf.output : undefined,
      variables: includeVariables ? wf.variables : undefined,
    };
  }

  async getTasksForWorkflow(id, { start = 0, count = 15, status = null } = {}) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    let tasks = [...(wf.tasks || [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    if (status) {
      const statuses = String(status).split(',');
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }
    const totalHits = tasks.length;
    return { totalHits, results: tasks.slice(start, start + count) };
  }

  async getRunningWorkflows(name, version = 1, startTime = null, endTime = null) {
    const workflows = await this.store.list('workflows');
    return workflows
      .filter((w) => {
        if (w.workflowName !== name) return false;
        if (version && w.workflowVersion !== Number(version)) return false;
        if (w.status !== WorkflowStatus.RUNNING) return false;
        if (startTime && w.startTime < Number(startTime)) return false;
        if (endTime && w.startTime > Number(endTime)) return false;
        return true;
      })
      .map((w) => w.workflowId);
  }

  async getWorkflowsByCorrelationId(name, correlationId, includeClosed = false, includeTasks = false) {
    const workflows = await this.store.list('workflows');
    const matches = workflows.filter(
      (w) => w.workflowName === name && w.correlationId === correlationId && (includeClosed || w.status === WorkflowStatus.RUNNING)
    );
    return matches.map((w) => (includeTasks ? w : this._withoutTasks(w)));
  }

  async getWorkflowsForCorrelationIds(name, correlationIds, includeClosed = false, includeTasks = false) {
    const map = {};
    for (const id of correlationIds || []) {
      map[id] = await this.getWorkflowsByCorrelationId(name, id, includeClosed, includeTasks);
    }
    return map;
  }

  _withoutTasks(wf) {
    const { tasks, ...rest } = wf;
    return rest;
  }

  // ---- manage workflows ------------------------------------------------

  async pause(id) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    if (wf.status === WorkflowStatus.RUNNING) {
      wf.status = WorkflowStatus.PAUSED;
      wf.updateTime = this.now();
      await this._saveWorkflow(wf);
    }
    return wf;
  }

  async resume(id) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    if (wf.status === WorkflowStatus.PAUSED) {
      wf.status = WorkflowStatus.RUNNING;
      wf.updateTime = this.now();
      await this._saveWorkflow(wf);
      await this._decide(id);
    }
    return wf;
  }

  async retry(id, { resumeSubworkflowTasks = false } = {}) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    wf.status = WorkflowStatus.RUNNING;
    wf.reasonForIncompletion = '';
    wf.failedReferenceTaskNames = [];
    wf.lastRetriedTime = this.now();
    // Reset the last failed task so it can be re-scheduled.
    const failed = [...(wf.tasks || [])]
      .filter((t) => t.status === TaskStatus.FAILED || t.status === TaskStatus.FAILED_WITH_TERMINAL_ERROR)
      .sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0];
    if (failed) {
      const ref = failed.referenceTaskName;
      wf.tasks = (wf.tasks || []).filter((t) => !(t.referenceTaskName === ref && t.status !== TaskStatus.COMPLETED && t.status !== TaskStatus.COMPLETED_WITH_ERRORS));
      this._tasks.delete(failed.taskId);
    }
    await this._saveWorkflow(wf);
    await this._decide(id);
    return wf;
  }

  async restart(id, { useLatestDefinitions = false } = {}) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    let def = await this.getWorkflowDef(wf.workflowName, useLatestDefinitions ? undefined : wf.workflowVersion);
    if (!def) return null;
    // Remove all previous task records.
    for (const t of wf.tasks || []) this._tasks.delete(t.taskId);
    wf.tasks = [];
    wf.status = WorkflowStatus.RUNNING;
    wf.startTime = this.now();
    wf.endTime = 0;
    wf.output = {};
    wf.reasonForIncompletion = '';
    wf.failedReferenceTaskNames = [];
    wf.failedTaskNames = [];
    wf.deciderState = {};
    if (useLatestDefinitions) wf.workflowVersion = def.version;
    await this._saveWorkflow(wf);
    await this._decide(id);
    return wf;
  }

  async rerun(id, body) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    const reRunFromWorkflowId = body.reRunFromWorkflowId || id;
    const workflowInput = body.workflowInput || wf.input;
    const taskInput = body.taskInput || {};
    const reRunFromTaskId = body.reRunFromTaskId;

    for (const t of wf.tasks || []) this._tasks.delete(t.taskId);
    wf.tasks = [];
    wf.status = WorkflowStatus.RUNNING;
    wf.input = { ...wf.input, ...workflowInput };
    wf.reRunFromWorkflowId = reRunFromWorkflowId;
    wf.startTime = this.now();
    wf.endTime = 0;
    wf.output = {};
    wf.reasonForIncompletion = '';
    wf.deciderState = {};

    if (reRunFromTaskId) {
      const src = await this.store.get('workflows', reRunFromWorkflowId);
      const srcTask = src ? (src.tasks || []).find((t) => t.taskId === reRunFromTaskId) : null;
      if (srcTask) {
        wf.deciderState.reRunFromTaskRef = srcTask.referenceTaskName;
        wf.deciderState.taskInput = taskInput;
      }
    }
    await this._saveWorkflow(wf);
    await this._decide(id);
    return wf;
  }

  async skipTask(id, taskReferenceName, body = {}) {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    const task = latestTaskForRef(wf, taskReferenceName);
    if (task) {
      task.status = TaskStatus.SKIPPED;
      task.outputData = body.taskOutput || {};
      task.inputData = body.taskInput || task.inputData;
      task.endTime = this.now();
    }
    await this._saveWorkflow(wf);
    await this._decide(id);
    return wf;
  }

  async terminate(id, reason = '') {
    const wf = await this.store.get('workflows', id);
    if (!wf) return null;
    if (!isTerminalWorkflow(wf.status)) {
      wf.status = WorkflowStatus.TERMINATED;
      wf.reasonForIncompletion = reason || 'Workflow terminated';
      wf.endTime = this.now();
      wf.updateTime = this.now();
      // Mark in-flight tasks cancelled.
      for (const t of wf.tasks || []) {
        if (t.status === TaskStatus.SCHEDULED || t.status === TaskStatus.IN_PROGRESS) {
          t.status = TaskStatus.CANCELED;
        }
      }
      await this._saveWorkflow(wf);
      this._removeFromQueues(wf);
      this._emit('workflow.terminated', { workflowId: id });
    }
    return wf;
  }

  async remove(id, { archiveWorkflow = true } = {}) {
    const wf = await this.store.get('workflows', id);
    if (wf) {
      for (const t of wf.tasks || []) this._tasks.delete(t.taskId);
      this._removeFromQueues(wf);
      if (wf.idempotencyKey) this._unindexIdempotencyKey(wf);
      await this.store.delete('workflows', id);
    }
  }

  async decide(id) {
    await this._decide(id);
  }

  // ---- tasks ------------------------------------------------------------

  async getTask(taskId) {
    return this._tasks.get(taskId) || null;
  }

  async poll(taskType, workerId = null, domain = null) {
    this._promoteDelayed(this.now());
    const queue = this._queues.get(taskType) || [];
    let idx = -1;
    for (let i = 0; i < queue.length; i++) {
      const task = this._tasks.get(queue[i]);
      if (!task) continue;
      if (domain && task.domain && task.domain !== domain) continue;
      idx = i;
      break;
    }
    if (idx === -1) return null;
    const taskId = queue.splice(idx, 1)[0];
    const task = this._tasks.get(taskId);
    if (!task) return null;
    task.status = TaskStatus.IN_PROGRESS;
    task.workerId = workerId;
    task.pollCount = (task.pollCount || 0) + 1;
    task.startTime = this.now();
    task.updateTime = this.now();
    task.callbackAfterSeconds = 0;
    await this._saveTask(task);
    return task;
  }

  async batchPoll(taskType, workerId = null, domain = null, count = 1, timeout = 100) {
    const out = [];
    const deadline = this.now() + timeout;
    do {
      const task = await this.poll(taskType, workerId, domain);
      if (task) out.push(task);
    } while (out.length < count && this.now() < deadline);
    return out;
  }

  async updateTask(result) {
    const task = this._tasks.get(result.taskId);
    if (!task) {
      throw new ApplicationException(`No task found with id ${result.taskId}`, { status: 404 });
    }
    await this._applyTaskResult(task, result);
    return task.taskId;
  }

  async updateTaskV2(result) {
    const task = this._tasks.get(result.taskId);
    if (!task) throw new ApplicationException(`No task found with id ${result.taskId}`, { status: 404 });
    await this._applyTaskResult(task, result);
    const next = await this.poll(task.taskDefName || task.taskType, result.workerId, null);
    return next;
  }

  async updateTaskByRef(workflowId, taskRefName, status, output, workerId = null) {
    const wf = await this.store.get('workflows', workflowId);
    if (!wf) throw new ApplicationException(`No workflow found with id ${workflowId}`, { status: 404 });
    const task = latestTaskForRef(wf, taskRefName);
    if (!task) throw new ApplicationException(`No task found with reference name ${taskRefName}`, { status: 404 });
    await this._applyTaskResult(task, {
      workflowInstanceId: workflowId,
      taskId: task.taskId,
      status,
      outputData: output,
      workerId,
    });
    return task;
  }

  // ---- logs -------------------------------------------------------------

  async addTaskLog(taskId, message) {
    const task = this._tasks.get(taskId);
    if (!task) throw new ApplicationException(`No task found with id ${taskId}`, { status: 404 });
    task.logs = task.logs || [];
    task.logs.push({ log: message, taskId, createdTime: this.now() });
    await this._saveTask(task);
  }

  async getTaskLogs(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return null;
    return task.logs || [];
  }

  // ---- queues -----------------------------------------------------------

  async getQueueSizes() {
    const sizes = {};
    for (const [taskType, queue] of this._queues.entries()) {
      sizes[taskType] = queue.length;
    }
    return sizes;
  }

  async getQueueSize(taskType) {
    return (this._queues.get(taskType) || []).length;
  }

  async requeue(taskType) {
    const wfs = await this.store.list('workflows');
    let count = 0;
    for (const wf of wfs) {
      for (const t of wf.tasks || []) {
        if (t.status === TaskStatus.SCHEDULED && t.taskDefName === taskType) {
          this._enqueue(t);
          count++;
        }
      }
    }
    return count;
  }

  // ---- search -----------------------------------------------------------

  async searchWorkflows({ query = null, freeText = null, start = 0, size = 100, sort = null } = {}) {
    let wfs = await this.store.list('workflows');
    const summary = (w) => ({
      workflowType: w.workflowName,
      version: w.workflowVersion,
      status: w.status,
      startTime: w.startTime,
      endTime: w.endTime,
      correlationId: w.correlationId,
      workflowId: w.workflowId,
    });
    wfs = wfs.filter(this._buildFilter(query, freeText, summary));
    wfs = this._applySort(wfs, sort, summary);
    const totalHits = wfs.length;
    const results = wfs.slice(start, start + size).map((w) => this._summarizeWorkflow(w));
    return { totalHits, results };
  }

  async searchTasks({ query = null, freeText = null, start = 0, size = 100, sort = null } = {}) {
    let tasks = [...this._tasks.values()];
    tasks = tasks.filter(this._buildFilter(query, freeText, (t) => ({ workflowType: t.workflowType, status: t.status, taskType: t.taskType, startTime: t.startTime })));
    tasks = this._applySort(tasks, sort, (t) => ({ startTime: t.startTime, updateTime: t.updateTime }));
    const totalHits = tasks.length;
    return { totalHits, results: tasks.slice(start, start + size) };
  }

  _summarizeWorkflow(w) {
    return {
      workflowType: w.workflowName,
      version: w.workflowVersion,
      workflowId: w.workflowId,
      correlationId: w.correlationId,
      startTime: new Date(w.startTime).toISOString(),
      updateTime: new Date(w.updateTime || w.startTime).toISOString(),
      endTime: w.endTime ? new Date(w.endTime).toISOString() : undefined,
      status: w.status,
      executionTime: w.endTime ? w.endTime - w.startTime : 0,
      input: w.input,
      output: w.output,
    };
  }

  // ---- event handlers ---------------------------------------------------

  async registerEventHandler(handler) {
    const name = handler.name;
    await this.store.put('eventHandlers', name, handler);
    this._eventHandlers.set(name, handler);
    return handler;
  }

  async getEventHandlers() {
    return [...this._eventHandlers.values()];
  }

  async getEventHandler(name) {
    return this._eventHandlers.get(name) || null;
  }

  async deleteEventHandler(name) {
    await this.store.delete('eventHandlers', name);
    this._eventHandlers.delete(name);
  }

  async publishEvent(event) {
    // Find matching handlers (on event name) and trigger their actions.
    const actions = [];
    for (const handler of this._eventHandlers.values()) {
      const matches = handler.event === event.name || handler.event === '*';
      if (!matches) continue;
      for (const action of handler.actions || []) {
        actions.push(await this._runEventAction(action, event, handler));
      }
    }
    return actions;
  }

  async _runEventAction(action, event, handler) {
    switch (action.action) {
      case 'start_workflow': {
        const spec = action.start_workflow || {};
        const workflowId = await this.startWorkflow({
          name: spec.name,
          version: spec.version,
          input: { ...spec.input, event: event },
        });
        return { action: 'start_workflow', workflowId };
      }
      case 'complete_task': {
        const spec = action.complete_task || {};
        const workflowId = spec.workflowId || (event && event.workflowId);
        const taskRef = spec.taskRefName;
        if (!workflowId || !taskRef) return { action: 'complete_task', skipped: true };
        await this.updateTaskByRef(workflowId, taskRef, TaskStatus.COMPLETED, event.payload || {});
        return { action: 'complete_task', workflowId, taskRefName: taskRef };
      }
      case 'fail_task': {
        const spec = action.fail_task || {};
        const workflowId = spec.workflowId || (event && event.workflowId);
        const taskRef = spec.taskRefName;
        if (!workflowId || !taskRef) return { action: 'fail_task', skipped: true };
        await this.updateTaskByRef(workflowId, taskRef, TaskStatus.FAILED, {}, 'event');
        return { action: 'fail_task', workflowId, taskRefName: taskRef };
      }
      default:
        return { action: action.action, ignored: true };
    }
  }

  // ---- internal: decider / scheduling -----------------------------------

  _startSweeper() {
    if (this._sweeper || !this.sweeperIntervalMs) return;
    this._sweeper = setInterval(() => {
      this._sweep().catch((e) => this.logger.warn('[in-browser-conductor] sweep error', e));
    }, this.sweeperIntervalMs);
  }

  async _sweep() {
    const now = this.now();
    this._promoteDelayed(now);
    await this._enforceTimeouts(now);
  }

  _promoteDelayed(now) {
    const remaining = [];
    for (const entry of this._delayed) {
      if (entry.readyAt <= now) {
        const task = this._tasks.get(entry.taskId);
        if (task && task.status === TaskStatus.SCHEDULED) this._enqueue(task);
      } else {
        remaining.push(entry);
      }
    }
    this._delayed = remaining;
  }

  async _enforceTimeouts(now) {
    const workflows = await this.store.list('workflows');
    for (const wf of workflows) {
      if (wf.status !== WorkflowStatus.RUNNING && wf.status !== WorkflowStatus.PAUSED) continue;
      const def = await this.getWorkflowDef(wf.workflowName, wf.workflowVersion);
      if (!def) continue;
      // Workflow timeout.
      if (def.timeoutSeconds > 0 && wf.startTime && now - wf.startTime > def.timeoutSeconds * 1000) {
        if (def.timeoutPolicy !== TimeoutPolicy.ALERT_ONLY) {
          await this._failWorkflow(wf, null, 'Workflow timed out');
          continue;
        }
      }
      // Task timeouts.
      for (const task of wf.tasks || []) {
        if (task.status !== TaskStatus.IN_PROGRESS) continue;
        const taskDef = (await this.getTaskDef(task.taskDefName)) || {};
        const timeoutSeconds = taskDef.timeoutSeconds || 0;
        if (timeoutSeconds > 0 && task.startTime && now - task.startTime > timeoutSeconds * 1000) {
          await this._handleTaskTimeout(wf, task, taskDef, def);
        }
      }
    }
  }

  async _handleTaskTimeout(wf, task, taskDef, wfDef) {
    const policy = taskDef.timeoutPolicy || TimeoutPolicy.TIME_OUT_WF;
    if (policy === TimeoutPolicy.RETRY) {
      task.status = TaskStatus.TIMED_OUT;
      task.reasonForIncompletion = 'Task timed out';
      task.endTime = this.now();
      await this._saveTask(task);
      await this._maybeRetry(wf, task, taskDef);
    } else if (policy === TimeoutPolicy.TIME_OUT_WF) {
      task.status = TaskStatus.TIMED_OUT;
      task.reasonForIncompletion = 'Task timed out';
      await this._saveTask(task);
      await this._failWorkflow(wf, task, 'Task timed out');
    } else {
      // ALERT_ONLY: keep going.
    }
  }

  async _decide(workflowId) {
    if (this._deciding.has(workflowId)) {
      this._pendingDecide.add(workflowId);
      return;
    }
    this._deciding.add(workflowId);
    try {
      await this._decideImpl(workflowId);
    } finally {
      this._deciding.delete(workflowId);
      if (this._pendingDecide.delete(workflowId)) {
        // Pick up state that changed while we were deciding.
        await this._decide(workflowId);
      }
    }
  }

  async _decideImpl(workflowId) {
    for (let step = 0; step < MAX_DECIDE_STEPS; step++) {
      const wf = await this.store.get('workflows', workflowId);
      if (!wf || isTerminalWorkflow(wf.status)) return;
      if (wf.status === WorkflowStatus.PAUSED) return;

      const def = await this.getWorkflowDef(wf.workflowName, wf.workflowVersion);
      if (!def) return;

      let res;
      try {
        res = this.decider.next(wf, def);
      } catch (e) {
        await this._failWorkflow(wf, null, e.message);
        return;
      }

      if (res.terminates) {
        await this._applyTerminate(wf, res.terminates);
        return;
      }

      let progressed = res.progress;

      for (const sub of res.subworkflows) {
        await this._startSubWorkflow(wf, sub);
        progressed = true;
      }

      for (const scheduled of res.tasks) {
        await this._scheduleLeaf(wf, scheduled);
        progressed = true;
      }

      if (res.completed && res.tasks.length === 0 && res.subworkflows.length === 0 && !res.terminates) {
        await this._completeWorkflow(wf, def);
        return;
      }

      await this._saveWorkflow(wf);
      if (!progressed) return;
    }
    this.logger.warn('[in-browser-conductor] decide exceeded step limit', workflowId);
  }

  async _scheduleLeaf(wf, scheduled) {
    const { taskDef, taskDefName, inputData, iteration, dynamic } = scheduled;
    const type = taskDef.type;
    const rec = createTaskRecord(wf, this.decider.def, taskDef, inputData, {
      resolvedType: type,
      taskDefName: taskDefName || taskDef.name,
      iteration,
      dynamic,
    });
    rec.domain = this._domainFor(wf, taskDef.taskReferenceName);
    wf.tasks.push(rec);
    this._tasks.set(rec.taskId, rec);

    if (type === TaskType.WAIT) {
      // WAIT tasks are completed externally; mark IN_PROGRESS and wait.
      rec.status = TaskStatus.IN_PROGRESS;
      rec.startTime = this.now();
      await this._saveWorkflow(wf);
      return;
    }
    if (type === TaskType.SIMPLE || type === TaskType.HUMAN) {
      if (rec.startDelayInSeconds > 0) {
        this._delayTask(rec, rec.startDelayInSeconds);
      } else {
        this._enqueue(rec);
      }
      await this._saveWorkflow(wf);
      return;
    }
    if (isInlineSystemTask(type)) {
      await this._executeInlineSystemTask(wf, rec, taskDef);
      return;
    }
    if (isAsyncSystemTask(type)) {
      rec.status = TaskStatus.IN_PROGRESS;
      rec.startTime = this.now();
      await this._saveWorkflow(wf);
      this._executeAsyncSystemTask(wf, rec, taskDef).catch((e) => this.logger.warn('[in-browser-conductor] async task error', e));
      return;
    }
    // Unknown leaf type: treat like SIMPLE.
    this._enqueue(rec);
    await this._saveWorkflow(wf);
  }

  _domainFor(wf, taskRef) {
    const map = wf.taskToDomain || {};
    return map[taskRef] || map['*'] || null;
  }

  async _executeInlineSystemTask(wf, rec, taskDef) {
    rec.status = TaskStatus.IN_PROGRESS;
    rec.startTime = this.now();
    try {
      let output;
      switch (rec.type) {
        case TaskType.NOOP:
          output = executeNoop(rec.inputData);
          break;
        case TaskType.INLINE:
          output = executeInline(rec.inputData, taskDef);
          break;
        case TaskType.JSON_JQ_TRANSFORM:
          output = executeJsonJq(rec.inputData, taskDef);
          break;
        case TaskType.EVENT:
          output = executeEvent(rec.inputData, taskDef, {
            publish: (e) => this.publishEvent({ name: e.event, payload: e.payload }),
          });
          break;
        default:
          output = rec.inputData;
      }
      rec.status = TaskStatus.COMPLETED;
      rec.outputData = output || {};
      rec.endTime = this.now();
      rec.updateTime = this.now();
      await this._saveWorkflow(wf);
      this._emit('task.completed', { workflowId: wf.workflowId, taskId: rec.taskId, taskType: rec.taskType });
    } catch (e) {
      rec.status = TaskStatus.FAILED;
      rec.reasonForIncompletion = e.message;
      rec.endTime = this.now();
      await this._saveWorkflow(wf);
      await this._handleTaskFailure(wf, rec);
    }
  }

  async _executeAsyncSystemTask(wf, rec, taskDef) {
    try {
      let output;
      if (rec.type === TaskType.HTTP) {
        output = await executeHttp(rec.inputData, taskDef);
      } else {
        output = rec.inputData;
      }
      rec.status = TaskStatus.COMPLETED;
      rec.outputData = output || {};
      rec.endTime = this.now();
      rec.updateTime = this.now();
      await this._saveWorkflow(wf);
      this._emit('task.completed', { workflowId: wf.workflowId, taskId: rec.taskId, taskType: rec.taskType });
    } catch (e) {
      rec.status = TaskStatus.FAILED;
      rec.reasonForIncompletion = e.message;
      rec.endTime = this.now();
      await this._saveWorkflow(wf);
      await this._handleTaskFailure(wf, rec);
    }
    await this._decide(wf.workflowId);
  }

  async _startSubWorkflow(wf, sub) {
    const rec = latestTaskForRef(wf, sub.taskDef.taskReferenceName);
    try {
      const childId = await this.startWorkflow({
        name: sub.name,
        version: sub.version,
        input: sub.inputData,
        parentWorkflowId: wf.workflowId,
        parentWorkflowTaskId: sub.taskDef.taskReferenceName,
      });
      if (sub.fireAndForget) {
        if (rec) {
          rec.status = TaskStatus.COMPLETED;
          rec.outputData = { workflowId: childId };
          rec.endTime = this.now();
        }
        await this._saveWorkflow(wf);
        return;
      }
      // Record child id on the SUB_WORKFLOW task; completed when child finishes.
      if (rec) {
        rec.inputData = { ...(rec.inputData || {}), workflowId: childId, subWorkflowId: childId };
      }
      await this._saveWorkflow(wf);
    } catch (e) {
      if (rec) {
        rec.status = TaskStatus.FAILED;
        rec.reasonForIncompletion = e.message;
      }
      await this._saveWorkflow(wf);
      await this._handleTaskFailure(wf, rec || { taskId: sub.taskDef.taskReferenceName, referenceTaskName: sub.taskDef.taskReferenceName, taskDefName: sub.taskDef.name });
    }
  }

  /** Called when a child workflow reaches a terminal state. */
  async _onChildWorkflowTerminal(child) {
    const parentId = child.parentWorkflowId;
    if (!parentId) return;
    const parent = await this.store.get('workflows', parentId);
    if (!parent) return;
    const ref = child.parentWorkflowTaskId;
    const rec = latestTaskForRef(parent, ref);
    if (!rec) return;
    if (child.status === WorkflowStatus.COMPLETED) {
      rec.status = TaskStatus.COMPLETED;
      rec.outputData = child.output || {};
      rec.endTime = this.now();
    } else {
      rec.status = TaskStatus.FAILED;
      rec.reasonForIncompletion = child.reasonForIncompletion || `Sub workflow ${child.status}`;
      rec.endTime = this.now();
      await this._saveWorkflow(parent);
      await this._handleTaskFailure(parent, rec);
      await this._decide(parentId);
      return;
    }
    await this._saveWorkflow(parent);
    await this._decide(parentId);
  }

  async _applyTaskResult(task, result) {
    const wf = await this.store.get('workflows', task.workflowInstanceId);
    if (result.logs && result.logs.length) {
      task.logs = task.logs || [];
      for (const l of result.logs) task.logs.push({ log: l, taskId: task.taskId, createdTime: this.now() });
    }
    task.workerId = result.workerId != null ? result.workerId : task.workerId;

    if (result.status === TaskStatus.COMPLETED) {
      task.status = TaskStatus.COMPLETED;
      task.outputData = result.outputData || {};
      task.reasonForIncompletion = '';
      task.endTime = this.now();
      task.updateTime = this.now();
      await this._saveTask(task);
      this._emit('task.completed', { workflowId: wf.workflowId, taskId: task.taskId, taskType: task.taskType });
      await this._decide(wf.workflowId);
    } else if (result.status === TaskStatus.IN_PROGRESS) {
      task.status = TaskStatus.IN_PROGRESS;
      task.outputData = result.outputData || task.outputData;
      task.updateTime = this.now();
      if (result.callbackAfterSeconds > 0) {
        task.callbackAfterSeconds = result.callbackAfterSeconds;
        this._delayTask(task, result.callbackAfterSeconds);
      }
      await this._saveTask(task);
    } else if (result.status === TaskStatus.FAILED || result.status === TaskStatus.FAILED_WITH_TERMINAL_ERROR) {
      task.status = result.status;
      task.reasonForIncompletion = result.reasonForIncompletion || 'Task failed';
      task.outputData = result.outputData || {};
      task.endTime = this.now();
      task.updateTime = this.now();
      await this._saveTask(task);
      this._emit('task.failed', { workflowId: wf.workflowId, taskId: task.taskId, taskType: task.taskType });
      await this._handleTaskFailure(wf, task);
      await this._decide(wf.workflowId);
    }
  }

  async _handleTaskFailure(wf, task) {
    if (!task) return;
    if (task.optional) {
      task.status = TaskStatus.COMPLETED_WITH_ERRORS;
      await this._saveWorkflow(wf);
      return;
    }
    const taskDef = (await this.getTaskDef(task.taskDefName)) || {};
    const maxRetries = taskDef.retryCount != null ? taskDef.retryCount : 0;
    if ((task.retryCount || 0) < maxRetries) {
      await this._maybeRetry(wf, task, taskDef);
    } else {
      await this._failWorkflow(wf, task, task.reasonForIncompletion || `${task.taskDefName} failed`);
    }
  }

  async _maybeRetry(wf, task, taskDef) {
    task.retried = true;
    const attempt = (task.retryCount || 0) + 1;
    const delaySeconds = retryDelay(taskDef, attempt);
    const newTask = createTaskRecord(wf, this.decider.def, { taskReferenceName: task.referenceTaskName, name: task.taskDefName, type: task.type }, task.inputData, {
      resolvedType: task.type,
      taskDefName: task.taskDefName,
      seq: task.seq + 1,
    });
    newTask.retryCount = attempt;
    newTask.retriedTaskId = task.taskId;
    newTask.domain = task.domain;
    newTask.iteration = task.iteration;
    newTask.optional = task.optional;
    wf.tasks.push(newTask);
    this._tasks.set(newTask.taskId, newTask);
    task.retriedTaskId = newTask.taskId;
    await this._saveWorkflow(wf);
    this._delayTask(newTask, delaySeconds);
    this._emit('task.retried', { workflowId: wf.workflowId, taskId: task.taskId, retriedTaskId: newTask.taskId });
  }

  async _failWorkflow(wf, task, reason) {
    wf.status = WorkflowStatus.FAILED;
    wf.reasonForIncompletion = reason || (task ? `${task.taskDefName} failed` : 'Workflow failed');
    wf.endTime = this.now();
    wf.updateTime = this.now();
    if (task) {
      wf.failedReferenceTaskNames = [task.referenceTaskName];
      wf.failedTaskNames = [task.taskDefName || task.taskType];
    }
    await this._saveWorkflow(wf);
    this._removeFromQueues(wf);
    this._emit('workflow.failed', { workflowId: wf.workflowId, reason: wf.reasonForIncompletion });

    const def = await this.getWorkflowDef(wf.workflowName, wf.workflowVersion);
    if (def && def.failureWorkflow) {
      await this.startWorkflow({
        name: def.failureWorkflow,
        version: def.failureWorkflowVersion,
        input: {
          ...(wf.input || {}),
          workflowId: wf.workflowId,
          reason: wf.reasonForIncompletion,
          failureStatus: wf.status,
          failureTaskId: task ? task.taskId : null,
        },
      });
    }
  }

  async _completeWorkflow(wf, def) {
    wf.status = WorkflowStatus.COMPLETED;
    wf.output = this._computeOutput(wf, def);
    wf.endTime = this.now();
    wf.updateTime = this.now();
    await this._saveWorkflow(wf);
    this._emit('workflow.completed', { workflowId: wf.workflowId });
    await this._onChildWorkflowTerminal(wf);
  }

  async _applyTerminate(wf, term) {
    const output = term.output != null ? term.output : {};
    if (term.status === 'COMPLETED' || term.status === WorkflowStatus.COMPLETED) {
      wf.status = WorkflowStatus.COMPLETED;
      wf.output = output;
      wf.endTime = this.now();
      wf.updateTime = this.now();
      await this._saveWorkflow(wf);
      this._emit('workflow.completed', { workflowId: wf.workflowId });
      await this._onChildWorkflowTerminal(wf);
    } else if (term.status === 'FAILED' || term.status === WorkflowStatus.FAILED) {
      await this._failWorkflow(wf, null, term.reason || 'Workflow terminated with failure');
    } else {
      await this.terminate(wf.workflowId, term.reason);
    }
  }

  _computeOutput(wf, def) {
    if (def && def.outputParameters && Object.keys(def.outputParameters).length) {
      const root = buildContext(wf, latestTasksByRef(wf));
      return substitute(def.outputParameters, root);
    }
    if (def && def.tasks && def.tasks.length) {
      const last = def.tasks[def.tasks.length - 1];
      const t = latestTaskForRef(wf, last.taskReferenceName);
      if (t) return t.outputData || {};
    }
    return {};
  }

  // ---- internal: queues / persistence -----------------------------------

  _indexTask(task) {
    this._tasks.set(task.taskId, task);
    if (task.status === TaskStatus.SCHEDULED && task.taskType !== TaskType.WAIT) {
      if (task.callbackAfterSeconds > 0 || task.scheduledTime > this.now()) {
        this._delayTask(task, Math.ceil(((task.scheduledTime || this.now()) - this.now()) / 1000));
      } else {
        this._enqueue(task);
      }
    }
  }

  _enqueue(task) {
    const key = task.taskDefName || task.taskType;
    if (!this._queues.has(key)) this._queues.set(key, []);
    const queue = this._queues.get(key);
    if (!queue.includes(task.taskId)) queue.push(task.taskId);
  }

  _delayTask(task, seconds) {
    this._delayed.push({ taskId: task.taskId, readyAt: this.now() + seconds * 1000 });
  }

  _removeFromQueues(wf) {
    for (const t of wf.tasks || []) {
      const q = this._queues.get(t.taskDefName || t.taskType);
      if (q) {
        const i = q.indexOf(t.taskId);
        if (i >= 0) q.splice(i, 1);
      }
    }
    this._delayed = this._delayed.filter((d) => !wf.tasks.some((t) => t.taskId === d.taskId));
  }

  async _saveWorkflow(wf) {
    await this.store.put('workflows', wf.workflowId, wf);
  }

  async _saveTask(task) {
    // Task state is embedded in the workflow; persist the owning workflow.
    const wf = await this.store.get('workflows', task.workflowInstanceId);
    if (wf) await this.store.put('workflows', wf.workflowId, wf);
  }

  // ---- query helpers ----------------------------------------------------

  _buildFilter(query, freeText, summary = (x) => x) {
    const predicates = [];
    if (query) {
      for (const cond of parseQuery(query)) {
        predicates.push((doc) => testCondition(doc, summary(doc), cond));
      }
    }
    if (freeText && freeText !== '*') {
      const needle = freeText.toLowerCase();
      predicates.push((doc) => JSON.stringify(doc).toLowerCase().includes(needle));
    }
    if (predicates.length === 0) return () => true;
    return (doc) => predicates.every((p) => p(doc));
  }

  _applySort(list, sort, summary) {
    if (!sort) return list;
    const [field, dir] = sort.split(':');
    const mult = (dir || 'ASC').toUpperCase() === 'DESC' ? -1 : 1;
    return list.slice().sort((a, b) => {
      const av = summary(a)[field];
      const bv = summary(b)[field];
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
  }
}

// ---- retry delay --------------------------------------------------------

export function retryDelay(taskDef, attempt) {
  const base = taskDef.retryDelaySeconds != null ? taskDef.retryDelaySeconds : 60;
  switch (taskDef.retryLogic) {
    case 'EXPONENTIAL_BACKOFF':
      return Math.max(10, base) * Math.pow(2, Math.max(0, attempt - 1));
    case 'LINEAR_BACKOFF':
      return base * attempt;
    case 'FIXED':
    default:
      return base;
  }
}

// ---- SQL-like query parsing --------------------------------------------

export function parseQuery(query) {
  const tokens = query.match(/('[^']*'|"[^"]*"|[^\s]+)/g) || [];
  const conditions = [];
  let i = 0;
  while (i < tokens.length) {
    const field = tokens[i++];
    if (!tokens[i] || tokens[i].toUpperCase() === 'AND') {
      i += tokens[i] && tokens[i].toUpperCase() === 'AND' ? 1 : 0;
      continue;
    }
    const op = tokens[i++];
    let value = tokens[i++];
    if (value == null) break;
    value = unquote(value);
    conditions.push({ field, op, value });
    if (tokens[i] && tokens[i].toUpperCase() === 'AND') i++;
  }
  return conditions;
}

function unquote(value) {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function testCondition(doc, summary, cond) {
  const raw = doc[cond.field] != null ? doc[cond.field] : summary[cond.field];
  const actual = typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  const expected = cond.value;
  switch (cond.op) {
    case '=':
    case '==':
      return actual === expected || String(actual) === String(expected);
    case '!=':
      return actual !== expected;
    case '>':
      return Number(actual) > Number(expected);
    case '<':
      return Number(actual) < Number(expected);
    case '>=':
      return Number(actual) >= Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case 'IN': {
      const list = String(expected).replace(/[()]/g, '').split(',').map((s) => unquote(s.trim()));
      return list.includes(String(actual));
    }
    default:
      return String(actual) === String(expected);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
