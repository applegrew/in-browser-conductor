import { TaskStatus } from '../enums.js';
import { ConductorClient } from './client.js';

/**
 * A worker that polls a task type, executes a handler, and reports the
 * result — the browser analogue of a Conductor worker (SDK task runner).
 *
 *   const worker = new ConductorWorker({
 *     taskType: 'shipping_info',
 *     baseURL: '/api',
 *     executeTask: async (input) => ({ address: '...' }),
 *   });
 *   worker.start();
 */
export class ConductorWorker {
  constructor({
    taskType,
    baseURL = '/api',
    workerId = null,
    domain = null,
    concurrency = 1,
    pollInterval = 1000,
    executeTask = null,
    client = null,
    onTaskComplete = null,
  }) {
    this.taskType = taskType;
    this.baseURL = baseURL;
    this.workerId = workerId || `worker-${Math.random().toString(36).slice(2, 8)}`;
    this.domain = domain;
    this.concurrency = concurrency;
    this.pollInterval = pollInterval;
    this.executeTask = executeTask;
    this.client = client;
    this.onTaskComplete = onTaskComplete;
    this._running = false;
    this._timer = null;
    this._inflight = 0;
  }

  _ensureClient() {
    if (!this.client) {
      this.client = new ConductorClient({ baseURL: this.baseURL });
    }
    return this.client;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._tick();
  }

  stop() {
    this._running = false;
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
  }

  async poll() {
    return this._ensureClient().taskResource.poll(this.taskType, this.workerId, this.domain);
  }

  async _tick() {
    if (!this._running) return;
    try {
      while (this._running && this._inflight < this.concurrency) {
        const task = await this.poll();
        if (!task) break;
        this._inflight += 1;
        this._run(task).finally(() => {
          this._inflight -= 1;
        });
      }
    } catch (e) {
      /* transient poll errors are ignored; retry on next tick */
    }
    this._timer = setTimeout(() => this._tick(), this.pollInterval);
  }

  async _run(task) {
    let result;
    try {
      const output = this.executeTask
        ? await this.executeTask(task.inputData)
        : {};
      result = { status: TaskStatus.COMPLETED, outputData: output || {} };
    } catch (e) {
      result = {
        status: TaskStatus.FAILED,
        outputData: {},
        reasonForIncompletion: e && e.message ? e.message : String(e),
      };
    }
    await this._ensureClient().taskResource.updateTask({
      workflowInstanceId: task.workflowInstanceId,
      taskId: task.taskId,
      status: result.status,
      outputData: result.outputData,
      reasonForIncompletion: result.reasonForIncompletion,
      workerId: this.workerId,
    });
    if (this.onTaskComplete) {
      try { this.onTaskComplete({ task, result }); } catch { /* ignore */ }
    }
  }
}
