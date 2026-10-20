import { WorkflowStatus, TaskStatus, TaskType, TimeoutPolicy } from '../enums.js';
import { uuid } from '../ids.js';
import { clone } from '../expression.js';

/** Defaults applied to task definitions when fields are omitted. */
export const TASK_DEF_DEFAULTS = {
  retryCount: 3,
  retryLogic: 'FIXED',
  retryDelaySeconds: 60,
  timeoutSeconds: 0,
  timeoutPolicy: TimeoutPolicy.TIME_OUT_WF,
  responseTimeoutSeconds: 3600,
  pollTimeoutSeconds: 100,
  rateLimitPerSecond: 0,
  ownerEmail: 'example@example.com',
};

export const WORKFLOW_DEF_DEFAULTS = {
  schemaVersion: 2,
  restartable: true,
  workflowStatusListenerEnabled: false,
  timeoutSeconds: 0,
  timeoutPolicy: TimeoutPolicy.TIME_OUT_WF,
  ownerEmail: 'example@example.com',
};

/** Merge stored task def with runtime defaults. */
export function normalizeTaskDef(taskDef) {
  if (!taskDef || !taskDef.name) return null;
  return { ...TASK_DEF_DEFAULTS, ...taskDef };
}

export function normalizeWorkflowDef(def) {
  return { ...WORKFLOW_DEF_DEFAULTS, ...def };
}

export function taskDefKey(name, version) {
  return `${name}:${version}`;
}

/**
 * Create a new workflow execution record from a definition + start request.
 */
export function createWorkflowInstance(def, request) {
  const now = Date.now();
  const input = { ...(def.inputTemplate || {}), ...(request.input || {}) };
  return {
    workflowId: uuid(),
    workflowName: def.name,
    workflowVersion: def.version,
    correlationId: request.correlationId || undefined,
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
    reasonForIncompletion: '',
    lastRetriedTime: 0,
    event: request.event,
    deciderState: {},
  };
}

/**
 * Create a task execution record for a scheduled task.
 */
export function createTaskRecord(workflow, def, taskDef, inputData, opts = {}) {
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
    reasonForIncompletion: '',
    domain: null,
    optional: !!taskDef.optional,
    asyncComplete: !!taskDef.asyncComplete,
    iteration: opts.iteration != null ? opts.iteration : null,
    dynamic: !!opts.dynamic,
  };
}

/** Latest attempt (highest seq) for a reference name. */
export function latestTaskForRef(workflow, ref) {
  let latest = null;
  for (const t of workflow.tasks || []) {
    if (t.referenceTaskName !== ref) continue;
    if (!latest || (t.seq ?? 0) >= (latest.seq ?? 0)) latest = t;
  }
  return latest;
}

/** All task records for a reference name, oldest first. */
export function tasksForRef(workflow, ref) {
  return (workflow.tasks || [])
    .filter((t) => t.referenceTaskName === ref)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export function isTerminalWorkflow(status) {
  return (
    status === WorkflowStatus.COMPLETED ||
    status === WorkflowStatus.FAILED ||
    status === WorkflowStatus.TIMED_OUT ||
    status === WorkflowStatus.TERMINATED
  );
}

export function isTerminalTask(status) {
  return (
    status === TaskStatus.COMPLETED ||
    status === TaskStatus.COMPLETED_WITH_ERRORS ||
    status === TaskStatus.FAILED ||
    status === TaskStatus.FAILED_WITH_TERMINAL_ERROR ||
    status === TaskStatus.TIMED_OUT ||
    status === TaskStatus.SKIPPED ||
    status === TaskStatus.CANCELED
  );
}

/** True when a task is a worker/system leaf task (not a control operator). */
export function isLeafType(type) {
  return !(
    type === TaskType.FORK_JOIN ||
    type === TaskType.JOIN ||
    type === TaskType.EXCLUSIVE_JOIN ||
    type === TaskType.DO_WHILE ||
    type === TaskType.SWITCH ||
    type === TaskType.TERMINATE ||
    type === TaskType.SET_VARIABLE ||
    type === TaskType.SUB_WORKFLOW ||
    type === TaskType.START_WORKFLOW ||
    type === TaskType.DYNAMIC ||
    type === TaskType.DYNAMIC_FORK
  );
}
