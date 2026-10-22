var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/enums.js
var enums_exports = {};
__export(enums_exports, {
  IdempotencyStrategy: () => IdempotencyStrategy,
  OPERATOR_TASK_TYPES: () => OPERATOR_TASK_TYPES,
  RetryLogic: () => RetryLogic,
  SYSTEM_TASK_TYPES: () => SYSTEM_TASK_TYPES,
  TERMINAL_TASK_STATUSES: () => TERMINAL_TASK_STATUSES,
  TERMINAL_WORKFLOW_STATUSES: () => TERMINAL_WORKFLOW_STATUSES,
  TaskStatus: () => TaskStatus,
  TaskType: () => TaskType,
  TimeoutPolicy: () => TimeoutPolicy,
  WorkflowStatus: () => WorkflowStatus
});
var WorkflowStatus = {
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  TIMED_OUT: "TIMED_OUT",
  TERMINATED: "TERMINATED"
};
var TaskStatus = {
  SCHEDULED: "SCHEDULED",
  IN_PROGRESS: "IN_PROGRESS",
  CANCELED: "CANCELED",
  FAILED: "FAILED",
  FAILED_WITH_TERMINAL_ERROR: "FAILED_WITH_TERMINAL_ERROR",
  COMPLETED: "COMPLETED",
  COMPLETED_WITH_ERRORS: "COMPLETED_WITH_ERRORS",
  TIMED_OUT: "TIMED_OUT",
  SKIPPED: "SKIPPED"
};
var TaskType = {
  SIMPLE: "SIMPLE",
  DYNAMIC: "DYNAMIC",
  FORK_JOIN: "FORK_JOIN",
  FORK: "FORK_JOIN",
  JOIN: "JOIN",
  EXCLUSIVE_JOIN: "EXCLUSIVE_JOIN",
  DO_WHILE: "DO_WHILE",
  SWITCH: "SWITCH",
  DECISION: "DECISION",
  SUB_WORKFLOW: "SUB_WORKFLOW",
  START_WORKFLOW: "START_WORKFLOW",
  DYNAMIC_FORK: "DYNAMIC_FORK",
  HTTP: "HTTP",
  INLINE: "INLINE",
  WAIT: "WAIT",
  HUMAN: "HUMAN",
  EVENT: "EVENT",
  TERMINATE: "TERMINATE",
  SET_VARIABLE: "SET_VARIABLE",
  JSON_JQ_TRANSFORM: "JSON_JQ_TRANSFORM",
  NOOP: "NOOP"
};
var RetryLogic = {
  FIXED: "FIXED",
  EXPONENTIAL_BACKOFF: "EXPONENTIAL_BACKOFF",
  LINEAR_BACKOFF: "LINEAR_BACKOFF"
};
var TimeoutPolicy = {
  RETRY: "RETRY",
  TIME_OUT_WF: "TIME_OUT_WF",
  ALERT_ONLY: "ALERT_ONLY"
};
var IdempotencyStrategy = {
  FAIL: "FAIL",
  RETURN_EXISTING: "RETURN_EXISTING",
  FAIL_ON_RUNNING: "FAIL_ON_RUNNING"
};
var OPERATOR_TASK_TYPES = /* @__PURE__ */ new Set([
  TaskType.FORK_JOIN,
  TaskType.JOIN,
  TaskType.EXCLUSIVE_JOIN,
  TaskType.DO_WHILE,
  TaskType.SWITCH,
  TaskType.TERMINATE,
  TaskType.SET_VARIABLE,
  TaskType.SUB_WORKFLOW,
  TaskType.START_WORKFLOW,
  TaskType.DYNAMIC,
  TaskType.DYNAMIC_FORK
]);
var SYSTEM_TASK_TYPES = /* @__PURE__ */ new Set([
  TaskType.HTTP,
  TaskType.INLINE,
  TaskType.NOOP,
  TaskType.EVENT,
  TaskType.JSON_JQ_TRANSFORM
]);
var TERMINAL_WORKFLOW_STATUSES = /* @__PURE__ */ new Set([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.TIMED_OUT,
  WorkflowStatus.TERMINATED
]);
var TERMINAL_TASK_STATUSES = /* @__PURE__ */ new Set([
  TaskStatus.COMPLETED,
  TaskStatus.COMPLETED_WITH_ERRORS,
  TaskStatus.FAILED,
  TaskStatus.FAILED_WITH_TERMINAL_ERROR,
  TaskStatus.TIMED_OUT,
  TaskStatus.SKIPPED,
  TaskStatus.CANCELED
]);

// src/ids.js
function uuid() {
  const c = typeof crypto !== "undefined" && crypto.randomUUID;
  if (c) return crypto.randomUUID();
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = b[6] & 15 | 64;
    b[8] = b[8] & 63 | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.random() * 16 | 0;
    const v = ch === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}

// src/expression.js
function tokenize(path) {
  const segments = [];
  let i = 0;
  const len = path.length;
  while (i < len) {
    const ch = path[i];
    if (ch === "." || ch === " " || ch === "	" || ch === "\n") {
      i += 1;
      continue;
    }
    if (ch === "[") {
      const close = path.indexOf("]", i);
      if (close === -1) {
        segments.push(path.slice(i + 1));
        break;
      }
      let inner = path.slice(i + 1, close).trim();
      if (inner.startsWith("'") && inner.endsWith("'") || inner.startsWith('"') && inner.endsWith('"')) {
        inner = inner.slice(1, -1);
      }
      segments.push(inner);
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < len && path[j] !== "." && path[j] !== "[") j += 1;
    segments.push(path.slice(i, j));
    i = j;
  }
  return segments.filter((s) => s !== "");
}
function getByKey(value, key) {
  if (value == null) return void 0;
  if (Array.isArray(value)) {
    if (key === "*") return value;
    if (/^-?\d+$/.test(key)) return value[Number(key)];
    return void 0;
  }
  if (typeof value === "object") {
    if (key === "*") return Object.values(value);
    return value[key];
  }
  return void 0;
}
function descend(root, segments) {
  let cur = root;
  for (const seg of segments) {
    if (seg === "*") {
      if (Array.isArray(cur)) {
        const rest = segments.slice(segments.indexOf(seg) + 1);
        if (rest.length === 0) return cur;
        return cur.map((el) => descend(el, rest));
      }
      if (cur && typeof cur === "object") return Object.values(cur);
      return void 0;
    }
    cur = getByKey(cur, seg);
    if (cur === void 0) return void 0;
  }
  return cur;
}
function jsonPath(root, path) {
  if (path == null) return void 0;
  if (typeof path !== "string") return path;
  const p = path.trim();
  if (p === "$" || p === "") return root;
  const stripped = p.startsWith("$.") ? p.slice(2) : p.startsWith("$") ? p.slice(1) : p;
  const segments = tokenize(stripped);
  if (segments.length === 0) return root;
  return descend(root, segments);
}
function stringify(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
var FULL_EXPR = /^\s*\$\{([\s\S]+)\}\s*$/;
function substitute(value, root) {
  if (typeof value === "string") {
    if (value.startsWith("$$")) return value.slice(1);
    const full = FULL_EXPR.exec(value);
    if (full) {
      const result = jsonPath(root, full[1]);
      return result === void 0 ? null : result;
    }
    return value.replace(/\$\{([\s\S]+?)\}/g, (_, expr) => {
      const v = jsonPath(root, expr.trim());
      return stringify(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, root));
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = substitute(value[k], root);
    return out;
  }
  return value;
}
function buildContext(workflow, tasksByRef = {}) {
  const root = {
    workflow: {
      input: workflow.input || {},
      output: workflow.output || {},
      variables: workflow.variables || {},
      status: workflow.status,
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      workflowVersion: workflow.workflowVersion,
      correlationId: workflow.correlationId
    }
  };
  for (const ref of Object.keys(tasksByRef)) {
    const t = tasksByRef[ref];
    root[ref] = {
      input: t.inputData || {},
      output: t.outputData || {},
      status: t.status,
      taskId: t.taskId
    };
  }
  return root;
}
function evaluateSwitchCase(workflow, task, switchCaseValue, switchCaseExpression) {
  const tasksByRef = latestTasksByRef(workflow);
  const root = buildContext(workflow, tasksByRef);
  if (switchCaseExpression) {
    return jsonPath(root, switchCaseExpression);
  }
  if (switchCaseValue != null) {
    return substitute(switchCaseValue, root);
  }
  return void 0;
}
function latestTasksByRef(workflow) {
  const map = {};
  for (const t of workflow.tasks || []) {
    const prev = map[t.referenceTaskName];
    if (!prev || (t.seq ?? 0) >= (prev.seq ?? 0)) map[t.referenceTaskName] = t;
  }
  return map;
}
function getTaskByRef(workflow, ref) {
  return latestTasksByRef(workflow)[ref] || null;
}
function clone(value) {
  if (value === void 0) return void 0;
  return JSON.parse(JSON.stringify(value));
}

// src/engine/model.js
var TASK_DEF_DEFAULTS = {
  retryCount: 3,
  retryLogic: "FIXED",
  retryDelaySeconds: 60,
  timeoutSeconds: 0,
  timeoutPolicy: TimeoutPolicy.TIME_OUT_WF,
  responseTimeoutSeconds: 3600,
  pollTimeoutSeconds: 100,
  rateLimitPerSecond: 0,
  ownerEmail: "example@example.com"
};
var WORKFLOW_DEF_DEFAULTS = {
  schemaVersion: 2,
  restartable: true,
  workflowStatusListenerEnabled: false,
  timeoutSeconds: 0,
  timeoutPolicy: TimeoutPolicy.TIME_OUT_WF,
  ownerEmail: "example@example.com"
};
function normalizeTaskDef(taskDef) {
  if (!taskDef || !taskDef.name) return null;
  return { ...TASK_DEF_DEFAULTS, ...taskDef };
}
function normalizeWorkflowDef(def) {
  return { ...WORKFLOW_DEF_DEFAULTS, ...def };
}
function taskDefKey(name, version) {
  return `${name}:${version}`;
}
function createWorkflowInstance(def, request) {
  const now = Date.now();
  const input = { ...def.inputTemplate || {}, ...request.input || {} };
  return {
    workflowId: uuid(),
    workflowName: def.name,
    workflowVersion: def.version,
    correlationId: request.correlationId || void 0,
    idempotencyKey: request.idempotencyKey || void 0,
    parentWorkflowId: request.parentWorkflowId,
    parentWorkflowTaskId: request.parentWorkflowTaskId,
    reRunFromWorkflowId: request.reRunFromWorkflowId,
    status: WorkflowStatus.RUNNING,
    startTime: now,
    endTime: 0,
    updateTime: now,
    input,
    output: {},
    variables: clone(def.variables) || {},
    taskToDomain: request.taskToDomain || {},
    priority: request.priority != null ? request.priority : 0,
    tasks: [],
    failedReferenceTaskNames: [],
    failedTaskNames: [],
    reasonForIncompletion: "",
    lastRetriedTime: 0,
    event: request.event,
    deciderState: {}
  };
}
function createTaskRecord(workflow, def, taskDef, inputData, opts = {}) {
  const now = Date.now();
  const resolvedType = opts.resolvedType || taskDef.type;
  const taskDefName = opts.taskDefName || taskDef.name;
  const isWorkerTask = resolvedType === TaskType.SIMPLE || resolvedType === TaskType.HUMAN;
  return {
    taskId: uuid(),
    // Conductor-visible task type: the task definition name for worker tasks
    // (SIMPLE/HUMAN), the system task type otherwise (HTTP, SUB_WORKFLOW, ...).
    taskType: isWorkerTask ? taskDefName : resolvedType,
    type: resolvedType,
    taskDefName,
    referenceTaskName: taskDef.taskReferenceName,
    seq: opts.seq || 0,
    status: TaskStatus.SCHEDULED,
    workflowInstanceId: workflow.workflowId,
    workflowType: workflow.workflowName,
    workflowPriority: workflow.priority,
    inputData: inputData || {},
    outputData: {},
    workerId: null,
    pollCount: 0,
    retryCount: 0,
    retried: false,
    retriedTaskId: null,
    scheduledTime: now,
    startTime: 0,
    endTime: 0,
    updateTime: now,
    callbackAfterSeconds: 0,
    startDelayInSeconds: taskDef.startDelay || 0,
    reasonForIncompletion: "",
    domain: null,
    optional: !!taskDef.optional,
    asyncComplete: !!taskDef.asyncComplete,
    iteration: opts.iteration != null ? opts.iteration : null,
    dynamic: !!opts.dynamic
  };
}
function latestTaskForRef(workflow, ref) {
  let latest = null;
  for (const t of workflow.tasks || []) {
    if (t.referenceTaskName !== ref) continue;
    if (!latest || (t.seq ?? 0) >= (latest.seq ?? 0)) latest = t;
  }
  return latest;
}
function isTerminalWorkflow(status) {
  return status === WorkflowStatus.COMPLETED || status === WorkflowStatus.FAILED || status === WorkflowStatus.TIMED_OUT || status === WorkflowStatus.TERMINATED;
}
function isTerminalTask(status) {
  return status === TaskStatus.COMPLETED || status === TaskStatus.COMPLETED_WITH_ERRORS || status === TaskStatus.FAILED || status === TaskStatus.FAILED_WITH_TERMINAL_ERROR || status === TaskStatus.TIMED_OUT || status === TaskStatus.SKIPPED || status === TaskStatus.CANCELED;
}

// src/engine/decider.js
var Decider = class {
  constructor(server) {
    this.server = server;
  }
  next(workflow, def) {
    this.wf = workflow;
    this.def = def;
    this.result = { tasks: [], subworkflows: [], terminates: null, progress: false, completed: false };
    const done = this._walk(def.tasks || [], null);
    this.result.completed = done;
    return this.result;
  }
  /** Fresh evaluation context reflecting any records added during the walk. */
  _ctx() {
    return buildContext(this.wf, latestTasksByRef(this.wf));
  }
  /**
   * Latest attempt for a reference name, optionally scoped to a loop
   * iteration. When `iteration` is null (top-level walk) the latest record
   * across all iterations is returned.
   */
  _latestForRef(ref, iteration) {
    let latest = null;
    for (const t of this.wf.tasks || []) {
      if (t.referenceTaskName !== ref) continue;
      if (iteration != null && t.iteration !== iteration) continue;
      if (!latest || (t.seq ?? 0) >= (latest.seq ?? 0)) latest = t;
    }
    return latest;
  }
  // ---- helpers ----------------------------------------------------------
  _addRecord(td, { type, status, inputData = {}, outputData = {}, seq = 0, iteration = null, dynamic = false }) {
    const rec = createTaskRecord(this.wf, this.def, td, inputData, {
      resolvedType: type,
      taskDefName: td.name,
      seq,
      iteration,
      dynamic
    });
    rec.status = status;
    rec.outputData = outputData;
    if (status === TaskStatus.COMPLETED || status === TaskStatus.COMPLETED_WITH_ERRORS) {
      rec.startTime = Date.now();
      rec.endTime = Date.now();
    }
    this.wf.tasks.push(rec);
    this.result.progress = true;
    return rec;
  }
  _leaf(taskDef, inputData, iteration = null, dynamic = false) {
    this.result.tasks.push({ taskDef, inputData, iteration, dynamic });
  }
  _resolvedType(td) {
    if (td.type === TaskType.FORK) return TaskType.FORK_JOIN;
    if (td.type === TaskType.DECISION) return TaskType.SWITCH;
    return td.type;
  }
  _inputFor(td, iteration = null) {
    const root = this._ctx();
    if (td.inputExpression) {
      const expr = typeof td.inputExpression === "string" ? td.inputExpression : td.inputExpression.expression;
      return jsonPath(root, expr) ?? {};
    }
    const base = { ...td.inputTemplate || {}, ...td.inputParameters || {} };
    return substitute(base, root);
  }
  // ---- walk -------------------------------------------------------------
  _walk(segment, iteration) {
    for (const td of segment) {
      const r = this._process(td, iteration);
      if (r === "blocked" || r === "terminate") return false;
    }
    return true;
  }
  _process(td, iteration) {
    const type = this._resolvedType(td);
    const ref = td.taskReferenceName;
    const existing = this._latestForRef(ref, iteration);
    if (!existing) return this._start(td, type, iteration);
    if (existing.status === TaskStatus.COMPLETED || existing.status === TaskStatus.COMPLETED_WITH_ERRORS) {
      return "done";
    }
    if (existing.status === TaskStatus.SKIPPED || existing.status === TaskStatus.FAILED || existing.status === TaskStatus.FAILED_WITH_TERMINAL_ERROR || existing.status === TaskStatus.TIMED_OUT || existing.status === TaskStatus.CANCELED) {
      return "blocked";
    }
    if (this._isContainer(type)) {
      return this._advanceContainer(td, type, existing, iteration);
    }
    return "blocked";
  }
  _isContainer(type) {
    return type === TaskType.SWITCH || type === TaskType.DO_WHILE || type === TaskType.SUB_WORKFLOW || type === TaskType.DYNAMIC_FORK;
  }
  // ---- start (no existing record) --------------------------------------
  _start(td, type, iteration) {
    switch (type) {
      case TaskType.SET_VARIABLE:
        return this._startSetVariable(td, iteration);
      case TaskType.TERMINATE:
        return this._startTerminate(td, iteration);
      case TaskType.FORK_JOIN:
        return this._startFork(td, iteration);
      case TaskType.JOIN:
      case TaskType.EXCLUSIVE_JOIN:
        return this._startJoin(td, type, iteration);
      case TaskType.SWITCH:
        return this._startSwitch(td, iteration);
      case TaskType.DO_WHILE:
        return this._startDoWhile(td, iteration);
      case TaskType.SUB_WORKFLOW:
        return this._startSubWorkflow(td, iteration);
      case TaskType.START_WORKFLOW:
        return this._startStartWorkflow(td, iteration);
      case TaskType.DYNAMIC:
        return this._startDynamic(td, iteration);
      case TaskType.DYNAMIC_FORK:
        return this._startDynamicFork(td, iteration);
      default:
        this._leaf(td, this._inputFor(td, iteration), iteration);
        return "blocked";
    }
  }
  _startSetVariable(td, iteration) {
    const vars = this._inputFor(td, iteration);
    this.wf.variables = { ...this.wf.variables || {}, ...vars || {} };
    this._addRecord(td, { type: TaskType.SET_VARIABLE, status: TaskStatus.COMPLETED, inputData: vars, outputData: vars, iteration });
    return "continue";
  }
  _startTerminate(td, iteration) {
    const input = this._inputFor(td, iteration);
    const status = input.terminationStatus || "COMPLETED";
    const output = input.workflowOutput != null ? input.workflowOutput : void 0;
    const reason = input.terminationReason || "";
    this._addRecord(td, { type: TaskType.TERMINATE, status: TaskStatus.COMPLETED, inputData: input, outputData: input, iteration });
    this.result.terminates = { status, output, reason };
    return "terminate";
  }
  _startFork(td, iteration) {
    const branches = td.forkTasks || [];
    const joinOn = branches.map((branch) => {
      if (!branch || branch.length === 0) return null;
      const last = branch[branch.length - 1];
      return last.taskReferenceName;
    }).filter(Boolean);
    this.wf.deciderState.forkStack = this.wf.deciderState.forkStack || [];
    this.wf.deciderState.forkStack.push(joinOn);
    this._addRecord(td, { type: TaskType.FORK_JOIN, status: TaskStatus.COMPLETED, iteration });
    for (const branch of branches) {
      this._walk(branch || [], iteration);
    }
    return "continue";
  }
  _startJoin(td, type, iteration) {
    let joinOn = (td.joinOn || []).slice();
    if (joinOn.length === 0) {
      const stack2 = this.wf.deciderState.forkStack || [];
      if (stack2.length) {
        joinOn = stack2[stack2.length - 1].slice();
      }
    }
    this.wf.deciderState.joinOn = this.wf.deciderState.joinOn || {};
    this.wf.deciderState.joinOn[td.taskReferenceName] = joinOn;
    const any = type === TaskType.EXCLUSIVE_JOIN;
    const done = joinOn.length > 0 && (any ? joinOn.some((ref) => this._refCompleted(ref, iteration)) : joinOn.every((ref) => this._refCompleted(ref, iteration)));
    if (!done) return "blocked";
    const output = {};
    for (const ref of joinOn) {
      const t = this._latestForRef(ref, iteration);
      if (t) output[ref] = t.outputData;
    }
    this._addRecord(td, { type, status: TaskStatus.COMPLETED, outputData: output, iteration });
    const stack = this.wf.deciderState.forkStack || [];
    if (stack.length) stack.pop();
    return "continue";
  }
  _refCompleted(ref, iteration) {
    const t = this._latestForRef(ref, iteration);
    if (!t) return false;
    return t.status === TaskStatus.COMPLETED || t.status === TaskStatus.COMPLETED_WITH_ERRORS || t.status === TaskStatus.SKIPPED;
  }
  _startSwitch(td, iteration) {
    const evaluatorType = td.evaluatorType || "value-param";
    let caseKey = null;
    if (evaluatorType === "javascript") {
      const expression = td.expression || "";
      const value = this._evalJs(expression);
      caseKey = value ? "true" : "false";
    } else {
      const value = evaluateSwitchCase(
        this.wf,
        td,
        td.inputParameters?.switchCaseValue,
        td.inputParameters?.switchCaseExpression
      );
      caseKey = String(value);
    }
    const cases = td.decisionCases || {};
    let chosen = null;
    if (Object.prototype.hasOwnProperty.call(cases, caseKey)) chosen = cases[caseKey];
    else if (td.defaultCase) chosen = td.defaultCase;
    this.wf.deciderState.switches = this.wf.deciderState.switches || {};
    this.wf.deciderState.switches[td.taskReferenceName] = { caseKey, list: chosen || [] };
    this._addRecord(td, { type: TaskType.SWITCH, status: TaskStatus.IN_PROGRESS, inputData: { caseValue: caseKey }, iteration });
    if (!chosen || chosen.length === 0) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      return "continue";
    }
    this._walk(chosen, iteration);
    return "blocked";
  }
  _startDoWhile(td, iteration) {
    this.wf.deciderState.doWhile = this.wf.deciderState.doWhile || {};
    this.wf.deciderState.doWhile[td.taskReferenceName] = { iteration: 0 };
    this._addRecord(td, { type: TaskType.DO_WHILE, status: TaskStatus.IN_PROGRESS, iteration });
    const loopOver = td.loopOver || [];
    if (loopOver.length === 0) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      return "continue";
    }
    this._walk(loopOver, 0);
    return "blocked";
  }
  _startSubWorkflow(td, iteration) {
    const input = this._inputFor(td, iteration);
    const sub = td.subWorkflowParam || {};
    const name = sub.name;
    const version = sub.version;
    this._addRecord(td, { type: TaskType.SUB_WORKFLOW, status: TaskStatus.IN_PROGRESS, inputData: input, iteration });
    this.result.subworkflows.push({
      taskDef: td,
      inputData: input,
      name,
      version,
      correlationId: sub.correlationId,
      idempotencyKey: sub.idempotencyKey,
      idempotencyStrategy: sub.idempotencyStrategy
    });
    return "blocked";
  }
  _startStartWorkflow(td, iteration) {
    const input = this._inputFor(td, iteration);
    const spec = input.startWorkflow || {};
    this._addRecord(td, { type: TaskType.START_WORKFLOW, status: TaskStatus.IN_PROGRESS, inputData: input, iteration });
    this.result.subworkflows.push({
      taskDef: td,
      inputData: spec.input || {},
      name: spec.name,
      version: spec.version,
      correlationId: spec.correlationId,
      idempotencyKey: spec.idempotencyKey,
      idempotencyStrategy: spec.idempotencyStrategy,
      fireAndForget: true
    });
    return "blocked";
  }
  _startDynamic(td, iteration) {
    const input = this._inputFor(td, iteration);
    const nameParam = td.dynamicTaskNameParam || "taskToExecute";
    const taskName = input[nameParam] || td.dynamicTaskName;
    if (!taskName) {
      this._addRecord(td, { type: TaskType.DYNAMIC, status: TaskStatus.COMPLETED, outputData: input, iteration });
      return "continue";
    }
    const taskDef = this.server.getTaskDefSync(taskName) || { name: taskName, type: TaskType.SIMPLE };
    const resolvedType = taskDef.type || TaskType.SIMPLE;
    this.wf.deciderState.dynamics = this.wf.deciderState.dynamics || {};
    this.wf.deciderState.dynamics[td.taskReferenceName] = { taskName, resolvedType };
    const dynamicInput = { ...input };
    delete dynamicInput[nameParam];
    this.result.tasks.push({
      taskDef: { ...td, type: resolvedType },
      taskDefName: taskName,
      inputData: dynamicInput,
      iteration,
      dynamic: true
    });
    return "blocked";
  }
  _startDynamicFork(td, iteration) {
    const input = this._inputFor(td, iteration);
    const tasksParam = td.dynamicForkTasksParam || "dynamicTasks";
    const inputParam = td.dynamicForkTasksInputParamName || "dynamicTasksInput";
    const taskSpecs = input[tasksParam] || [];
    const inputs = input[inputParam] || [];
    this._addRecord(td, { type: TaskType.DYNAMIC_FORK, status: TaskStatus.IN_PROGRESS, inputData: input, iteration });
    this.wf.deciderState.dynamicForks = this.wf.deciderState.dynamicForks || {};
    const childRefs = [];
    taskSpecs.forEach((spec, i) => {
      const childRef = `${td.taskReferenceName}__${i}`;
      childRefs.push(childRef);
      const childTaskDef = {
        name: spec.taskName || spec.name,
        taskReferenceName: childRef,
        type: spec.type || TaskType.SIMPLE,
        inputParameters: spec.inputParameters
      };
      this.result.tasks.push({
        taskDef: childTaskDef,
        taskDefName: childTaskDef.name,
        inputData: inputs[i] || {},
        iteration,
        dynamic: true
      });
    });
    this.wf.deciderState.dynamicForks[td.taskReferenceName] = { childRefs };
    return "blocked";
  }
  // ---- advance containers ----------------------------------------------
  _advanceContainer(td, type, existing, iteration) {
    switch (type) {
      case TaskType.SWITCH:
        return this._advanceSwitch(td, iteration);
      case TaskType.DO_WHILE:
        return this._advanceDoWhile(td, iteration);
      case TaskType.DYNAMIC_FORK:
        return this._advanceDynamicFork(td, iteration);
      default:
        return "blocked";
    }
  }
  _advanceSwitch(td, iteration) {
    const info = (this.wf.deciderState.switches || {})[td.taskReferenceName];
    const chosen = info ? info.list : [];
    if (chosen.length === 0) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      return "continue";
    }
    const done = this._walk(chosen, iteration);
    if (done) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      this.result.progress = true;
      return "continue";
    }
    return "blocked";
  }
  _advanceDoWhile(td, iteration) {
    const state = (this.wf.deciderState.doWhile || {})[td.taskReferenceName];
    if (!state) return "blocked";
    const loopOver = td.loopOver || [];
    const current = state.iteration;
    const done = loopOver.every((inner) => this._loopIterationDone(inner.taskReferenceName, current));
    if (!done) {
      this._walk(loopOver, current);
      return "blocked";
    }
    const shouldLoop = this._evaluateLoopCondition(td, loopOver, current);
    if (shouldLoop) {
      state.iteration = current + 1;
      this._walk(loopOver, state.iteration);
      return "blocked";
    }
    const rec = this._latestForRef(td.taskReferenceName, iteration);
    if (rec) rec.status = TaskStatus.COMPLETED;
    this.result.progress = true;
    return "continue";
  }
  _loopIterationDone(ref, iteration) {
    const records = (this.wf.tasks || []).filter((t) => t.referenceTaskName === ref && t.iteration === iteration);
    if (records.length === 0) return false;
    return records.some((t) => isTerminalTask(t.status) && t.status !== TaskStatus.FAILED && t.status !== TaskStatus.FAILED_WITH_TERMINAL_ERROR);
  }
  _evaluateLoopCondition(td, loopOver, iteration) {
    const cond = td.loopCondition;
    if (!cond) return false;
    const scope = {};
    for (const inner of loopOver) {
      const rec = this._latestForRef(inner.taskReferenceName, iteration);
      scope[inner.taskReferenceName] = { input: rec ? rec.inputData : {}, output: rec ? rec.outputData : {} };
    }
    const substituted = substitute(cond, { workflow: this._ctx().workflow, ...scope });
    if (typeof substituted === "boolean") return substituted;
    const fn = new Function("$", `"use strict"; return (${cond});`);
    return !!fn(scope);
  }
  _advanceDynamicFork(td, iteration) {
    const info = (this.wf.deciderState.dynamicForks || {})[td.taskReferenceName];
    if (!info) return "blocked";
    const allDone = info.childRefs.every((ref) => this._refCompleted(ref, iteration));
    if (!allDone) return "blocked";
    const rec = this._latestForRef(td.taskReferenceName, iteration);
    if (rec) rec.status = TaskStatus.COMPLETED;
    this.result.progress = true;
    return "continue";
  }
  // ---- misc -------------------------------------------------------------
  _evalJs(expression) {
    const root = this._ctx();
    const fn = new Function("input", "workflow", `"use strict"; return (${expression});`);
    return fn(root.workflow.input, root.workflow);
  }
};

// src/engine/system-tasks.js
function isInlineSystemTask(type) {
  return type === TaskType.NOOP || type === TaskType.INLINE || type === TaskType.EVENT || type === TaskType.JSON_JQ_TRANSFORM;
}
function isAsyncSystemTask(type) {
  return type === TaskType.HTTP;
}
function executeNoop(inputData) {
  return cloneInput(inputData);
}
function executeInline(inputData, taskDef) {
  const expression = taskDef.expression || taskDef.inputParameters?.expression || "";
  const evaluatorType = taskDef.evaluatorType || "javascript";
  if (evaluatorType !== "javascript") {
    throw new Error(`Unsupported INLINE evaluator type: ${evaluatorType}`);
  }
  const fn = new Function("input", "$", `"use strict"; return (function(){ ${expression}
})();`);
  const result = fn(inputData, inputData);
  return { result, ...cloneInput(inputData) };
}
function executeJsonJq(inputData, taskDef) {
  const query = taskDef.queryExpression || taskDef.inputParameters?.queryExpression;
  const source = inputData;
  if (!query) return cloneInput(source);
  if (query.trim().startsWith(".")) {
    return { result: jsonPath(source, query.trim()) };
  }
  if (query.trim() === ".") return { result: source };
  return { result: query };
}
function executeEvent(inputData, taskDef, { publish }) {
  const action = taskDef.inputParameters?.action || inputData.action || "complete_task";
  const event = taskDef.inputParameters?.event || inputData.event;
  if (publish) publish({ action, event, payload: inputData });
  return { action, ...cloneInput(inputData) };
}
async function executeHttp(inputData, taskDef) {
  const input = inputData || {};
  const req = input.http_request || input;
  const uri = req.uri || req.url;
  if (!uri) throw new Error("HTTP task missing uri");
  const method = (req.method || "GET").toUpperCase();
  const headers = req.headers || {};
  const body = req.body != null ? req.body : input.body;
  const options = { method, headers: { ...headers } };
  let rawBody = null;
  if (body != null && method !== "GET" && method !== "HEAD") {
    if (typeof body === "string") {
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
      if (!options.headers["Content-Type"] && !options.headers["content-type"]) {
        options.headers["Content-Type"] = "application/json";
      }
    }
    rawBody = options.body;
  }
  const started = Date.now();
  let response;
  let error;
  try {
    response = await fetch(uri, options);
  } catch (e) {
    error = e;
  }
  if (error) {
    throw new Error(`HTTP task failed: ${error.message}`);
  }
  const text2 = await response.text();
  let jsonBody = text2;
  try {
    jsonBody = text2 ? JSON.parse(text2) : null;
  } catch {
  }
  return {
    response: {
      statusCode: response.status,
      headers: headersFromResponse(response),
      body: jsonBody,
      reason: response.statusText
    },
    statusCode: response.status,
    reason: response.statusText,
    body: jsonBody,
    headers: headersFromResponse(response),
    timeTakenMs: Date.now() - started
  };
}
function headersFromResponse(response) {
  const out = {};
  if (!response.headers || !response.headers.forEach) return out;
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
function cloneInput(value) {
  if (value === void 0) return {};
  return JSON.parse(JSON.stringify(value));
}

// src/errors.js
var ConductorError = class extends Error {
  constructor(message, { status = 500, code = null, details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
};
var NotFoundError = class extends ConductorError {
  constructor(message, details) {
    super(message, { status: 404, details });
  }
};
var ConflictError = class extends ConductorError {
  constructor(message, details) {
    super(message, { status: 409, details });
  }
};
var BadRequestError = class extends ConductorError {
  constructor(message, details) {
    super(message, { status: 400, details });
  }
};
var ApplicationException = class extends Error {
  constructor(message, { type = "ApplicationException", details = null, status = 500 } = {}) {
    super(message);
    this.name = type;
    this.details = details;
    this.status = status;
  }
};

// src/engine/server.js
var MAX_DECIDE_STEPS = 1e4;
var ConductorServer = class {
  constructor({
    store,
    logger = null,
    sweeperIntervalMs = 500,
    workflowMessageQueueEnabled = false,
    now = () => Date.now()
  } = {}) {
    this.store = store;
    this.logger = logger || console;
    this.sweeperIntervalMs = sweeperIntervalMs;
    this.workflowMessageQueueEnabled = workflowMessageQueueEnabled;
    this.now = now;
    this.decider = new Decider(this);
    this._tasks = /* @__PURE__ */ new Map();
    this._queues = /* @__PURE__ */ new Map();
    this._delayed = [];
    this._inlineDefs = /* @__PURE__ */ new Map();
    this._eventHandlers = /* @__PURE__ */ new Map();
    this._taskDefCache = /* @__PURE__ */ new Map();
    this._sweeper = null;
    this._subscribers = /* @__PURE__ */ new Set();
    this._deciding = /* @__PURE__ */ new Set();
    this._pendingDecide = /* @__PURE__ */ new Set();
    this._idempotencyIndex = /* @__PURE__ */ new Map();
  }
  async init() {
    await this.store.init();
    await this.reload();
    this._startSweeper();
  }
  /**
   * Re-read persisted state from the store and rebuild all in-memory indexes.
   * Used on boot and by the control plane to pick up changes made by other
   * tabs sharing the same storage.
   */
  async reload() {
    if (typeof this.store.reload === "function") await this.store.reload();
    this._tasks.clear();
    this._queues.clear();
    this._delayed = [];
    this._idempotencyIndex.clear();
    this._taskDefCache.clear();
    this._eventHandlers.clear();
    const workflows = await this.store.list("workflows");
    for (const wf of workflows) {
      for (const t of wf.tasks || []) {
        this._indexTask(t);
      }
      if (wf.idempotencyKey) this._indexIdempotencyKey(wf);
    }
    const handlers2 = await this.store.list("eventHandlers");
    for (const h of handlers2) this._eventHandlers.set(h.name, h);
    const taskDefs = await this.store.list("taskDefs");
    for (const td of taskDefs) this._taskDefCache.set(td.name, td);
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
      }
    }
  }
  // ---- metadata: workflow definitions ----------------------------------
  async registerWorkflowDef(def, overwrite = false) {
    const normalized = normalizeWorkflowDef(def);
    this.validateWorkflowDef(normalized);
    const key = taskDefKey(normalized.name, normalized.version);
    const existing = await this.store.get("workflowDefs", key);
    if (existing && !overwrite) {
    }
    await this.store.put("workflowDefs", key, normalized);
    this._emit("workflowDef.registered", { name: normalized.name, version: normalized.version });
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
      const fromStore = await this.store.get("workflowDefs", key);
      if (fromStore) return fromStore;
      return this._inlineDefs.get(key);
    }
    const all = await this.getAllWorkflowDefs();
    let latest = null;
    for (const d of all) {
      if (d.name !== name) continue;
      if (!latest || d.version > latest.version) latest = d;
    }
    if (latest) return latest;
    let best = null;
    for (const [key, d] of this._inlineDefs.entries()) {
      if (d.name !== name) continue;
      if (!best || d.version > best.version) best = d;
    }
    return best;
  }
  async getAllWorkflowDefs() {
    const defs = await this.store.list("workflowDefs");
    defs.sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version);
    return defs;
  }
  async deleteWorkflowDef(name, version) {
    await this.store.delete("workflowDefs", taskDefKey(name, version));
    this._inlineDefs.delete(taskDefKey(name, version));
  }
  async getWorkflowDefsNamesAndVersions() {
    var _a;
    const defs = await this.getAllWorkflowDefs();
    const map = {};
    for (const d of defs) {
      (map[_a = d.name] || (map[_a] = [])).push({ name: d.name, version: d.version });
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
    if (!def) throw new ApplicationException("Workflow definition is required");
    if (!def.name) throw new ApplicationException('Workflow definition is missing "name"');
    if (def.version == null) throw new ApplicationException('Workflow definition is missing "version"');
    if (!Array.isArray(def.tasks)) throw new ApplicationException('Workflow definition "tasks" must be an array');
    return true;
  }
  // ---- metadata: task definitions --------------------------------------
  async registerTaskDefs(defs) {
    for (const def of defs || []) {
      const normalized = normalizeTaskDef(def);
      if (!normalized) throw new ApplicationException("Task definition missing name");
      await this.store.put("taskDefs", normalized.name, normalized);
      this._taskDefCache.set(normalized.name, normalized);
      this._emit("taskDef.registered", { name: normalized.name });
    }
  }
  async updateTaskDef(def) {
    const normalized = normalizeTaskDef(def);
    if (!normalized) throw new ApplicationException("Task definition missing name");
    await this.store.put("taskDefs", normalized.name, normalized);
    this._taskDefCache.set(normalized.name, normalized);
    return normalized;
  }
  async getTaskDef(name) {
    return this.store.get("taskDefs", name);
  }
  getTaskDefSync(name) {
    return this._taskDefCache.get(name);
  }
  async getAllTaskDefs() {
    return this.store.list("taskDefs");
  }
  async deleteTaskDef(name) {
    await this.store.delete("taskDefs", name);
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
      if (!request.name) throw new ApplicationException("Workflow name is required", { status: 400 });
      def = await this.getWorkflowDef(request.name, request.version);
      if (!def) throw new ApplicationException(`No workflow defined with name ${request.name}, version ${request.version ?? "latest"}`, { status: 404 });
    }
    const wf = createWorkflowInstance(def, request);
    if (request.idempotencyKey) {
      const existing = await this._acquireIdempotency(
        def.name,
        request.idempotencyKey,
        request.idempotencyStrategy,
        wf.workflowId
      );
      if (existing) return existing;
    }
    try {
      await this.store.put("workflows", wf.workflowId, wf);
    } catch (e) {
      if (request.idempotencyKey) this._unindexIdempotencyKey(wf);
      throw e;
    }
    this._emit("workflow.started", { workflowId: wf.workflowId, name: wf.workflowName });
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
   * Atomically check-and-reserve an idempotency key. Returns the id of an
   * existing workflow for RETURN_EXISTING, or null when the caller should
   * proceed (the key has been reserved for the supplied new workflow id).
   * Throws ConflictError (409) for FAIL / FAIL_ON_RUNNING conflicts.
   *
   * The entire body is synchronous (no `await`): in a single-threaded runtime
   * this makes check-and-reserve one atomic block, mirroring Conductor OSS's
   * `executionLockService` held across check-and-create. Statuses are read via
   * `store.getSync`, so `FAIL_ON_RUNNING` never awaits between deciding and
   * reserving.
   */
  async _acquireIdempotency(name, idempotencyKey, idempotencyStrategy, workflowId) {
    const strategy = idempotencyStrategy || IdempotencyStrategy.FAIL;
    if (![IdempotencyStrategy.FAIL, IdempotencyStrategy.RETURN_EXISTING, IdempotencyStrategy.FAIL_ON_RUNNING].includes(strategy)) {
      throw new BadRequestError(`Invalid idempotencyStrategy: ${idempotencyStrategy}`);
    }
    const mapKey = this._idempotencyKey(name, idempotencyKey);
    const ids = this._idempotencyIndex.get(mapKey) || [];
    if (strategy === IdempotencyStrategy.RETURN_EXISTING) {
      if (ids.length) return ids[0];
    } else if (strategy === IdempotencyStrategy.FAIL) {
      if (ids.length) {
        throw new ConflictError(
          `Workflow with idempotencyKey '${idempotencyKey}' is already running or completed`
        );
      }
    } else {
      for (const id of ids) {
        const wf = this.store.getSync("workflows", id);
        if (!wf || wf.status === WorkflowStatus.RUNNING || wf.status === WorkflowStatus.PAUSED) {
          throw new ConflictError(
            `Workflow with idempotencyKey '${idempotencyKey}' is already running`
          );
        }
      }
    }
    const current = this._idempotencyIndex.get(mapKey) || [];
    if (!current.includes(workflowId)) current.push(workflowId);
    this._idempotencyIndex.set(mapKey, current);
    return null;
  }
  async executeWorkflow(request, { waitForSeconds = 10, waitUntilTaskRef = null } = {}) {
    const workflowId = await this.startWorkflow(request);
    const deadline = this.now() + waitForSeconds * 1e3;
    const waitRefs = waitUntilTaskRef ? String(waitUntilTaskRef).split(",").map((s) => s.trim()).filter(Boolean) : [];
    return this._waitFor(workflowId, deadline, waitRefs);
  }
  async _waitFor(workflowId, deadline, waitRefs) {
    while (this.now() < deadline) {
      const wf = await this.store.get("workflows", workflowId);
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
    return this.store.get("workflows", workflowId);
  }
  // ---- retrieve workflows ----------------------------------------------
  async getWorkflow(id, includeTasks = true) {
    const wf = await this.store.get("workflows", id);
    if (!wf) return null;
    if (includeTasks === false) {
      const { tasks, ...rest } = wf;
      return rest;
    }
    return wf;
  }
  async getWorkflowStatus(id, { includeOutput = false, includeVariables = false } = {}) {
    const wf = await this.store.get("workflows", id);
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
      output: includeOutput ? wf.output : void 0,
      variables: includeVariables ? wf.variables : void 0
    };
  }
  async getTasksForWorkflow(id, { start = 0, count = 15, status = null } = {}) {
    const wf = await this.store.get("workflows", id);
    if (!wf) return null;
    let tasks = [...wf.tasks || []].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    if (status) {
      const statuses = String(status).split(",");
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }
    const totalHits = tasks.length;
    return { totalHits, results: tasks.slice(start, start + count) };
  }
  async getRunningWorkflows(name, version = 1, startTime = null, endTime = null) {
    const workflows = await this.store.list("workflows");
    return workflows.filter((w) => {
      if (w.workflowName !== name) return false;
      if (version && w.workflowVersion !== Number(version)) return false;
      if (w.status !== WorkflowStatus.RUNNING) return false;
      if (startTime && w.startTime < Number(startTime)) return false;
      if (endTime && w.startTime > Number(endTime)) return false;
      return true;
    }).map((w) => w.workflowId);
  }
  async getWorkflowsByCorrelationId(name, correlationId, includeClosed = false, includeTasks = false) {
    const workflows = await this.store.list("workflows");
    const matches = workflows.filter(
      (w) => w.workflowName === name && w.correlationId === correlationId && (includeClosed || w.status === WorkflowStatus.RUNNING)
    );
    return matches.map((w) => includeTasks ? w : this._withoutTasks(w));
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
    const wf = await this.store.get("workflows", id);
    if (!wf) return null;
    if (wf.status === WorkflowStatus.RUNNING) {
      wf.status = WorkflowStatus.PAUSED;
      wf.updateTime = this.now();
      await this._saveWorkflow(wf);
    }
    return wf;
  }
  async resume(id) {
    const wf = await this.store.get("workflows", id);
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
    const wf = await this.store.get("workflows", id);
    if (!wf) return null;
    wf.status = WorkflowStatus.RUNNING;
    wf.reasonForIncompletion = "";
    wf.failedReferenceTaskNames = [];
    wf.lastRetriedTime = this.now();
    const failed = [...wf.tasks || []].filter((t) => t.status === TaskStatus.FAILED || t.status === TaskStatus.FAILED_WITH_TERMINAL_ERROR).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0))[0];
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
    const wf = await this.store.get("workflows", id);
    if (!wf) return null;
    let def = await this.getWorkflowDef(wf.workflowName, useLatestDefinitions ? void 0 : wf.workflowVersion);
    if (!def) return null;
    for (const t of wf.tasks || []) this._tasks.delete(t.taskId);
    wf.tasks = [];
    wf.status = WorkflowStatus.RUNNING;
    wf.startTime = this.now();
    wf.endTime = 0;
    wf.output = {};
    wf.reasonForIncompletion = "";
    wf.failedReferenceTaskNames = [];
    wf.failedTaskNames = [];
    wf.deciderState = {};
    if (useLatestDefinitions) wf.workflowVersion = def.version;
    await this._saveWorkflow(wf);
    await this._decide(id);
    return wf;
  }
  async rerun(id, body) {
    const wf = await this.store.get("workflows", id);
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
    wf.reasonForIncompletion = "";
    wf.deciderState = {};
    if (reRunFromTaskId) {
      const src = await this.store.get("workflows", reRunFromWorkflowId);
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
    const wf = await this.store.get("workflows", id);
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
  async terminate(id, reason = "") {
    const wf = await this.store.get("workflows", id);
    if (!wf) return null;
    if (!isTerminalWorkflow(wf.status)) {
      wf.status = WorkflowStatus.TERMINATED;
      wf.reasonForIncompletion = reason || "Workflow terminated";
      wf.endTime = this.now();
      wf.updateTime = this.now();
      for (const t of wf.tasks || []) {
        if (t.status === TaskStatus.SCHEDULED || t.status === TaskStatus.IN_PROGRESS) {
          t.status = TaskStatus.CANCELED;
        }
      }
      await this._saveWorkflow(wf);
      this._removeFromQueues(wf);
      this._emit("workflow.terminated", { workflowId: id });
    }
    return wf;
  }
  async remove(id, { archiveWorkflow = true } = {}) {
    const wf = await this.store.get("workflows", id);
    if (wf) {
      for (const t of wf.tasks || []) this._tasks.delete(t.taskId);
      this._removeFromQueues(wf);
      if (wf.idempotencyKey) this._unindexIdempotencyKey(wf);
      await this.store.delete("workflows", id);
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
      const task2 = this._tasks.get(queue[i]);
      if (!task2) continue;
      if (domain && task2.domain && task2.domain !== domain) continue;
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
    const wf = await this.store.get("workflows", workflowId);
    if (!wf) throw new ApplicationException(`No workflow found with id ${workflowId}`, { status: 404 });
    const task = latestTaskForRef(wf, taskRefName);
    if (!task) throw new ApplicationException(`No task found with reference name ${taskRefName}`, { status: 404 });
    await this._applyTaskResult(task, {
      workflowInstanceId: workflowId,
      taskId: task.taskId,
      status,
      outputData: output,
      workerId
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
    const wfs = await this.store.list("workflows");
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
    let wfs = await this.store.list("workflows");
    const summary = (w) => ({
      workflowType: w.workflowName,
      version: w.workflowVersion,
      status: w.status,
      startTime: w.startTime,
      endTime: w.endTime,
      correlationId: w.correlationId,
      workflowId: w.workflowId
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
      endTime: w.endTime ? new Date(w.endTime).toISOString() : void 0,
      status: w.status,
      executionTime: w.endTime ? w.endTime - w.startTime : 0,
      input: w.input,
      output: w.output
    };
  }
  // ---- event handlers ---------------------------------------------------
  async registerEventHandler(handler) {
    const name = handler.name;
    await this.store.put("eventHandlers", name, handler);
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
    await this.store.delete("eventHandlers", name);
    this._eventHandlers.delete(name);
  }
  async publishEvent(event) {
    const actions = [];
    for (const handler of this._eventHandlers.values()) {
      const matches = handler.event === event.name || handler.event === "*";
      if (!matches) continue;
      for (const action of handler.actions || []) {
        actions.push(await this._runEventAction(action, event, handler));
      }
    }
    return actions;
  }
  async _runEventAction(action, event, handler) {
    switch (action.action) {
      case "start_workflow": {
        const spec = action.start_workflow || {};
        const workflowId = await this.startWorkflow({
          name: spec.name,
          version: spec.version,
          input: { ...spec.input, event }
        });
        return { action: "start_workflow", workflowId };
      }
      case "complete_task": {
        const spec = action.complete_task || {};
        const workflowId = spec.workflowId || event && event.workflowId;
        const taskRef = spec.taskRefName;
        if (!workflowId || !taskRef) return { action: "complete_task", skipped: true };
        await this.updateTaskByRef(workflowId, taskRef, TaskStatus.COMPLETED, event.payload || {});
        return { action: "complete_task", workflowId, taskRefName: taskRef };
      }
      case "fail_task": {
        const spec = action.fail_task || {};
        const workflowId = spec.workflowId || event && event.workflowId;
        const taskRef = spec.taskRefName;
        if (!workflowId || !taskRef) return { action: "fail_task", skipped: true };
        await this.updateTaskByRef(workflowId, taskRef, TaskStatus.FAILED, {}, "event");
        return { action: "fail_task", workflowId, taskRefName: taskRef };
      }
      default:
        return { action: action.action, ignored: true };
    }
  }
  // ---- internal: decider / scheduling -----------------------------------
  _startSweeper() {
    if (this._sweeper || !this.sweeperIntervalMs) return;
    this._sweeper = setInterval(() => {
      this._sweep().catch((e) => this.logger.warn("[in-browser-conductor] sweep error", e));
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
    const workflows = await this.store.list("workflows");
    for (const wf of workflows) {
      if (wf.status !== WorkflowStatus.RUNNING && wf.status !== WorkflowStatus.PAUSED) continue;
      const def = await this.getWorkflowDef(wf.workflowName, wf.workflowVersion);
      if (!def) continue;
      if (def.timeoutSeconds > 0 && wf.startTime && now - wf.startTime > def.timeoutSeconds * 1e3) {
        if (def.timeoutPolicy !== TimeoutPolicy.ALERT_ONLY) {
          await this._failWorkflow(wf, null, "Workflow timed out");
          continue;
        }
      }
      for (const task of wf.tasks || []) {
        if (task.status !== TaskStatus.IN_PROGRESS) continue;
        const taskDef = await this.getTaskDef(task.taskDefName) || {};
        const timeoutSeconds = taskDef.timeoutSeconds || 0;
        if (timeoutSeconds > 0 && task.startTime && now - task.startTime > timeoutSeconds * 1e3) {
          await this._handleTaskTimeout(wf, task, taskDef, def);
        }
      }
    }
  }
  async _handleTaskTimeout(wf, task, taskDef, wfDef) {
    if (task.optional) {
      task.status = TaskStatus.COMPLETED_WITH_ERRORS;
      task.reasonForIncompletion = "Task timed out";
      task.endTime = this.now();
      task.updateTime = this.now();
      await this._saveTask(task);
      await this._decide(wf.workflowId);
      return;
    }
    const policy = taskDef.timeoutPolicy || TimeoutPolicy.TIME_OUT_WF;
    if (policy === TimeoutPolicy.RETRY) {
      const maxRetries = taskDef.retryCount != null ? taskDef.retryCount : 0;
      if (task.type !== TaskType.WAIT && (task.retryCount || 0) < maxRetries) {
        task.status = TaskStatus.TIMED_OUT;
        task.reasonForIncompletion = "Task timed out";
        task.endTime = this.now();
        await this._saveTask(task);
        await this._maybeRetry(wf, task, taskDef);
      } else {
        task.status = TaskStatus.TIMED_OUT;
        task.reasonForIncompletion = "Task timed out";
        await this._saveTask(task);
        await this._failWorkflow(wf, task, "Task timed out");
      }
    } else if (policy === TimeoutPolicy.TIME_OUT_WF) {
      task.status = TaskStatus.TIMED_OUT;
      task.reasonForIncompletion = "Task timed out";
      await this._saveTask(task);
      await this._failWorkflow(wf, task, "Task timed out");
    } else {
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
        await this._decide(workflowId);
      }
    }
  }
  async _decideImpl(workflowId) {
    for (let step = 0; step < MAX_DECIDE_STEPS; step++) {
      const wf = await this.store.get("workflows", workflowId);
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
    this.logger.warn("[in-browser-conductor] decide exceeded step limit", workflowId);
  }
  async _scheduleLeaf(wf, scheduled) {
    const { taskDef, taskDefName, inputData, iteration, dynamic } = scheduled;
    const type = taskDef.type;
    const rec = createTaskRecord(wf, this.decider.def, taskDef, inputData, {
      resolvedType: type,
      taskDefName: taskDefName || taskDef.name,
      iteration,
      dynamic
    });
    rec.domain = this._domainFor(wf, taskDef.taskReferenceName);
    wf.tasks.push(rec);
    this._tasks.set(rec.taskId, rec);
    if (type === TaskType.WAIT) {
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
      this._executeAsyncSystemTask(wf, rec, taskDef).catch((e) => this.logger.warn("[in-browser-conductor] async task error", e));
      return;
    }
    this._enqueue(rec);
    await this._saveWorkflow(wf);
  }
  _domainFor(wf, taskRef) {
    const map = wf.taskToDomain || {};
    return map[taskRef] || map["*"] || null;
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
            publish: (e) => this.publishEvent({ name: e.event, payload: e.payload })
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
      this._emit("task.completed", { workflowId: wf.workflowId, taskId: rec.taskId, taskType: rec.taskType });
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
      this._emit("task.completed", { workflowId: wf.workflowId, taskId: rec.taskId, taskType: rec.taskType });
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
    const childRequest = {
      name: sub.name,
      version: sub.version,
      input: sub.inputData,
      correlationId: sub.correlationId,
      idempotencyKey: sub.idempotencyKey,
      idempotencyStrategy: sub.idempotencyStrategy
    };
    if (!sub.fireAndForget) {
      childRequest.parentWorkflowId = wf.workflowId;
      childRequest.parentWorkflowTaskId = sub.taskDef.taskReferenceName;
    }
    try {
      const childId = await this.startWorkflow(childRequest);
      if (sub.fireAndForget) {
        if (rec) {
          rec.status = TaskStatus.COMPLETED;
          rec.outputData = { workflowId: childId };
          rec.endTime = this.now();
        }
        await this._saveWorkflow(wf);
        return;
      }
      if (rec) {
        rec.inputData = { ...rec.inputData || {}, workflowId: childId, subWorkflowId: childId };
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
    const parent = await this.store.get("workflows", parentId);
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
    const wf = await this.store.get("workflows", task.workflowInstanceId);
    if (result.logs && result.logs.length) {
      task.logs = task.logs || [];
      for (const l of result.logs) task.logs.push({ log: l, taskId: task.taskId, createdTime: this.now() });
    }
    task.workerId = result.workerId != null ? result.workerId : task.workerId;
    if (result.status === TaskStatus.COMPLETED) {
      task.status = TaskStatus.COMPLETED;
      task.outputData = result.outputData || {};
      task.reasonForIncompletion = "";
      task.endTime = this.now();
      task.updateTime = this.now();
      await this._saveTask(task);
      this._emit("task.completed", { workflowId: wf.workflowId, taskId: task.taskId, taskType: task.taskType });
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
      task.reasonForIncompletion = result.reasonForIncompletion || "Task failed";
      task.outputData = result.outputData || {};
      task.endTime = this.now();
      task.updateTime = this.now();
      await this._saveTask(task);
      this._emit("task.failed", { workflowId: wf.workflowId, taskId: task.taskId, taskType: task.taskType });
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
    const taskDef = await this.getTaskDef(task.taskDefName) || {};
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
      seq: task.seq + 1
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
    this._emit("task.retried", { workflowId: wf.workflowId, taskId: task.taskId, retriedTaskId: newTask.taskId });
  }
  async _failWorkflow(wf, task, reason) {
    wf.status = WorkflowStatus.FAILED;
    wf.reasonForIncompletion = reason || (task ? `${task.taskDefName} failed` : "Workflow failed");
    wf.endTime = this.now();
    wf.updateTime = this.now();
    if (task) {
      wf.failedReferenceTaskNames = [task.referenceTaskName];
      wf.failedTaskNames = [task.taskDefName || task.taskType];
    }
    await this._saveWorkflow(wf);
    this._removeFromQueues(wf);
    this._emit("workflow.failed", { workflowId: wf.workflowId, reason: wf.reasonForIncompletion });
    const def = await this.getWorkflowDef(wf.workflowName, wf.workflowVersion);
    if (def && def.failureWorkflow) {
      await this.startWorkflow({
        name: def.failureWorkflow,
        version: def.failureWorkflowVersion,
        input: {
          ...wf.input || {},
          workflowId: wf.workflowId,
          reason: wf.reasonForIncompletion,
          failureStatus: wf.status,
          failureTaskId: task ? task.taskId : null
        }
      });
    }
  }
  async _completeWorkflow(wf, def) {
    wf.status = WorkflowStatus.COMPLETED;
    wf.output = this._computeOutput(wf, def);
    wf.endTime = this.now();
    wf.updateTime = this.now();
    await this._saveWorkflow(wf);
    this._emit("workflow.completed", { workflowId: wf.workflowId });
    await this._onChildWorkflowTerminal(wf);
  }
  async _applyTerminate(wf, term) {
    const output = term.output != null ? term.output : {};
    if (term.status === "COMPLETED" || term.status === WorkflowStatus.COMPLETED) {
      wf.status = WorkflowStatus.COMPLETED;
      wf.output = output;
      wf.endTime = this.now();
      wf.updateTime = this.now();
      await this._saveWorkflow(wf);
      this._emit("workflow.completed", { workflowId: wf.workflowId });
      await this._onChildWorkflowTerminal(wf);
    } else if (term.status === "FAILED" || term.status === WorkflowStatus.FAILED) {
      await this._failWorkflow(wf, null, term.reason || "Workflow terminated with failure");
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
        this._delayTask(task, Math.ceil(((task.scheduledTime || this.now()) - this.now()) / 1e3));
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
    this._delayed.push({ taskId: task.taskId, readyAt: this.now() + seconds * 1e3 });
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
    await this.store.put("workflows", wf.workflowId, wf);
  }
  async _saveTask(task) {
    const wf = await this.store.get("workflows", task.workflowInstanceId);
    if (wf) await this.store.put("workflows", wf.workflowId, wf);
  }
  // ---- query helpers ----------------------------------------------------
  _buildFilter(query, freeText, summary = (x) => x) {
    const predicates = [];
    if (query) {
      for (const cond of parseQuery(query)) {
        predicates.push((doc) => testCondition(doc, summary(doc), cond));
      }
    }
    if (freeText && freeText !== "*") {
      const needle = freeText.toLowerCase();
      predicates.push((doc) => JSON.stringify(doc).toLowerCase().includes(needle));
    }
    if (predicates.length === 0) return () => true;
    return (doc) => predicates.every((p) => p(doc));
  }
  _applySort(list, sort, summary) {
    if (!sort) return list;
    const [field, dir] = sort.split(":");
    const mult = (dir || "ASC").toUpperCase() === "DESC" ? -1 : 1;
    return list.slice().sort((a, b) => {
      const av = summary(a)[field];
      const bv = summary(b)[field];
      if (av < bv) return -1 * mult;
      if (av > bv) return 1 * mult;
      return 0;
    });
  }
};
function retryDelay(taskDef, attempt) {
  const base = taskDef.retryDelaySeconds != null ? taskDef.retryDelaySeconds : 60;
  switch (taskDef.retryLogic) {
    case "EXPONENTIAL_BACKOFF":
      return Math.max(10, base) * Math.pow(2, Math.max(0, attempt - 1));
    case "LINEAR_BACKOFF":
      return base * attempt;
    case "FIXED":
    default:
      return base;
  }
}
function parseQuery(query) {
  const tokens = query.match(/('[^']*'|"[^"]*"|[^\s]+)/g) || [];
  const conditions = [];
  let i = 0;
  while (i < tokens.length) {
    const field = tokens[i++];
    if (!tokens[i] || tokens[i].toUpperCase() === "AND") {
      i += tokens[i] && tokens[i].toUpperCase() === "AND" ? 1 : 0;
      continue;
    }
    const op = tokens[i++];
    let value = tokens[i++];
    if (value == null) break;
    value = unquote(value);
    conditions.push({ field, op, value });
    if (tokens[i] && tokens[i].toUpperCase() === "AND") i++;
  }
  return conditions;
}
function unquote(value) {
  if (value.startsWith("'") && value.endsWith("'") || value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
function testCondition(doc, summary, cond) {
  const raw = doc[cond.field] != null ? doc[cond.field] : summary[cond.field];
  const actual = typeof raw === "string" && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  const expected = cond.value;
  switch (cond.op) {
    case "=":
    case "==":
      return actual === expected || String(actual) === String(expected);
    case "!=":
      return actual !== expected;
    case ">":
      return Number(actual) > Number(expected);
    case "<":
      return Number(actual) < Number(expected);
    case ">=":
      return Number(actual) >= Number(expected);
    case "<=":
      return Number(actual) <= Number(expected);
    case "IN": {
      const list = String(expected).replace(/[()]/g, "").split(",").map((s) => unquote(s.trim()));
      return list.includes(String(actual));
    }
    default:
      return String(actual) === String(expected);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/api/http.js
var routes = [
  // Metadata — workflow definitions
  { m: "GET", p: "/metadata/workflow/names-and-versions", h: "wfNamesAndVersions" },
  { m: "GET", p: "/metadata/workflow/names", h: "wfNames" },
  { m: "GET", p: "/metadata/workflow/latest-versions", h: "wfLatestVersions" },
  { m: "GET", p: "/metadata/workflow/{name}/versions", h: "wfVersions" },
  { m: "GET", p: "/metadata/workflow/{name}", h: "getWorkflowDef" },
  { m: "GET", p: "/metadata/workflow", h: "getAllWorkflowDefs" },
  { m: "POST", p: "/metadata/workflow/validate", h: "validateWorkflowDef" },
  { m: "POST", p: "/metadata/workflow", h: "createWorkflowDef" },
  { m: "PUT", p: "/metadata/workflow", h: "updateWorkflowDefs" },
  { m: "DELETE", p: "/metadata/workflow/{name}/{version}", h: "deleteWorkflowDef" },
  // Metadata — task definitions
  { m: "GET", p: "/metadata/taskdefs", h: "getAllTaskDefs" },
  { m: "POST", p: "/metadata/taskdefs", h: "createTaskDefs" },
  { m: "PUT", p: "/metadata/taskdefs", h: "updateTaskDef" },
  { m: "GET", p: "/metadata/taskdefs/{taskType}", h: "getTaskDef" },
  { m: "DELETE", p: "/metadata/taskdefs/{taskType}", h: "deleteTaskDef" },
  // Start workflow
  { m: "POST", p: "/workflow/execute/{name}/{version}", h: "executeWorkflow" },
  { m: "POST", p: "/workflow", h: "startWorkflow" },
  { m: "POST", p: "/workflow/{name}", h: "startWorkflowByName" },
  { m: "POST", p: "/workflow/test", h: "testWorkflow" },
  // Workflow — search & running
  { m: "GET", p: "/workflow/search", h: "searchWorkflows" },
  { m: "GET", p: "/workflow/search-v2", h: "searchWorkflowsV2" },
  { m: "GET", p: "/workflow/running/{name}", h: "runningWorkflows" },
  { m: "GET", p: "/workflow/{name}/correlated/{correlationId}", h: "workflowsByCorrelationId" },
  { m: "POST", p: "/workflow/{name}/correlated", h: "workflowsForCorrelationIds" },
  // Workflow — manage
  { m: "PUT", p: "/workflow/decide/{workflowId}", h: "decideWorkflow" },
  { m: "GET", p: "/workflow/{workflowId}/status", h: "workflowStatus" },
  { m: "GET", p: "/workflow/{workflowId}/tasks", h: "workflowTasks" },
  { m: "PUT", p: "/workflow/{workflowId}/pause", h: "pauseWorkflow" },
  { m: "PUT", p: "/workflow/{workflowId}/resume", h: "resumeWorkflow" },
  { m: "POST", p: "/workflow/{workflowId}/restart", h: "restartWorkflow" },
  { m: "POST", p: "/workflow/{workflowId}/retry", h: "retryWorkflow" },
  { m: "POST", p: "/workflow/{workflowId}/rerun", h: "rerunWorkflow" },
  { m: "PUT", p: "/workflow/{workflowId}/skiptask/{taskReferenceName}", h: "skipTask" },
  { m: "POST", p: "/workflow/{workflowId}/resetcallbacks", h: "resetCallbacks" },
  { m: "DELETE", p: "/workflow/{workflowId}/remove", h: "removeWorkflow" },
  { m: "DELETE", p: "/workflow/{workflowId}/terminate-remove", h: "terminateRemoveWorkflow" },
  { m: "DELETE", p: "/workflow/{workflowId}", h: "terminateWorkflow" },
  { m: "GET", p: "/workflow/{workflowId}", h: "getWorkflow" },
  // Task — poll & update
  { m: "GET", p: "/tasks/poll/batch/{taskType}", h: "batchPoll" },
  { m: "GET", p: "/tasks/poll/{taskType}", h: "poll" },
  { m: "POST", p: "/tasks/queue/requeue/{taskType}", h: "requeue" },
  { m: "GET", p: "/tasks/queue/all/verbose", h: "queueAllVerbose" },
  { m: "GET", p: "/tasks/queue/all", h: "queueAll" },
  { m: "GET", p: "/tasks/queue/size", h: "queueSize" },
  { m: "GET", p: "/tasks/queue/polldata/all", h: "pollDataAll" },
  { m: "GET", p: "/tasks/queue/polldata", h: "pollData" },
  { m: "GET", p: "/tasks/search-v2", h: "searchTasksV2" },
  { m: "GET", p: "/tasks/search", h: "searchTasks" },
  { m: "POST", p: "/tasks/update-v2", h: "updateTaskV2" },
  { m: "POST", p: "/tasks/{workflowId}/{taskRefName}/{status}/sync", h: "updateTaskByRefSync" },
  { m: "POST", p: "/tasks/{workflowId}/{taskRefName}/{status}", h: "updateTaskByRef" },
  { m: "POST", p: "/tasks", h: "updateTask" },
  { m: "GET", p: "/tasks/{taskId}/log", h: "getTaskLogs" },
  { m: "POST", p: "/tasks/{taskId}/log", h: "addTaskLog" },
  { m: "GET", p: "/tasks/{taskId}", h: "getTask" },
  // Event handlers
  { m: "GET", p: "/event/{event}", h: "getEventHandler" },
  { m: "DELETE", p: "/event/{event}", h: "deleteEventHandler" },
  { m: "GET", p: "/event", h: "getEventHandlers" },
  { m: "POST", p: "/event", h: "registerEventHandler" },
  { m: "PUT", p: "/event", h: "registerEventHandler" },
  // Queues (alias)
  { m: "GET", p: "/queue/all", h: "queueAll" },
  { m: "GET", p: "/queue/all/verbose", h: "queueAllVerbose" },
  { m: "GET", p: "/queue/size", h: "queueSize" },
  { m: "GET", p: "/queue/sizes", h: "queueAll" },
  // Health
  { m: "GET", p: "/health", h: "health" },
  { m: "GET", p: "/version", h: "version" }
];
function matchRoute(method, path) {
  const pathSegs = path.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.m !== method) continue;
    const segs = route.p.split("/").filter(Boolean);
    if (segs.length !== pathSegs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].startsWith("{") && segs[i].endsWith("}")) {
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
var Ctx = class {
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
      throw new BadRequestError("Invalid JSON body");
    }
    return this._parsed;
  }
  text() {
    return this.body || "";
  }
  /** Case-insensitive header lookup. Handles plain objects and Headers. */
  header(name) {
    const needle = String(name).toLowerCase();
    const src = this.headers || {};
    if (typeof src.get === "function") {
      return src.get(needle) ?? src.get(name) ?? void 0;
    }
    for (const key of Object.keys(src)) {
      if (String(key).toLowerCase() === needle) return src[key];
    }
    return void 0;
  }
};
var send = (status, body, contentType) => ({
  status,
  headers: contentType ? { "Content-Type": contentType } : {},
  body
});
var json = (status, obj) => send(status, JSON.stringify(obj), "application/json");
var text = (status, str) => send(status, String(str), "text/plain;charset=UTF-8");
var empty = (status) => ({ status, headers: {}, body: null });
var handlers = {
  health: async () => json(200, { status: "UP" }),
  version: async () => json(200, { version: "in-browser-conductor", conductor: "OSS-compatible" }),
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
    const def = await c.server.getWorkflowDef(c.params.name, c.query.version != null ? Number(c.query.version) : void 0);
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
      version: c.query.version != null ? Number(c.query.version) : void 0,
      correlationId: c.query.correlationId,
      priority: c.query.priority != null ? Number(c.query.priority) : void 0,
      input: body,
      idempotencyKey: c.header("x-idempotency-key") || void 0,
      idempotencyStrategy: c.header("x-on-conflict") || void 0
    });
    return text(200, id);
  },
  executeWorkflow: async (c) => {
    const body = c.json();
    const wf = await c.server.executeWorkflow(
      { ...body, name: c.params.name, version: c.params.version === "0" ? void 0 : Number(c.params.version) },
      { waitForSeconds: Number(c.query.waitForSeconds ?? 10), waitUntilTaskRef: c.query.waitUntilTaskRef }
    );
    return json(200, wf);
  },
  testWorkflow: async (c) => {
    const body = c.json();
    const def = body.workflowDef || (body.name ? await c.server.getWorkflowDef(body.name, body.version) : null);
    if (!def) throw new BadRequestError("workflowDef or name/version required");
    const tasks = (def.tasks || []).map((t, i) => {
      const mock = (body.taskRefToMockOutput || {})[t.taskReferenceName] || [{}];
      const m = mock[0] || {};
      return {
        taskId: `mock-task-${i}`,
        taskType: t.type,
        referenceTaskName: t.taskReferenceName,
        taskDefName: t.name,
        status: m.status || "COMPLETED",
        outputData: m.output || {},
        inputData: {}
      };
    });
    return json(200, {
      workflowId: "test-workflow",
      workflowName: def.name,
      workflowVersion: def.version,
      status: WorkflowStatus.COMPLETED,
      input: body.input || {},
      output: {},
      tasks
    });
  },
  // workflow retrieve
  getWorkflow: async (c) => {
    const wf = await c.server.getWorkflow(c.params.workflowId, c.query.includeTasks !== "false");
    if (!wf) throw new NotFoundError(`Workflow not found: ${c.params.workflowId}`);
    return json(200, wf);
  },
  workflowStatus: async (c) => {
    const st = await c.server.getWorkflowStatus(c.params.workflowId, {
      includeOutput: c.query.includeOutput === "true",
      includeVariables: c.query.includeVariables === "true"
    });
    if (!st) throw new NotFoundError(`Workflow not found: ${c.params.workflowId}`);
    return json(200, st);
  },
  workflowTasks: async (c) => {
    const res = await c.server.getTasksForWorkflow(c.params.workflowId, {
      start: Number(c.query.start ?? 0),
      count: Number(c.query.count ?? 15),
      status: c.query.status
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
      c.query.includeClosed === "true",
      c.query.includeTasks === "true"
    );
    return json(200, list);
  },
  workflowsForCorrelationIds: async (c) => {
    const map = await c.server.getWorkflowsForCorrelationIds(c.params.name, c.json(), c.query.includeClosed === "true", c.query.includeTasks === "true");
    return json(200, map);
  },
  // workflow manage
  pauseWorkflow: async (c) => empty(await c.server.pause(c.params.workflowId) ? 200 : 404),
  resumeWorkflow: async (c) => empty(await c.server.resume(c.params.workflowId) ? 200 : 404),
  restartWorkflow: async (c) => empty(await c.server.restart(c.params.workflowId, { useLatestDefinitions: c.query.useLatestDefinitions === "true" }) ? 200 : 404),
  retryWorkflow: async (c) => empty(await c.server.retry(c.params.workflowId, { resumeSubworkflowTasks: c.query.resumeSubworkflowTasks === "true" }) ? 200 : 404),
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
    await c.server.terminate(c.params.workflowId, c.query.reason || "");
    return empty(200);
  },
  removeWorkflow: async (c) => {
    await c.server.remove(c.params.workflowId, { archiveWorkflow: c.query.archiveWorkflow !== "false" });
    return empty(200);
  },
  terminateRemoveWorkflow: async (c) => {
    await c.server.terminate(c.params.workflowId, c.query.reason || "");
    await c.server.remove(c.params.workflowId, { archiveWorkflow: c.query.archiveWorkflow !== "false" });
    return empty(200);
  },
  searchWorkflows: async (c) => json(200, await c.server.searchWorkflows(searchArgs(c))),
  searchWorkflowsV2: async (c) => {
    const res = await c.server.searchWorkflows(searchArgs(c));
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
  queueSize: async (c) => text(200, await c.server.getQueueSize(c.query.taskType || "")),
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
  registerEventHandler: async (c) => {
    const handler = await c.server.registerEventHandler(c.json());
    return empty(200);
  },
  deleteEventHandler: async (c) => {
    await c.server.deleteEventHandler(c.params.event);
    return empty(200);
  }
};
function searchArgs(c) {
  return {
    query: c.query.query || null,
    freeText: c.query.freeText || null,
    start: Number(c.query.start ?? 0),
    size: Number(c.query.size ?? 100),
    sort: c.query.sort || null
  };
}
async function handleHttpRequest(request, server, { basePath = "/api" } = {}) {
  try {
    const method = (request.method || "GET").toUpperCase();
    const url = new URL(request.url, "http://localhost");
    let path = url.pathname;
    if (path.startsWith(basePath)) path = path.slice(basePath.length);
    if (!path.startsWith("/")) path = "/" + path;
    path = path.replace(/\/+$/, "") || "/";
    const query = {};
    for (const [k, v] of url.searchParams.entries()) query[k] = v;
    let body = null;
    if (method !== "GET" && method !== "HEAD") {
      body = typeof request.text === "function" ? await request.text() : request.body != null ? String(request.body) : null;
    }
    const matched = matchRoute(method, path);
    if (!matched) {
      return toErrorResponse(new NotFoundError(`No such endpoint: ${method} ${path}`));
    }
    const ctx = new Ctx(server, matched.params, query, body, request.headers || {}, method);
    const handler = handlers[matched.route.h];
    if (!handler) {
      return toErrorResponse(new ConductorError("Handler not implemented", { status: 501 }));
    }
    return await handler(ctx);
  } catch (e) {
    return toErrorResponse(e);
  }
}
function toErrorResponse(e) {
  const status = e && e.status ? e.status : 500;
  const message = e && e.message ? e.message : String(e);
  const body = { status, message };
  if (e && e.code) body.code = e.code;
  if (e && e.details) body.details = e.details;
  return json(status, body);
}
function toFetchResponse(res) {
  if (typeof Response !== "undefined") {
    const init = { status: res.status, headers: res.headers };
    return new Response(res.body ?? null, init);
  }
  return res;
}

// src/client/client.js
var ConductorClient = class {
  constructor({ baseURL = "/api", headers = {}, fetch: fetcher = null } = {}) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.headers = headers;
    this._fetch = fetcher || ((...a) => globalThis.fetch(...a));
    this.metadataResource = new MetadataResource(this);
    this.workflowResource = new WorkflowResource(this);
    this.taskResource = new TaskResource(this);
    this.queueResource = new QueueResource(this);
    this.eventResource = new EventResource(this);
  }
  async request(method, path, { body = void 0, query = {}, headers = {}, raw = false } = {}) {
    const url = new URL(this.baseURL + path, "http://localhost");
    for (const [k, v] of Object.entries(query)) {
      if (v !== void 0 && v !== null) url.searchParams.set(k, v);
    }
    const opts = { method, headers: { ...this.headers, ...headers } };
    if (body !== void 0) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await this._fetch(url.pathname + url.search, opts);
    if (res.status === 204) return null;
    const text2 = await res.text();
    if (!res.ok) {
      let detail = text2;
      try {
        detail = JSON.parse(text2);
      } catch {
      }
      const err = new Error(detail?.message || `Conductor request failed: ${res.status}`);
      err.status = res.status;
      err.details = detail;
      throw err;
    }
    if (raw) return text2;
    if (!text2) return null;
    const ct = res.headers && res.headers.get ? res.headers.get("content-type") : "";
    if (ct && ct.includes("json")) return JSON.parse(text2);
    return text2;
  }
};
var MetadataResource = class {
  constructor(c) {
    this.c = c;
  }
  registerWorkflowDef(def) {
    return this.c.request("POST", "/metadata/workflow", { body: def });
  }
  updateWorkflowDefs(defs) {
    return this.c.request("PUT", "/metadata/workflow", { body: defs });
  }
  getWorkflowDef(name, version) {
    return this.c.request("GET", `/metadata/workflow/${encodeURIComponent(name)}`, { query: { version } });
  }
  getAllWorkflowDefs() {
    return this.c.request("GET", "/metadata/workflow");
  }
  unregisterWorkflowDef(name, version) {
    return this.c.request("DELETE", `/metadata/workflow/${encodeURIComponent(name)}/${version}`);
  }
  registerTaskDefs(defs) {
    return this.c.request("POST", "/metadata/taskdefs", { body: defs });
  }
  updateTaskDef(def) {
    return this.c.request("PUT", "/metadata/taskdefs", { body: def });
  }
  getTaskDef(type) {
    return this.c.request("GET", `/metadata/taskdefs/${encodeURIComponent(type)}`);
  }
  getAllTaskDefs() {
    return this.c.request("GET", "/metadata/taskdefs");
  }
  unregisterTaskDef(type) {
    return this.c.request("DELETE", `/metadata/taskdefs/${encodeURIComponent(type)}`);
  }
};
var WorkflowResource = class {
  constructor(c) {
    this.c = c;
  }
  startWorkflow(request) {
    return this.c.request("POST", "/workflow", { body: request, raw: true });
  }
  startWorkflowByName(name, input, { version, correlationId, priority } = {}) {
    return this.c.request("POST", `/workflow/${encodeURIComponent(name)}`, {
      body: input,
      query: { version, correlationId, priority },
      raw: true
    });
  }
  executeWorkflow(name, version, input, { waitForSeconds = 10, waitUntilTaskRef } = {}) {
    return this.c.request("POST", `/workflow/execute/${encodeURIComponent(name)}/${version}`, {
      body: { name, version, input },
      query: { waitForSeconds, waitUntilTaskRef }
    });
  }
  getWorkflow(workflowId, includeTasks = true) {
    return this.c.request("GET", `/workflow/${workflowId}`, { query: { includeTasks } });
  }
  getWorkflowStatus(workflowId, { includeOutput = false, includeVariables = false } = {}) {
    return this.c.request("GET", `/workflow/${workflowId}/status`, { query: { includeOutput, includeVariables } });
  }
  getWorkflowTasks(workflowId, { start = 0, count = 15, status } = {}) {
    return this.c.request("GET", `/workflow/${workflowId}/tasks`, { query: { start, count, status } });
  }
  getRunningWorkflow(name, version, startTime, endTime) {
    return this.c.request("GET", `/workflow/running/${encodeURIComponent(name)}`, { query: { version, startTime, endTime } });
  }
  getWorkflows(name, correlationId, includeClosed = false, includeTasks = false) {
    return this.c.request("GET", `/workflow/${encodeURIComponent(name)}/correlated/${encodeURIComponent(correlationId)}`, {
      query: { includeClosed, includeTasks }
    });
  }
  getWorkflowsByCorrelationIds(name, correlationIds, includeClosed = false, includeTasks = false) {
    return this.c.request("POST", `/workflow/${encodeURIComponent(name)}/correlated`, {
      body: correlationIds,
      query: { includeClosed, includeTasks }
    });
  }
  pause(workflowId) {
    return this.c.request("PUT", `/workflow/${workflowId}/pause`);
  }
  resume(workflowId) {
    return this.c.request("PUT", `/workflow/${workflowId}/resume`);
  }
  restart(workflowId, useLatestDefinitions = false) {
    return this.c.request("POST", `/workflow/${workflowId}/restart`, { query: { useLatestDefinitions } });
  }
  retry(workflowId, resumeSubworkflowTasks = false) {
    return this.c.request("POST", `/workflow/${workflowId}/retry`, { query: { resumeSubworkflowTasks } });
  }
  rerun(workflowId, body) {
    return this.c.request("POST", `/workflow/${workflowId}/rerun`, { body });
  }
  terminate(workflowId, reason) {
    return this.c.request("DELETE", `/workflow/${workflowId}`, { query: { reason } });
  }
  remove(workflowId, archiveWorkflow = true) {
    return this.c.request("DELETE", `/workflow/${workflowId}/remove`, { query: { archiveWorkflow } });
  }
  search({ start = 0, size = 100, sort, freeText, query } = {}) {
    return this.c.request("GET", "/workflow/search", { query: { start, size, sort, freeText, query } });
  }
};
var TaskResource = class {
  constructor(c) {
    this.c = c;
  }
  getTask(taskId) {
    return this.c.request("GET", `/tasks/${taskId}`);
  }
  poll(taskType, workerId, domain) {
    return this.c.request("GET", `/tasks/poll/${encodeURIComponent(taskType)}`, { query: { workerid: workerId, domain } });
  }
  batchPoll(taskType, workerId, domain, count = 1, timeout = 100) {
    return this.c.request("GET", `/tasks/poll/batch/${encodeURIComponent(taskType)}`, { query: { workerid: workerId, domain, count, timeout } });
  }
  updateTask(result) {
    return this.c.request("POST", "/tasks", { body: result, raw: true });
  }
  updateTaskV2(result) {
    return this.c.request("POST", "/tasks/update-v2", { body: result });
  }
  updateTaskByRef(workflowId, taskRefName, status, output, workerId) {
    return this.c.request("POST", `/tasks/${workflowId}/${encodeURIComponent(taskRefName)}/${status}`, { body: output, query: { workerid: workerId } });
  }
  log(taskId, message) {
    return this.c.request("POST", `/tasks/${taskId}/log`, { body: message, headers: { "Content-Type": "text/plain" } });
  }
  getLogs(taskId) {
    return this.c.request("GET", `/tasks/${taskId}/log`);
  }
  search({ start = 0, size = 100, sort, freeText, query } = {}) {
    return this.c.request("GET", "/tasks/search", { query: { start, size, sort, freeText, query } });
  }
};
var QueueResource = class {
  constructor(c) {
    this.c = c;
  }
  getQueueSizes() {
    return this.c.request("GET", "/tasks/queue/all");
  }
};
var EventResource = class {
  constructor(c) {
    this.c = c;
  }
  registerHandler(handler) {
    return this.c.request("POST", "/event", { body: handler });
  }
  getHandlers() {
    return this.c.request("GET", "/event");
  }
  getHandler(name) {
    return this.c.request("GET", `/event/${encodeURIComponent(name)}`);
  }
  unregisterHandler(name) {
    return this.c.request("DELETE", `/event/${encodeURIComponent(name)}`);
  }
};

// src/client/worker.js
var ConductorWorker = class {
  constructor({
    taskType,
    baseURL = "/api",
    workerId = null,
    domain = null,
    concurrency = 1,
    pollInterval = 1e3,
    executeTask = null,
    client = null,
    onTaskComplete = null
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
    }
    this._timer = setTimeout(() => this._tick(), this.pollInterval);
  }
  async _run(task) {
    let result;
    try {
      const output = this.executeTask ? await this.executeTask(task.inputData) : {};
      result = { status: TaskStatus.COMPLETED, outputData: output || {} };
    } catch (e) {
      result = {
        status: TaskStatus.FAILED,
        outputData: {},
        reasonForIncompletion: e && e.message ? e.message : String(e)
      };
    }
    await this._ensureClient().taskResource.updateTask({
      workflowInstanceId: task.workflowInstanceId,
      taskId: task.taskId,
      status: result.status,
      outputData: result.outputData,
      reasonForIncompletion: result.reasonForIncompletion,
      workerId: this.workerId
    });
    if (this.onTaskComplete) {
      try {
        this.onTaskComplete({ task, result });
      } catch {
      }
    }
  }
};

// src/store/memory.js
var Store = class {
  async init() {
  }
  async reload() {
  }
  async get() {
    return void 0;
  }
  getSync() {
    return void 0;
  }
  async put() {
  }
  async delete() {
  }
  async list() {
    return [];
  }
  async clear() {
  }
};
function createCollections() {
  return /* @__PURE__ */ new Map();
}
var MemoryStore = class extends Store {
  constructor() {
    super();
    this.data = createCollections();
  }
  _coll(name) {
    if (!this.data.has(name)) this.data.set(name, /* @__PURE__ */ new Map());
    return this.data.get(name);
  }
  async init() {
  }
  async get(collection, key) {
    return this._coll(collection).get(key);
  }
  getSync(collection, key) {
    return this._coll(collection).get(key);
  }
  async put(collection, key, value) {
    this._coll(collection).set(key, value);
    return value;
  }
  async delete(collection, key) {
    return this._coll(collection).delete(key);
  }
  async list(collection) {
    return Array.from(this._coll(collection).values());
  }
  async clear(collection) {
    if (collection) this._coll(collection).clear();
    else this.data.clear();
  }
};

// src/store/localstorage.js
var DEFAULT_KEY = "conductor.browser.db.v1";
var LocalStorageStore = class extends Store {
  constructor({ storageKey = DEFAULT_KEY, storage = null, debounceMs = 0 } = {}) {
    super();
    this.storageKey = storageKey;
    this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    this.debounceMs = debounceMs;
    this.data = createCollections();
    this._timer = null;
  }
  _coll(name) {
    if (!this.data.has(name)) this.data.set(name, /* @__PURE__ */ new Map());
    return this.data.get(name);
  }
  async init() {
    await this.reload();
  }
  async reload() {
    if (!this.storage) return;
    const raw = this.storage.getItem(this.storageKey);
    this.data = createCollections();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      for (const [coll, entries] of Object.entries(parsed || {})) {
        const map = new Map(Object.entries(entries));
        this.data.set(coll, map);
      }
    } catch (e) {
      console.warn("[in-browser-conductor] failed to read persisted db, starting fresh", e);
    }
  }
  _schedulePersist() {
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._persist();
    }, this.debounceMs);
  }
  _persist() {
    if (!this.storage) return;
    const snapshot = {};
    for (const [coll, map] of this.data.entries()) {
      snapshot[coll] = Object.fromEntries(map.entries());
    }
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(snapshot));
    } catch (e) {
      console.warn("[in-browser-conductor] failed to persist db (quota?)", e);
    }
  }
  async get(collection, key) {
    return this._coll(collection).get(key);
  }
  getSync(collection, key) {
    return this._coll(collection).get(key);
  }
  async put(collection, key, value) {
    this._coll(collection).set(key, value);
    if (this.debounceMs > 0) this._schedulePersist();
    else this._persist();
    return value;
  }
  async delete(collection, key) {
    const existed = this._coll(collection).delete(key);
    if (this.debounceMs > 0) this._schedulePersist();
    else this._persist();
    return existed;
  }
  async list(collection) {
    return Array.from(this._coll(collection).values());
  }
  async clear(collection) {
    if (collection) this._coll(collection).clear();
    else this.data.clear();
    this._persist();
  }
  async flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._persist();
  }
};

// src/store/sqlite.js
var SqliteStore = class extends Store {
  constructor({ sqlJs = null, wasmUrl = "https://sql.js.org/dist/sql-wasm.js", dbName = "conductor" } = {}) {
    super();
    this.sqlJs = sqlJs;
    this.wasmUrl = wasmUrl;
    this.dbName = dbName;
    this.db = null;
    this._opfs = null;
  }
  async init() {
    const SQL = this.sqlJs || await this._loadSqlJs();
    if (!this.db) {
      if (SQL.FS && this._hasOpfs()) {
        this.db = await this._openWithPersistence(SQL);
      } else {
        this.db = new SQL.Database();
      }
    }
    this.db.run(
      `CREATE TABLE IF NOT EXISTS docs (
         collection TEXT NOT NULL,
         key TEXT NOT NULL,
         json TEXT NOT NULL,
         PRIMARY KEY (collection, key)
       )`
    );
  }
  async _loadSqlJs() {
    if (typeof importScripts === "function") {
      importScripts(this.wasmUrl);
      return globalThis.initSqlJs;
    }
    const mod = await import(
      /* @vite-ignore */
      this.wasmUrl
    );
    const initSqlJs = mod.default || mod.initSqlJs || globalThis.initSqlJs;
    return initSqlJs({ locateFile: () => this.wasmUrl.replace(/sql-wasm\.js$/, "sql-wasm.wasm") });
  }
  _hasOpfs() {
    return typeof navigator !== "undefined" && navigator.storage && navigator.storage.getDirectory;
  }
  async _openWithPersistence(SQL) {
    const saved = await this._loadBytes();
    const db = saved ? new SQL.Database(new Uint8Array(saved)) : new SQL.Database();
    this._persistHook = () => {
      const data = db.export();
      this._saveBytes(data).catch(() => {
      });
    };
    return db;
  }
  _idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("in-browser-conductor", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("sqlite")) {
          req.result.createObjectStore("sqlite");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async _loadBytes() {
    try {
      const db = await this._idb();
      return new Promise((resolve) => {
        const tx = db.transaction("sqlite", "readonly");
        const req = tx.objectStore("sqlite").get(this.dbName);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }
  async _saveBytes(bytes) {
    try {
      const db = await this._idb();
      return new Promise((resolve) => {
        const tx = db.transaction("sqlite", "readwrite");
        tx.objectStore("sqlite").put(bytes, this.dbName);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
    }
  }
  _persist() {
    if (this._persistHook) this._persistHook();
  }
  async get(collection, key) {
    return this._getSync(collection, key);
  }
  getSync(collection, key) {
    return this._getSync(collection, key);
  }
  _getSync(collection, key) {
    const stmt = this.db.prepare("SELECT json FROM docs WHERE collection = ? AND key = ?");
    stmt.bind([collection, key]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row ? JSON.parse(row.json) : void 0;
  }
  async put(collection, key, value) {
    this.db.run(
      "INSERT OR REPLACE INTO docs (collection, key, json) VALUES (?, ?, ?)",
      [collection, key, JSON.stringify(value)]
    );
    this._persist();
    return value;
  }
  async delete(collection, key) {
    this.db.run("DELETE FROM docs WHERE collection = ? AND key = ?", [collection, key]);
    this._persist();
    return true;
  }
  async list(collection) {
    const stmt = this.db.prepare("SELECT json FROM docs WHERE collection = ?");
    stmt.bind([collection]);
    const out = [];
    while (stmt.step()) out.push(JSON.parse(stmt.getAsObject().json));
    stmt.free();
    return out;
  }
  async clear(collection) {
    if (collection) this.db.run("DELETE FROM docs WHERE collection = ?", [collection]);
    else this.db.run("DELETE FROM docs");
    this._persist();
  }
};

// src/store/index.js
function createStore(spec = "localstorage", options = {}) {
  if (spec instanceof MemoryStore || spec instanceof LocalStorageStore || spec instanceof SqliteStore) {
    return spec;
  }
  switch (spec) {
    case "memory":
      return new MemoryStore();
    case "localstorage":
      return new LocalStorageStore(options);
    case "sqlite":
      return new SqliteStore(options);
    default:
      throw new Error(`Unknown store: ${spec}`);
  }
}

// src/index.js
async function createServer({
  store = "localstorage",
  storeOptions = {},
  logger = null,
  sweeperIntervalMs = 500
} = {}) {
  const s = createStore(store, storeOptions);
  const server = new ConductorServer({ store: s, logger, sweeperIntervalMs });
  await server.init();
  return server;
}
function patchFetch(server, { basePath = "/api" } = {}) {
  if (typeof window === "undefined" || typeof window.fetch === "undefined") return () => {
  };
  const original = window.fetch;
  const self = window;
  self.fetch = async function(input, init) {
    let url;
    let method;
    let body;
    try {
      url = typeof input === "string" ? input : input && input.url || "";
      const u = new URL(url, self.location ? self.location.href : "http://localhost");
      const sameOrigin = !self.location || u.origin === self.location.origin;
      const inPath = u.pathname === basePath || u.pathname.startsWith(basePath + "/");
      if (sameOrigin && inPath) {
        method = (init && init.method || input && input.method || "GET").toUpperCase();
        body = init && init.body != null ? init.body : void 0;
        if (body != null && typeof body !== "string") {
          body = typeof body === "object" ? JSON.stringify(body) : String(body);
        }
        const headers = init && init.headers || input && input.headers || {};
        const res = await handleHttpRequest({ method, url: u.href, body, headers }, server, { basePath });
        return toFetchResponse(res);
      }
    } catch (e) {
    }
    return original.apply(self, arguments);
  };
  return () => {
    self.fetch = original;
  };
}
async function registerServiceWorker(server, { swPath = "/sw.js", basePath = "/api" } = {}) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return { unregister: () => {
  } };
  const onMessage = (event) => {
    const msg = event.data;
    if (msg && msg.type === "IN_BROWSER_CONDUCTOR_REQUEST" && msg.port) {
      handleHttpRequest(msg.request, server, { basePath }).then((res) => msg.port.postMessage({ status: res.status, headers: res.headers, body: res.body })).catch((e) => msg.port.postMessage({ status: e.status || 500, headers: {}, body: JSON.stringify({ message: e.message }) }));
    }
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  let registration = null;
  try {
    registration = await navigator.serviceWorker.register(swPath);
  } catch (e) {
  }
  return {
    registration,
    unregister: () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (registration) registration.unregister();
    }
  };
}
async function install({
  store = "localstorage",
  storeOptions = {},
  basePath = "/api",
  patchFetch: doPatchFetch = true,
  serviceWorker = false,
  swPath = "/sw.js",
  sweeperIntervalMs = 500
} = {}) {
  const server = await createServer({ store, storeOptions, sweeperIntervalMs });
  const uninstallers = [];
  if (doPatchFetch) uninstallers.push(patchFetch(server, { basePath }));
  let sw = null;
  if (serviceWorker) sw = await registerServiceWorker(server, { swPath, basePath });
  const client = new ConductorClient({ baseURL: basePath });
  return {
    server,
    client,
    uninstall: () => {
      uninstallers.forEach((fn) => fn && fn());
      if (sw) sw.unregister();
    }
  };
}
var index_default = {
  createServer,
  install,
  patchFetch,
  registerServiceWorker,
  ConductorServer,
  ConductorClient,
  ConductorWorker,
  createStore,
  MemoryStore,
  LocalStorageStore,
  SqliteStore
};
export {
  ApplicationException,
  BadRequestError,
  ConductorClient,
  ConductorError,
  ConductorServer,
  ConductorWorker,
  ConflictError,
  Decider,
  LocalStorageStore,
  MemoryStore,
  NotFoundError,
  SqliteStore,
  buildContext,
  createServer,
  createStore,
  index_default as default,
  enums_exports as enums,
  handleHttpRequest,
  install,
  jsonPath,
  patchFetch,
  registerServiceWorker,
  substitute,
  toFetchResponse
};
//# sourceMappingURL=in-browser-conductor.esm.js.map
