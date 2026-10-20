/**
 * Expression evaluation for Conductor task inputs and operator conditions.
 *
 * Conductor uses two closely related mechanisms:
 *   1. `${...}` template substitution inside `inputParameters` (and
 *      `outputParameters`, `inputTemplate`, etc.). A value that is *exactly*
 *      a single `${...}` expression evaluates to the raw JSONPath result
 *      (which may be an object/array). A value that contains an expression
 *      embedded in other text is string-concatenated.
 *   2. Bare JSONPath (jayway/JsonPath style) for `inputExpression` and
 *      operator expressions.
 *
 * The evaluation root exposes:
 *   - `workflow`: { input, output, variables, status, workflowId, ... }
 *   - one key per completed task reference name: { input, output, ... }
 *
 * We implement the JSONPath subset that covers the vast majority of real
 * workflow definitions: dot notation, bracket notation (numeric indices and
 * quoted keys), `[*]` wildcard, and array access on intermediate segments.
 */

function tokenize(path) {
  const segments = [];
  let i = 0;
  const len = path.length;
  while (i < len) {
    const ch = path[i];
    if (ch === '.' || ch === ' ' || ch === '\t' || ch === '\n') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      const close = path.indexOf(']', i);
      if (close === -1) {
        segments.push(path.slice(i + 1));
        break;
      }
      let inner = path.slice(i + 1, close).trim();
      if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      ) {
        inner = inner.slice(1, -1);
      }
      segments.push(inner);
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < len && path[j] !== '.' && path[j] !== '[') j += 1;
    segments.push(path.slice(i, j));
    i = j;
  }
  return segments.filter((s) => s !== '');
}

function getByKey(value, key) {
  if (value == null) return undefined;
  if (Array.isArray(value)) {
    if (key === '*') return value;
    if (/^-?\d+$/.test(key)) return value[Number(key)];
    return undefined;
  }
  if (typeof value === 'object') {
    if (key === '*') return Object.values(value);
    return value[key];
  }
  return undefined;
}

function descend(root, segments) {
  let cur = root;
  for (const seg of segments) {
    if (seg === '*') {
      if (Array.isArray(cur)) {
        // `arr[*]` -> map remaining segments over each element.
        const rest = segments.slice(segments.indexOf(seg) + 1);
        if (rest.length === 0) return cur;
        return cur.map((el) => descend(el, rest));
      }
      if (cur && typeof cur === 'object') return Object.values(cur);
      return undefined;
    }
    cur = getByKey(cur, seg);
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function jsonPath(root, path) {
  if (path == null) return undefined;
  if (typeof path !== 'string') return path;
  const p = path.trim();
  if (p === '$' || p === '') return root;
  const stripped = p.startsWith('$.') ? p.slice(2) : p.startsWith('$') ? p.slice(1) : p;
  const segments = tokenize(stripped);
  if (segments.length === 0) return root;
  return descend(root, segments);
}

function stringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

const FULL_EXPR = /^\s*\$\{([\s\S]+)\}\s*$/;

/**
 * Substitute `${...}` expressions within a value against the supplied root.
 */
export function substitute(value, root) {
  if (typeof value === 'string') {
    // Escaped expression: `$${...}` -> literal `${...}`.
    if (value.startsWith('$$')) return value.slice(1);
    const full = FULL_EXPR.exec(value);
    if (full) {
      const result = jsonPath(root, full[1]);
      // A single full-object expression returns the raw value.
      return result === undefined ? null : result;
    }
    return value.replace(/\$\{([\s\S]+?)\}/g, (_, expr) => {
      const v = jsonPath(root, expr.trim());
      return stringify(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, root));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = substitute(value[k], root);
    return out;
  }
  return value;
}

/**
 * Build an evaluation root for a workflow: `workflow.*` plus one entry per
 * completed task keyed by its reference name.
 */
export function buildContext(workflow, tasksByRef = {}) {
  const root = {
    workflow: {
      input: workflow.input || {},
      output: workflow.output || {},
      variables: workflow.variables || {},
      status: workflow.status,
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      workflowVersion: workflow.workflowVersion,
      correlationId: workflow.correlationId,
    },
  };
  for (const ref of Object.keys(tasksByRef)) {
    const t = tasksByRef[ref];
    root[ref] = {
      input: t.inputData || {},
      output: t.outputData || {},
      status: t.status,
      taskId: t.taskId,
    };
  }
  return root;
}

/**
 * Evaluate a "value-param" style SWITCH expression such as
 * `switchCaseValue` (default) or a `${...}` expression.
 */
export function evaluateSwitchCase(workflow, task, switchCaseValue, switchCaseExpression) {
  const tasksByRef = latestTasksByRef(workflow);
  const root = buildContext(workflow, tasksByRef);
  if (switchCaseExpression) {
    return jsonPath(root, switchCaseExpression);
  }
  if (switchCaseValue != null) {
    return substitute(switchCaseValue, root);
  }
  return undefined;
}

export function latestTasksByRef(workflow) {
  const map = {};
  for (const t of workflow.tasks || []) {
    const prev = map[t.referenceTaskName];
    if (!prev || (t.seq ?? 0) >= (prev.seq ?? 0)) map[t.referenceTaskName] = t;
  }
  return map;
}

export function getTaskByRef(workflow, ref) {
  return latestTasksByRef(workflow)[ref] || null;
}

/** Deep clone helper (JSON-safe structures only, which is all we store). */
export function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}
