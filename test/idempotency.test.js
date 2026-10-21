import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, ConductorClient, handleHttpRequest, toFetchResponse } from '../src/index.js';
import { ConflictError, BadRequestError } from '../src/errors.js';
import { WorkflowStatus } from '../src/enums.js';

async function newServer() {
  return createServer({ store: 'memory', sweeperIntervalMs: 0 });
}

test('idempotency FAIL conflicts on duplicate (running or completed)', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  const id1 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'FAIL' });
  await assert.rejects(
    () => server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'FAIL' }),
    ConflictError
  );

  // A different key (or different workflow) is allowed.
  const id2 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k2', idempotencyStrategy: 'FAIL' });
  assert.notEqual(id1, id2);
});

test('idempotency RETURN_EXISTING returns the existing workflow id', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  const id1 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'RETURN_EXISTING' });
  const id2 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'RETURN_EXISTING' });
  assert.equal(id1, id2);

  const res = await server.searchWorkflows({ query: "workflowType = 'wf'" });
  assert.equal(res.totalHits, 1, 'RETURN_EXISTING must not start a new execution');
});

test('idempotency FAIL_ON_RUNNING only blocks running workflows', async () => {
  const server = await newServer();
  await server.registerTaskDefs([{ name: 'worker_task', retryCount: 0 }]);
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 'worker_task', taskReferenceName: 't_ref', type: 'SIMPLE' }] });

  const id1 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'FAIL_ON_RUNNING' });
  await assert.rejects(
    () => server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'FAIL_ON_RUNNING' }),
    ConflictError
  );

  await server.terminate(id1);
  const id2 = await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'FAIL_ON_RUNNING' });
  assert.notEqual(id1, id2, 'terminal workflow with the same key can run again');
});

test('idempotency defaults to FAIL when strategy is omitted', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  await server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1' });
  await assert.rejects(() => server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1' }), ConflictError);
});

test('idempotency rejects an invalid strategy', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  await assert.rejects(
    () => server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k1', idempotencyStrategy: 'BOGUS' }),
    BadRequestError
  );
});

test('client startWorkflow honors idempotency and exposes correlated lookup', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  // Route fetch -> engine so the client talks over the REST surface.
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    const res = await handleHttpRequest(
      { method, url, body: init && init.body, headers: init && init.headers },
      server,
      { basePath: '/api' }
    );
    return toFetchResponse(res);
  };

  const client = new ConductorClient({ baseURL: '/api' });

  // Idempotency over the request-body start path.
  await client.workflowResource.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL' });
  await assert.rejects(
    () => client.workflowResource.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL' }),
    (e) => e.status === 409
  );

  // Correlated lookup (single + batch).
  await client.workflowResource.startWorkflow({ name: 'wf', version: 1, correlationId: 'corr-1' });
  await client.workflowResource.startWorkflow({ name: 'wf', version: 1, correlationId: 'corr-1' });
  await client.workflowResource.startWorkflow({ name: 'wf', version: 1, correlationId: 'corr-2' });

  const single = await client.workflowResource.getWorkflows('wf', 'corr-1', true, false);
  assert.equal(single.length, 2);

  const batch = await client.workflowResource.getWorkflowsByCorrelationIds('wf', ['corr-1', 'corr-2'], true, false);
  assert.equal(batch['corr-1'].length, 2);
  assert.equal(batch['corr-2'].length, 1);

  globalThis.fetch = undefined;
});
