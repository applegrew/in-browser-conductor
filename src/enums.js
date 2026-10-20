/**
 * Enums mirroring Conductor OSS's `WorkflowStatus`, `Task.Status`,
 * `TaskType`, `RetryLogic` and `TimeoutPolicy`. These are the exact string
 * values used on the wire so that existing clients interoperate unchanged.
 */

export const WorkflowStatus = {
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMED_OUT: 'TIMED_OUT',
  TERMINATED: 'TERMINATED',
};

export const TaskStatus = {
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  CANCELED: 'CANCELED',
  FAILED: 'FAILED',
  FAILED_WITH_TERMINAL_ERROR: 'FAILED_WITH_TERMINAL_ERROR',
  COMPLETED: 'COMPLETED',
  COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
  TIMED_OUT: 'TIMED_OUT',
  SKIPPED: 'SKIPPED',
};

export const TaskType = {
  SIMPLE: 'SIMPLE',
  DYNAMIC: 'DYNAMIC',
  FORK_JOIN: 'FORK_JOIN',
  FORK: 'FORK_JOIN',
  JOIN: 'JOIN',
  EXCLUSIVE_JOIN: 'EXCLUSIVE_JOIN',
  DO_WHILE: 'DO_WHILE',
  SWITCH: 'SWITCH',
  SUB_WORKFLOW: 'SUB_WORKFLOW',
  START_WORKFLOW: 'START_WORKFLOW',
  DYNAMIC_FORK: 'DYNAMIC_FORK',
  HTTP: 'HTTP',
  INLINE: 'INLINE',
  WAIT: 'WAIT',
  HUMAN: 'HUMAN',
  EVENT: 'EVENT',
  TERMINATE: 'TERMINATE',
  SET_VARIABLE: 'SET_VARIABLE',
  JSON_JQ_TRANSFORM: 'JSON_JQ_TRANSFORM',
  NOOP: 'NOOP',
};

export const RetryLogic = {
  FIXED: 'FIXED',
  EXPONENTIAL_BACKOFF: 'EXPONENTIAL_BACKOFF',
  LINEAR_BACKOFF: 'LINEAR_BACKOFF',
};

export const TimeoutPolicy = {
  RETRY: 'RETRY',
  TIME_OUT_WF: 'TIME_OUT_WF',
  ALERT_ONLY: 'ALERT_ONLY',
};

/** System / operator task types that the engine executes itself. */
export const OPERATOR_TASK_TYPES = new Set([
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
  TaskType.DYNAMIC_FORK,
]);

/** System tasks that execute inline without a worker. */
export const SYSTEM_TASK_TYPES = new Set([
  TaskType.HTTP,
  TaskType.INLINE,
  TaskType.NOOP,
  TaskType.EVENT,
  TaskType.JSON_JQ_TRANSFORM,
]);

export const TERMINAL_WORKFLOW_STATUSES = new Set([
  WorkflowStatus.COMPLETED,
  WorkflowStatus.FAILED,
  WorkflowStatus.TIMED_OUT,
  WorkflowStatus.TERMINATED,
]);

export const TERMINAL_TASK_STATUSES = new Set([
  TaskStatus.COMPLETED,
  TaskStatus.COMPLETED_WITH_ERRORS,
  TaskStatus.FAILED,
  TaskStatus.FAILED_WITH_TERMINAL_ERROR,
  TaskStatus.TIMED_OUT,
  TaskStatus.SKIPPED,
  TaskStatus.CANCELED,
]);
