# In-Browser Conductor

A **Conductor OSS–compatible workflow engine that runs entirely inside the browser** — no server, no database, no network calls. It is a **drop-in replacement** for the server-side Conductor dependency in demo/example applications.

It exposes the **same REST API** as Conductor OSS (`/api/...`), backed by the browser's own storage (`localStorage` by default, optional SQLite via sql.js / OPFS), and ships with a **web control plane** (à la the Conductor OSS UI at `/executions`) at **`/cossb/executions`**.

```
┌────────────────────────────────────────────────────────────────┐
│  Your app  (any fetch-based Conductor SDK / client)            │
│                    │  fetch('/api/...')                        │
│                    ▼                                           │
│   patchFetch  ───▶  HTTP router  (Conductor REST surface)      │
│   / service worker                                             │
│                    ▼                                           │
│   Conductor engine  (decider + system tasks + queues)          │
│                    ▼                                           │
│   Store:  localStorage  |  sql.js (SQLite)  |  memory          │
└────────────────────────────────────────────────────────────────┘
        ▲
        └── Control plane UI  (/cossb/executions, /cossb/workflows, …)
```

---

## Table of contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Running the demo and control plane](#running-the-demo-and-control-plane)
4. [How to use it](#how-to-use-it)
   - [Install & boot the engine](#install--boot-the-engine)
   - [Storage backends](#storage-backends)
   - [Registering definitions](#registering-definitions)
   - [Running workers](#running-workers)
   - [Starting & managing workflows](#starting--managing-workflows)
   - [The client SDK](#the-client-sdk)
   - [The REST API](#the-rest-api)
   - [The control plane](#the-control-plane)
5. [How it works](#how-it-works)
   - [Architecture](#architecture)
   - [Data model](#data-model)
   - [The decider (state machine)](#the-decider-state-machine)
   - [Operators](#operators)
   - [System tasks](#system-tasks)
   - [Workers & queues](#workers--queues)
   - [Failure handling & retries](#failure-handling--retries)
   - [Expressions](#expressions)
   - [Persistence](#persistence)
   - [Lifecycle (event loop & sweeper)](#lifecycle-event-loop--sweeper)
6. [Supported task types](#supported-task-types)
7. [Project layout](#project-layout)
8. [Development](#development)
9. [Limitations & notes](#limitations--notes)
10. [License](#license)

---

## Features

- **Drop-in REST API** — the Conductor OSS HTTP surface under `/api`: metadata, start/execute workflow, workflow management, task poll/update, queues, search, events.
- **Full decider** — Conductor's core state machine: `FORK_JOIN`/`JOIN`, `SWITCH`, `DO_WHILE`, `SUB_WORKFLOW`, `SET_VARIABLE`, `TERMINATE`, `DYNAMIC`, `DYNAMIC_FORK`, `START_WORKFLOW`.
- **System tasks** — `HTTP`, `INLINE`, `NOOP`, `JSON_JQ_TRANSFORM`, `EVENT`, `WAIT`.
- **Worker tasks** — `SIMPLE`/`HUMAN` with retries, timeouts, `optional`, `startDelay`, `asyncComplete`, `callbackAfterSeconds`.
- **Expressions** — `${workflow.input…}`, `${taskRef.output…}`, `inputExpression` (JSONPath), `inputTemplate`, `outputParameters`, workflow `variables`.
- **Failure semantics** — retry policies (`FIXED`, `EXPONENTIAL_BACKOFF`, `LINEAR_BACKOFF`), `failureWorkflow`, workflow/task timeouts.
- **Pluggable storage** — `memory`, `localStorage`, `sqlite` (sql.js) behind one `Store` interface.
- **Two exposure modes** — `patchFetch()` (in-process `fetch` interception, works on `file://`) and `registerServiceWorker()` (real HTTP surface).
- **Client SDK + worker** — `ConductorClient` and `ConductorWorker` mirroring the official SDK.
- **Web control plane** — executions, workflow/task definitions, queues, and execution detail with actions.
- **Zero build step to consume** — a single IIFE bundle (`dist/in-browser-conductor.js`) that drops into any static page.

---

## Quick start

### Drop a single file into any static page

```html
<script src="https://…/in-browser-conductor.js"></script>
<script>
  const { install, ConductorWorker } = InBrowserConductor;

  (async () => {
    // Boot the engine and patch fetch so '/api/*' is served in-process.
    const { client } = await install({ store: 'localstorage' });

    // Register a task and a workflow (identical JSON to Conductor).
    await client.metadataResource.registerTaskDefs([{ name: 'greet', retryCount: 1 }]);
    await client.metadataResource.updateWorkflowDefs([{
      name: 'greeting', version: 1,
      tasks: [{
        name: 'greet', taskReferenceName: 'greet_ref', type: 'SIMPLE',
        inputParameters: { name: '${workflow.input.name}' },
      }],
      outputParameters: { greeting: '${greet_ref.output.greeting}' },
    }]);

    // Run a worker for the 'greet' task.
    const worker = new ConductorWorker({
      taskType: 'greet',
      baseURL: '/api',
      executeTask: async (input) => ({ greeting: `Hello, ${input.name}!` }),
    });
    worker.start();

    // Start a workflow — returns the workflow id.
    const id = await client.workflowResource.startWorkflow({
      name: 'greeting', version: 1, input: { name: 'Ada' },
    });
    console.log('workflow id:', id);
  })();
</script>
```

### As ES modules / npm

```js
import { createServer, ConductorClient, ConductorWorker } from 'in-browser-conductor';

const server = await createServer({ store: 'localstorage' });
const client = new ConductorClient({ baseURL: '/api' });
```

---

## Running the demo and control plane

```bash
npm install
npm run build     # bundles to dist/ and vendors into demo/ and cossb/
npm run serve     # zero-dependency static server (http://localhost:4173)
```

`npm run serve` starts a small static server (no build step, no extra deps) that serves:

| URL | What it is |
| --- | --- |
| `http://localhost:4173/` | Getting-started demo (registers samples + runs live workers) |
| `http://localhost:4173/cossb/executions` | **Control plane** — executions list |
| `http://localhost:4173/cossb/workflows` | Control plane — workflow definitions |
| `http://localhost:4173/cossb/tasks` | Control plane — task definitions |
| `http://localhost:4173/cossb/queues` | Control plane — queue sizes |
| `http://localhost:4173/cossb/workflow/{id}` | Control plane — execution detail |

> The demo and the control plane run on the **same origin** and share the same
> `localStorage`, so workflows you start in the demo appear immediately in the
> control plane (and vice-versa). That is intentional: the control plane is a
> management view over the shared engine state.

### Serving the control plane with any static server

The control plane is a **plain static site** under the `cossb/` directory, so
`/cossb/executions`, `/cossb/workflows`, `/cossb/tasks`, and `/cossb/queues`
work with *any* static file server — no SPA fallback or configuration required
(each route is a real directory containing an `index.html`):

```bash
# any of these work:
npx serve .            # then open http://localhost:3000/cossb/executions
python3 -m http.server # then open http://localhost:8000/cossb/executions
```

Only the **execution-detail** deep link (`/cossb/workflow/{id}`) needs the SPA
fallback that `npm run serve` provides; within the app, navigation is
client-side (History API), so clicking through always works regardless of
server. `npm run serve` additionally rewrites `/cossb/*` so even detail
deep-links and refreshes resolve correctly.

---

## How to use it

### Install & boot the engine

There are three entry points, in increasing order of convenience:

```js
// 1. Low-level: create a server and wire everything yourself.
import { createServer } from 'in-browser-conductor';
const server = await createServer({ store: 'localstorage' });

// 2. One call: server + client, fetch already patched.
import { install } from 'in-browser-conductor';
const { server, client, uninstall } = await install({ store: 'localstorage' });
```

`install(options)` accepts:

| Option | Default | Meaning |
| --- | --- | --- |
| `store` | `'localstorage'` | `'memory'`, `'localstorage'`, `'sqlite'`, or a `Store` instance |
| `storeOptions` | `{}` | Options forwarded to the store (e.g. `wasmUrl` for sqlite) |
| `basePath` | `'/api'` | The REST API base path |
| `patchFetch` | `true` | Intercept `fetch('/api/...')` in-process |
| `serviceWorker` | `false` | Also register a service worker for real HTTP |
| `swPath` | `'/sw.js'` | Path to the service worker script |
| `sweeperIntervalMs` | `500` | Background timer frequency (timeouts, delayed tasks) |

### Storage backends

```js
const a = await createServer({ store: 'memory' });       // ephemeral — great for tests
const b = await createServer({ store: 'localstorage' }); // durable, ~5MB, zero deps (default)
const c = await createServer({ store: 'sqlite', storeOptions: {
  wasmUrl: 'https://sql.js.org/dist/sql-wasm.js',        // SQLite via sql.js (WASM)
}});                                                     // persisted to IndexedDB / OPFS
```

All backends implement the same `Store` interface (`init/get/put/delete/list/clear`),
so swapping storage never touches engine or client code.

### Registering definitions

Workflow and task definitions use **exactly the same JSON** as Conductor OSS.

```js
// Task definition (for SIMPLE worker tasks).
await client.metadataResource.registerTaskDefs([
  { name: 'shipping_info', retryCount: 3, retryLogic: 'EXPONENTIAL_BACKOFF',
    retryDelaySeconds: 5, timeoutSeconds: 300, timeoutPolicy: 'TIME_OUT_WF' },
]);

// Workflow definition.
await client.metadataResource.updateWorkflowDefs([{
  name: 'mail_a_box',
  version: 1,
  ownerEmail: 'dev@example.com',
  tasks: [
    { name: 'shipping_info', taskReferenceName: 'shipping_info_ref', type: 'SIMPLE',
      inputParameters: { account: '${workflow.input.accountNumber}' } },
    { name: 'shipping_task', taskReferenceName: 'shipping_task_ref', type: 'SIMPLE',
      inputParameters: { address: '${shipping_info_ref.output.address}' } },
  ],
  outputParameters: { trackingNumber: '${shipping_task_ref.output.trackingNumber}' },
  failureWorkflow: 'shipping_issues',
}]);
```

### Running workers

A `ConductorWorker` polls a task type, runs your function, and reports the result.

```js
const worker = new ConductorWorker({
  taskType: 'shipping_info',
  baseURL: '/api',              // points at the in-browser engine
  workerId: 'worker-1',         // optional; auto-generated if omitted
  domain: null,                 // optional task domain
  concurrency: 2,               // tasks in flight
  pollInterval: 1000,           // ms between polls
  executeTask: async (input) => ({ address: '…', city: '…' }), // your logic
});
worker.start();   // begin polling
worker.stop();    // stop polling
```

Throw from `executeTask` to fail the task; the engine applies retry/failure
semantics automatically.

### Starting & managing workflows

```js
// Start (async) — returns the workflow id.
const id = await client.workflowResource.startWorkflow({ name: 'mail_a_box', version: 1, input: { accountNumber: 'ACC-1' } });

// Idempotent start — same key returns the same execution.
const id2 = await client.workflowResource.startWorkflow({
  name: 'mail_a_box', version: 1, input: { accountNumber: 'ACC-1' },
  idempotencyKey: 'ACC-1', idempotencyStrategy: 'RETURN_EXISTING',
});

// Start and wait for completion (synchronous execution).
const result = await client.workflowResource.executeWorkflow('mail_a_box', 1, { accountNumber: 'ACC-1' }, { waitForSeconds: 30 });

// Inspect.
const wf = await client.workflowResource.getWorkflow(id, true);
const status = await client.workflowResource.getWorkflowStatus(id);
const tasks = await client.workflowResource.getWorkflowTasks(id);

// Look up executions by correlation id (single / batch).
const correlated = await client.workflowResource.getWorkflows('mail_a_box', 'order-123', true, false);
const byIds = await client.workflowResource.getWorkflowsByCorrelationIds('mail_a_box', ['order-123', 'order-456'], true, false);

// Manage.
await client.workflowResource.pause(id);
await client.workflowResource.resume(id);
await client.workflowResource.retry(id);
await client.workflowResource.restart(id, true);
await client.workflowResource.terminate(id, 'cancelled by user');
await client.workflowResource.remove(id);

// Search.
await client.workflowResource.search({ query: "workflowType = 'mail_a_box' AND status = 'COMPLETED'", size: 20 });
```

### The client SDK

`ConductorClient` mirrors the Conductor SDK resource layout:

| Resource | Methods |
| --- | --- |
| `client.metadataResource` | `registerWorkflowDef`, `updateWorkflowDefs`, `getWorkflowDef`, `getAllWorkflowDefs`, `unregisterWorkflowDef`, `registerTaskDefs`, `updateTaskDef`, `getTaskDef`, `getAllTaskDefs`, `unregisterTaskDef` |
| `client.workflowResource` | `startWorkflow`, `startWorkflowByName`, `executeWorkflow`, `getWorkflow`, `getWorkflowStatus`, `getWorkflowTasks`, `getRunningWorkflow`, `getWorkflows`, `getWorkflowsByCorrelationIds`, `pause`, `resume`, `restart`, `retry`, `rerun`, `terminate`, `remove`, `search` |
| `client.taskResource` | `getTask`, `poll`, `batchPoll`, `updateTask`, `updateTaskV2`, `updateTaskByRef`, `log`, `getLogs`, `search` |
| `client.queueResource` | `getQueueSizes` |
| `client.eventResource` | `registerHandler`, `getHandlers`, `getHandler`, `unregisterHandler` |

`ConductorClient` just wraps `fetch`, so **any** Conductor SDK or hand-rolled
`fetch('/api/...')` client works identically once `patchFetch` is active.

### The REST API

The engine implements these routes (all relative to `/api`):

**Metadata**
```
GET    /metadata/workflow                    list definitions
POST   /metadata/workflow                    create definition
PUT    /metadata/workflow                    create-or-update (bulk)
GET    /metadata/workflow/{name}             get by name (?version=)
DELETE /metadata/workflow/{name}/{version}   delete
POST   /metadata/workflow/validate           validate without saving
GET    /metadata/workflow/names              distinct names
GET    /metadata/workflow/names-and-versions
GET    /metadata/workflow/{name}/versions
GET    /metadata/workflow/latest-versions

GET/POST/PUT/DELETE /metadata/taskdefs[/{taskType}]
```

**Start / execute**
```
POST /workflow                                 start (async) → plain-text id
POST /workflow/{name}                          start by name (input as body)
POST /workflow/execute/{name}/{version}        start + wait for completion
```

`POST /workflow` accepts a `StartWorkflowRequest` body. In addition to
`name`, `version`, `input`, `correlationId`, `priority`, `taskToDomain`, and
`workflowDef`, it supports Conductor's idempotency fields:

| Field | Values | Meaning |
| --- | --- | --- |
| `idempotencyKey` | string | User-generated key, scoped to the workflow name, that deduplicates executions. |
| `idempotencyStrategy` | `FAIL`, `RETURN_EXISTING`, `FAIL_ON_RUNNING` | How to behave when a workflow with the same key already exists. |

- `FAIL` (default) — start only if no execution with the key exists (running or completed); otherwise `409`.
- `RETURN_EXISTING` — return the existing workflow's id instead of starting a new one.
- `FAIL_ON_RUNNING` — only `RUNNING`/`PAUSED` executions conflict; terminal executions can run again.

The path form `POST /workflow/{name}` accepts the same values via the
`X-Idempotency-key` and `X-on-conflict` headers.

> **Note on OSS parity.** Upstream Conductor OSS declares `idempotencyKey` /
> `idempotencyStrategy` but does not currently enforce them over the public
> REST surface (see conductor-oss issue #1527); the strategy semantics are
> documented by Orkes. This engine implements and enforces all three strategies
> — a deliberate, stricter divergence — and the check-and-reserve is atomic
> (no `await` between decide and reserve), so concurrent starts with the same
> key cannot both create a workflow.

**Workflow management**
```
GET    /workflow/{workflowId}                  (?includeTasks=true)
GET    /workflow/{workflowId}/status           (?includeOutput, ?includeVariables)
GET    /workflow/{workflowId}/tasks            (?start, ?count, ?status)
GET    /workflow/running/{name}                (?version, ?startTime, ?endTime)
GET    /workflow/{name}/correlated/{correlationId}
POST   /workflow/{name}/correlated             (list of correlation ids)
PUT    /workflow/{workflowId}/pause | /resume
POST   /workflow/{workflowId}/restart | /retry | /rerun
PUT    /workflow/{workflowId}/skiptask/{taskReferenceName}
PUT    /workflow/decide/{workflowId}
DELETE /workflow/{workflowId}                  terminate (?reason)
DELETE /workflow/{workflowId}/remove           (?archiveWorkflow)
DELETE /workflow/{workflowId}/terminate-remove
GET    /workflow/search | /search-v2           (?query, ?freeText, ?start, ?size, ?sort)
```

**Tasks**
```
GET    /tasks/{taskId}
GET    /tasks/poll/{taskType}                  (?workerid, ?domain) — 204 if empty
GET    /tasks/poll/batch/{taskType}            (?count, ?timeout)
POST   /tasks                                  update result → plain-text task id
POST   /tasks/update-v2                        update + next task in one call
POST   /tasks/{workflowId}/{taskRefName}/{status}[/sync]
POST   /tasks/{taskId}/log | GET /tasks/{taskId}/log
GET    /tasks/queue/all | /queue/all/verbose | /queue/size
POST   /tasks/queue/requeue/{taskType}
GET    /tasks/search | /search-v2
```

**Events / queues / health**
```
GET/POST/PUT/DELETE /event[/{event}]
GET    /queue/all | /queue/all/verbose | /queue/size | /queue/sizes
GET    /health
```

### The control plane

The control plane (`/cossb/…`) is a static SPA that boots its own engine (sharing
`localStorage` with the demo on the same origin) and manages it over the same REST API.

| Screen | Path | What it does |
| --- | --- | --- |
| **Executions** | `/cossb/executions` | List, filter (name/status/free text), paginate, and **start** workflows. Click a row to open the detail. Auto-refreshes every 3s. |
| **Execution detail** | `/cossb/workflow/{id}` | Metadata, input/output JSON, task list, and actions: **Pause / Resume / Retry / Restart / Terminate / Remove**. |
| **Workflow Definitions** | `/cossb/workflows` | Registered workflow blueprints (name, version, description, owner, task count). |
| **Task Definitions** | `/cossb/tasks` | Registered task definitions and their retry/timeout settings. |
| **Queues** | `/cossb/queues` | Pending task counts per task type. |

Navigation is client-side (History API). The top-level routes are physical
directories (so they work with any static server); `npm run serve` additionally
rewrites unknown `/cossb/*` paths (like `/cossb/workflow/{id}`) to the SPA shell
so detail deep-links and refreshes resolve too.

---

## How it works

### Architecture

The engine is a faithful, in-memory re-implementation of Conductor's core:

| Component | File | Role |
| --- | --- | --- |
| **Decider** | `src/engine/decider.js` | The state machine. Walks a workflow definition, evaluates operators, and decides which tasks to schedule. |
| **Server** | `src/engine/server.js` | Orchestration: workflow/task lifecycle, queues, retries, timeouts, failure handling, search, events. |
| **System tasks** | `src/engine/system-tasks.js` | Executors for `HTTP`, `INLINE`, `NOOP`, `JSON_JQ_TRANSFORM`, `EVENT`. |
| **API** | `src/api/http.js` | The Conductor REST router + handlers. |
| **Client/Worker** | `src/client/` | `ConductorClient` (SDK) and `ConductorWorker` (poll/execute/report). |
| **Store** | `src/store/` | `memory`, `localstorage`, `sqlite` adapters. |
| **Expressions** | `src/expression.js` | `${…}` template substitution and a JSONPath subset. |
| **Service worker** | `src/serviceworker/sw.js` | Relays real `/api/*` HTTP to the page-hosted engine. |

Unlike Conductor's multi-service deployment (API server, decider, sweeper, DB,
queue, index as separate processes), everything here lives in one process (the
page) and one `ConductorServer` instance — the decider and sweeper are just
methods and a `setInterval`.

### Data model

Three kinds of objects are persisted (as JSON documents in the store):

1. **Workflow definition** (`workflowDefs`) — the blueprint: `name`, `version`,
   `tasks[]`, `inputParameters`, `outputParameters`, `inputTemplate`,
   `failureWorkflow`, `timeoutSeconds`, `timeoutPolicy`, `schemaVersion`, …
2. **Task definition** (`taskDefs`) — registered worker-task config: `name`,
   `retryCount`, `retryLogic`, `retryDelaySeconds`, `timeoutSeconds`,
   `timeoutPolicy`, `responseTimeoutSeconds`, …
3. **Workflow execution** (`workflows`) — a running/finished instance:
   `workflowId`, `workflowName`, `workflowVersion`, `status`, `input`, `output`,
   `variables`, `tasks[]` (the task records), `deciderState`, `startTime`,
   `endTime`, `reasonForIncompletion`, …

Each **task record** carries `taskId`, `referenceTaskName`, `taskType` (the
task-definition name for `SIMPLE`/`HUMAN`; the system type otherwise), `type`
(the execution type), `status`, `inputData`, `outputData`, `seq` (attempt),
`retryCount`, `workerId`, timestamps, `iteration`, `optional`, `asyncComplete`.

Workflow statuses: `RUNNING`, `PAUSED`, `COMPLETED`, `FAILED`, `TIMED_OUT`, `TERMINATED`.
Task statuses: `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `COMPLETED_WITH_ERRORS`,
`FAILED`, `FAILED_WITH_TERMINAL_ERROR`, `TIMED_OUT`, `SKIPPED`, `CANCELED`.

### The decider (state machine)

`Decider.next(workflow, def)` is the heart of the engine. It walks the workflow's
flat `tasks[]` list **in order** and, for each task:

- **Already terminal** → skip and continue.
- **`SCHEDULED` / `IN_PROGRESS`** → block the walk here (linear dependency).
- **Not started** → handle by type:
  - *Leaf* (`SIMPLE`, `HTTP`, `INLINE`, …) → mark ready to schedule.
  - *Operator* → evaluated inline (see below).

It returns a bundle of actions — ready leaves to schedule, sub-workflows to
start, a termination directive — plus flags (`progress`, `completed`). The server
applies these and loops until the workflow is blocked or complete.

Synchronous operators (e.g. `SET_VARIABLE`) mutate the workflow **during** the
walk, and the evaluation context is rebuilt lazily so later tasks see the new
state — this is why `${set_ref.output.x}` resolves correctly for the next task.

### Operators

| Operator | Behavior |
| --- | --- |
| `FORK_JOIN` | Starts every branch's leading tasks in parallel, then completes itself. |
| `JOIN` | Waits until all `joinOn` refs are terminal (or, for `EXCLUSIVE_JOIN`, any one). |
| `SWITCH` | Evaluates a case value (`value-param` via `switchCaseValue`/`switchCaseExpression`, or `javascript` via `expression`) and follows the matching `decisionCases` list, else `defaultCase`. |
| `DO_WHILE` | Runs `loopOver`, then evaluates `loopCondition` (with `$.<ref>.output` in scope); loops while true. |
| `SUB_WORKFLOW` | Starts a child workflow (tracked via `parentWorkflowId`/`parentWorkflowTaskId`); resumes the parent when the child reaches a terminal state. |
| `START_WORKFLOW` | Fire-and-forget child workflow. |
| `SET_VARIABLE` | Merges input into workflow `variables` and completes synchronously. |
| `TERMINATE` | Ends the workflow with a chosen status/output. |
| `DYNAMIC` | Resolves the task name from input (`dynamicTaskNameParam`) and schedules it under the same reference. |
| `DYNAMIC_FORK` | Expands a list of tasks/inputs into parallel child tasks. |

### System tasks

- **`HTTP`** — executed with `fetch`. Input may be Conductor's `http_request`
  object (`uri`, `method`, `headers`, `body`) or a flattened `uri`/`method`/`headers`/`body`.
  Output mirrors Conductor: `{ response: { statusCode, headers, body, reason }, statusCode, reason, body, headers }`.
- **`INLINE`** — `evaluatorType: 'javascript'` with an `expression` evaluated in a
  sandbox (`new Function`) with the task input in scope as `input`/`$`.
- **`NOOP`** — output equals input.
- **`JSON_JQ_TRANSFORM`** — minimal JSONPath-based transform (subset of jq).
- **`EVENT`** — publishes into the in-browser event bus.
- **`WAIT`** — completed externally via `POST /tasks/{workflowId}/{taskRefName}/{status}`.

### Workers & queues

`SIMPLE`/`HUMAN` tasks are placed in an in-memory **queue keyed by task name**
(not by `SIMPLE`). A worker polls:

```
GET /api/tasks/poll/{taskType}?workerid=…&domain=…
   → 200 + task (status becomes IN_PROGRESS), or 204 if empty

POST /api/tasks  { workflowInstanceId, taskId, status, outputData, … }
   → engine applies the result and re-runs the decider
```

`WAIT` tasks are **not** queued; they stay `IN_PROGRESS` until an external
signal completes them by reference name. `startDelay` and `callbackAfterSeconds`
put tasks on a delayed list that the sweeper promotes when their time arrives.

### Failure handling & retries

When a task fails:

1. If `optional: true` → status becomes `COMPLETED_WITH_ERRORS` and the workflow continues.
2. Else, if `retryCount` remains → a **new attempt** (higher `seq`) is scheduled
   after a delay computed from `retryLogic`:
   - `FIXED` → `retryDelaySeconds`
   - `EXPONENTIAL_BACKOFF` → `max(10, base) * 2^(attempt-1)`
   - `LINEAR_BACKOFF` → `base * attempt`
3. Else the workflow **fails**, recording `reasonForIncompletion`,
   `failedReferenceTaskNames`, and — if configured — starting the
   `failureWorkflow` (which receives the original input plus `workflowId`,
   `reason`, `failureStatus`, `failureTaskId`).

The sweeper enforces workflow `timeoutSeconds` (`TIMED_OUT` unless `ALERT_ONLY`)
and task `timeoutSeconds` (`RETRY` → retry, `TIME_OUT_WF` → fail the workflow).

### Expressions

`inputParameters`/`outputParameters`/`inputTemplate` support Conductor's
`${…}` syntax: a value that is *exactly* one expression returns the raw JSONPath
result (object/array preserved); embedded expressions are string-concatenated.
The evaluation root exposes `workflow.{input,output,variables,…}` and one key per
completed task reference name (`{input,output}`). `inputExpression` evaluates a
bare JSONPath (no `${}`) to select an entire object. `$${…}` escapes a literal.

### Persistence

The engine keeps hot state in memory and persists document snapshots through the
store. `LocalStorageStore` serializes the whole DB into one key
(`conductor.browser.db.v1`) on every mutation (optionally debounced);
`SqliteStore` writes rows through sql.js and persists the DB file to
IndexedDB/OPFS; `MemoryStore` persists nothing. On boot, the server rebuilds its
task index and queues from the persisted workflows.

### Lifecycle (event loop & sweeper)

1. `startWorkflow` creates a `RUNNING` execution and invokes the decider.
2. The decider schedules ready tasks. Synchronous system/operator tasks execute
   immediately within the decide loop; `SIMPLE` tasks enter the queue; `HTTP`
   tasks run asynchronously and re-trigger the decider on completion.
3. A `setInterval` sweeper promotes delayed tasks and enforces timeouts.
4. Decide calls are serialized per workflow (re-entrant-safe) to avoid races
   between concurrent completions.

The engine also emits events (`workflow.started`, `task.completed`,
`workflow.failed`, `task.retried`, …) via `server.onEvent(fn)`.

---

## Supported task types

| Type | Notes |
| --- | --- |
| `SIMPLE` / `HUMAN` | Worker-executed; retries, timeouts, `optional`, `startDelay`, `asyncComplete`, `callbackAfterSeconds`. |
| `HTTP` | `fetch`-based system task. |
| `INLINE` | JavaScript `expression` evaluated in a sandbox. |
| `NOOP` | Passthrough. |
| `SET_VARIABLE` | Set workflow variables (synchronous). |
| `SWITCH` | `value-param` / `javascript` evaluators. |
| `FORK_JOIN` + `JOIN` / `EXCLUSIVE_JOIN` | Parallel branches and joins. |
| `DO_WHILE` | Loop over `loopOver` while `loopCondition` holds. |
| `SUB_WORKFLOW` | Child workflow, awaited. |
| `START_WORKFLOW` | Child workflow, fire-and-forget. |
| `DYNAMIC` / `DYNAMIC_FORK` | Dynamic task resolution / expansion. |
| `TERMINATE` | End the workflow with a status/output. |
| `JSON_JQ_TRANSFORM` | JSONPath subset (jq). |
| `WAIT` | Completed externally by reference name. |
| `EVENT` | Publish to the event bus. |

---

## Project layout

```
src/
  engine/          decider.js (state machine), server.js (orchestration),
                   system-tasks.js, model.js
  api/             http.js — Conductor REST router + handlers
  client/          client.js (ConductorClient), worker.js (ConductorWorker)
  store/           memory.js, localstorage.js, sqlite.js, index.js
  serviceworker/   sw.js — HTTP relay
  expression.js    ${...} / JSONPath evaluation
  enums.js         Conductor statuses & task types
  errors.js        error types with HTTP mapping
  ids.js           id generation
  index.js         public API
cossb/            control-plane SPA (served at /cossb/…)
demo/              getting-started demo (served at /)
test/              node --test suites
scripts/           build.mjs (esbuild) + serve.mjs (static server)
types/             TypeScript declarations
dist/              built bundles (IIFE/ESM/CJS + sw + types)
```

---

## Development

```bash
npm install
npm test          # node --test  (17 suites)
npm run build     # bundles dist/ and vendors into demo/vendor + cossb/vendor
npm run serve     # http://localhost:4173  (demo + control plane)
```

---

## Limitations & notes

- **In-memory concurrency.** Everything runs in one page; there is no horizontal
  scaling, no real queue/index backend, and no cross-tab coordination beyond
  shared `localStorage` (two live tabs can race on writes — open one at a time,
  or use the demo/console sequentially).
- **Storage size.** `localStorage` is ~5 MB; use the `sqlite` backend for larger
  datasets.
- **Expression engine.** `${…}` and JSONPath cover the common `jayway/JsonPath`
  subset (`dot`, `[]`, `[*]`); advanced features (filters, `..`, functions) are
  not implemented. `JSON_JQ_TRANSFORM` is a minimal subset of jq.
- **HTTP task.** Executed with the browser's `fetch`, so it is subject to CORS
  and the page's CSP.
- **`INLINE` / `javascript` operators** use `new Function`; a restrictive CSP
  (`script-src` without `'unsafe-eval'`) will block them.
- **Service worker** requires a secure context (https/localhost). `patchFetch`
  (the default) works everywhere, including `file://`.
- **`EXCLUSIVE_JOIN`, `DO_WHILE`, `DYNAMIC_FORK`, `JSON_JQ_TRANSFORM`, `EVENT`**
  are implemented for the common cases; edge-case semantics may differ from a
  full Conductor deployment.
- **`install()`** takes **`storeOptions`** (not `storageOptions`): pass
  `{ storageKey, storage, debounceMs }` for the `localStorage` store, or
  `{ wasmUrl }` for `sqlite`.
- **Persistence timing.** `LocalStorageStore` with `debounceMs > 0` delays the
  write; call `await store.flush()` on `pagehide`/`beforeunload` to avoid losing
  un-flushed state on reload.
- **Reload leaves in-flight work stranded.** A task a worker has already polled
  (and is `IN_PROGRESS`) is not re-queued on reload, so it stays stuck unless its
  taskdef has `timeoutSeconds` + `timeoutPolicy: RETRY`. Set those on every
  worker taskdef.
- **`includeClosed`** on the correlation lookup returns only `RUNNING`
  workflows when `false` (it does not include `PAUSED`), while `FAIL_ON_RUNNING`
  idempotency blocks on both `RUNNING` and `PAUSED`.
- **`sqlite` store** returns JSON-parsed copies from `get()` (the `memory` and
  `localStorage` stores return live references). Prefer those backends for the
  demo; the engine is tested against them.
- **`DECISION`** is accepted as an alias for `SWITCH`.

---

## License

Apache-2.0. This is an independent re-implementation of the Conductor OSS API
surface; Conductor is a trademark of its respective owners.
