import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConductorServer, MemoryStore } from '../src/index.js';
import { ConflictError } from '../src/errors.js';
import { WorkflowStatus } from '../src/enums.js';

async function newServer() {
  return (await import('../src/index.js')).createServer({ store: 'memory', sweeperIntervalMs: 0 });
}

async function serverWithRunningWorkflow() {
  // A WAIT task keeps the workflow RUNNING so FAIL_ON_RUNNING must block.
  const server = await newServer();
  await server.registerWorkflowDef({
    name: 'wf', version: 1,
    tasks: [{ name: 'w', taskReferenceName: 'w_ref', type: 'WAIT' }],
  });
  return server;
}

test('FAIL_ON_RUNNING is atomic under concurrency (2 callers)', async () => {
  const server = await serverWithRunningWorkflow();
  const results = await Promise.allSettled([
    server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL_ON_RUNNING' }),
    server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL_ON_RUNNING' }),
  ]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1, 'exactly one start should succeed');
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1, 'one start should conflict');
  assert.ok(results.find((r) => r.status === 'rejected').reason instanceof ConflictError);

  const res = await server.searchWorkflows({ query: "workflowType = 'wf'" });
  assert.equal(res.totalHits, 1, 'only one workflow must be created');
});

test('more than two concurrent FAIL_ON_RUNNING starts still create one workflow', async () => {
  const server = await serverWithRunningWorkflow();
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL_ON_RUNNING' })
    )
  );

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 4);
  const res = await server.searchWorkflows({ query: "workflowType = 'wf'" });
  assert.equal(res.totalHits, 1);
});

test('RETURN_EXISTING returns the same id under concurrency', async () => {
  const server = await serverWithRunningWorkflow();
  const results = await Promise.allSettled([
    server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'RETURN_EXISTING' }),
    server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'RETURN_EXISTING' }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.equal(fulfilled.length, 2, 'both RETURN_EXISTING calls should succeed');
  assert.equal(fulfilled[0].value, fulfilled[1].value, 'both should return the same id');

  const res = await server.searchWorkflows({ query: "workflowType = 'wf'" });
  assert.equal(res.totalHits, 1);
});

test('a failed start releases the idempotency reservation', async () => {
  const store = new MemoryStore();
  let failNext = true;
  const originalPut = store.put.bind(store);
  store.put = async (collection, key, value) => {
    if (collection === 'workflows' && failNext) {
      failNext = false;
      throw new Error('injected put failure');
    }
    return originalPut(collection, key, value);
  };

  const server = new ConductorServer({ store, sweeperIntervalMs: 0 });
  await server.init();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  await assert.rejects(
    () => server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL' }),
    /injected put failure/
  );

  // The reservation must have been released so the key is not wedged.
  const id = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL' });
  assert.ok(id);
});

test('a completed workflow does not block FAIL_ON_RUNNING', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  const id1 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL_ON_RUNNING' });
  assert.equal((await server.getWorkflow(id1)).status, WorkflowStatus.COMPLETED);

  // The completed workflow must not block a new FAIL_ON_RUNNING start.
  const id2 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL_ON_RUNNING' });
  assert.notEqual(id1, id2);

  const res = await server.searchWorkflows({ query: "workflowType = 'wf'" });
  assert.equal(res.totalHits, 2, 'a completed workflow should allow a re-run');
});
