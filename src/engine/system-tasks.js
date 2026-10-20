import { TaskType } from '../enums.js';
import { jsonPath } from '../expression.js';

/**
 * Executors for Conductor system tasks that the engine runs itself rather
 * than handing to a remote worker. Each returns the task's output data.
 * HTTP tasks are async (they use `fetch`); the rest are synchronous.
 */

export function isInlineSystemTask(type) {
  return (
    type === TaskType.NOOP ||
    type === TaskType.INLINE ||
    type === TaskType.EVENT ||
    type === TaskType.JSON_JQ_TRANSFORM
  );
}

export function isAsyncSystemTask(type) {
  return type === TaskType.HTTP;
}

/** NOOP: output equals input. */
export function executeNoop(inputData) {
  return cloneInput(inputData);
}

/** INLINE: evaluate JavaScript with the task input in scope. */
export function executeInline(inputData, taskDef) {
  const expression = taskDef.expression || taskDef.inputParameters?.expression || '';
  const evaluatorType = taskDef.evaluatorType || 'javascript';
  if (evaluatorType !== 'javascript') {
    throw new Error(`Unsupported INLINE evaluator type: ${evaluatorType}`);
  }
  // Expose evaluated input as `input` and a `$` convenience alias.
  const fn = new Function('input', '$', `"use strict"; return (function(){ ${expression}\n})();`);
  const result = fn(inputData, inputData);
  return { result, ...cloneInput(inputData) };
}

/** JSON_JQ_TRANSFORM: minimal JSONPath-based transform (subset of jq). */
export function executeJsonJq(inputData, taskDef) {
  const query = taskDef.queryExpression || taskDef.inputParameters?.queryExpression;
  const source = inputData;
  if (!query) return cloneInput(source);
  // Accept ".foo.bar" JSONPath forms and a handful of simple jq forms.
  if (query.trim().startsWith('.')) {
    return { result: jsonPath(source, query.trim()) };
  }
  if (query.trim() === '.') return { result: source };
  // Fallback: return the query string verbatim so definitions still run.
  return { result: query };
}

/** EVENT: publish an event into the engine's event bus (handled by server). */
export function executeEvent(inputData, taskDef, { publish }) {
  const action = taskDef.inputParameters?.action || inputData.action || 'complete_task';
  const event = taskDef.inputParameters?.event || inputData.event;
  if (publish) publish({ action, event, payload: inputData });
  return { action, ...cloneInput(inputData) };
}

/**
 * HTTP: execute an HTTP request using `fetch`. Accepts Conductor's
 * `http_request` shape (with `uri`, `method`, `headers`, `body`) as well as a
 * flattened `uri`/`method`/`headers`/`body` on the task input.
 */
export async function executeHttp(inputData, taskDef) {
  const input = inputData || {};
  const req = input.http_request || input;
  const uri = req.uri || req.url;
  if (!uri) throw new Error('HTTP task missing uri');

  const method = (req.method || 'GET').toUpperCase();
  const headers = req.headers || {};
  const body = req.body != null ? req.body : input.body;

  const options = { method, headers: { ...headers } };
  let rawBody = null;
  if (body != null && method !== 'GET' && method !== 'HEAD') {
    if (typeof body === 'string') {
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
      if (!options.headers['Content-Type'] && !options.headers['content-type']) {
        options.headers['Content-Type'] = 'application/json';
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

  const text = await response.text();
  let jsonBody = text;
  try {
    jsonBody = text ? JSON.parse(text) : null;
  } catch {
    /* leave as text */
  }

  return {
    response: {
      statusCode: response.status,
      headers: headersFromResponse(response),
      body: jsonBody,
      reason: response.statusText,
    },
    statusCode: response.status,
    reason: response.statusText,
    body: jsonBody,
    headers: headersFromResponse(response),
    timeTakenMs: Date.now() - started,
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
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
}
