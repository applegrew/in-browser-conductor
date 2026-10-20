import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, handleHttpRequest } from '../src/index.js';

async function req(server, method, url, body) {
  const res = await handleHttpRequest(
    { method, url, body: body === undefined ? null : JSON.stringify(body) },
    server,
    { basePath: '/api' }
  );
  let parsed = null;
  if (res.body != null) {
    try { parsed = JSON.parse(res.body); } catch { parsed = null; }
  }
  return { status: res.status, body: parsed, raw: res.body };
}

test('metadata workflow lifecycle via HTTP', async () => {
  const server = await createServer({ store: 'memory', sweeperIntervalMs: 0 });

  let r = await req(server, 'GET', '/api/metadata/workflow');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);

  r = await req(server, 'POST', '/api/metadata/workflow', {
    name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'SIMPLE' }],
  });
  assert.equal(r.status, 200);

  r = await req(server, 'GET', '/api/metadata/workflow/wf?version=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'wf');

  r = await req(server, 'GET', '/api/metadata/workflow/names');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, ['wf']);

  r = await req(server, 'GET', '/api/metadata/workflow/names-and-versions');
  assert.deepEqual(r.body.wf, [{ name: 'wf', version: 1 }]);
});

test('taskdefs lifecycle via HTTP', async () => {
  const server = await createServer({ store: 'memory', sweeperIntervalMs: 0 });

  let r = await req(server, 'POST', '/api/metadata/taskdefs', [{ name: 't', retryCount: 0 }]);
  assert.equal(r.status, 200);

  r = await req(server, 'GET', '/api/metadata/taskdefs/t');
  assert.equal(r.body.name, 't');
  assert.equal(r.body.retryCount, 0);

  r = await req(server, 'GET', '/api/metadata/taskdefs');
  assert.equal(r.body.length, 1);
});

test('start workflow returns plain-text id, then status and get', async () => {
  const server = await createServer({ store: 'memory', sweeperIntervalMs: 0 });
  await req(server, 'POST', '/api/metadata/workflow', {
    name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }],
  });

  const start = await req(server, 'POST', '/api/workflow', { name: 'wf', version: 1, input: { a: 1 } });
  assert.equal(start.status, 200);
  const id = start.raw; // plain text

  const get = await req(server, 'GET', `/api/workflow/${id}`);
  assert.equal(get.status, 200);
  assert.equal(get.body.workflowId, id);
  assert.equal(get.body.status, 'COMPLETED');

  const status = await req(server, 'GET', `/api/workflow/${id}/status`);
  assert.equal(status.body.status, 'COMPLETED');
});

test('poll + update task + queue sizes via HTTP', async () => {
  const server = await createServer({ store: 'memory', sweeperIntervalMs: 0 });
  await req(server, 'POST', '/api/metadata/taskdefs', [{ name: 't', retryCount: 0 }]);
  await req(server, 'POST', '/api/metadata/workflow', {
    name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'SIMPLE' }],
  });

  const start = await req(server, 'POST', '/api/workflow', { name: 'wf', version: 1 });
  const id = start.raw;

  let sizes = await req(server, 'GET', '/api/tasks/queue/all');
  assert.equal(sizes.body.t, 1);

  const poll = await req(server, 'GET', '/api/tasks/poll/t?workerid=w1');
  assert.equal(poll.status, 200);
  assert.equal(poll.body.taskType, 't');

  const update = await req(server, 'POST', '/api/tasks', {
    workflowInstanceId: id, taskId: poll.body.taskId, status: 'COMPLETED', outputData: { ok: true },
  });
  assert.equal(update.raw, poll.body.taskId);

  const get = await req(server, 'GET', `/api/workflow/${id}`);
  assert.equal(get.body.status, 'COMPLETED');
});

test('search workflows by query', async () => {
  const server = await createServer({ store: 'memory', sweeperIntervalMs: 0 });
  await req(server, 'POST', '/api/metadata/workflow', {
    name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }],
  });
  await req(server, 'POST', '/api/workflow', { name: 'wf', version: 1 });

  const r = await req(server, 'GET', '/api/workflow/search?query=workflowType%20%3D%20%27wf%27%20AND%20status%20%3D%20%27COMPLETED%27');
  assert.equal(r.body.totalHits, 1);
  assert.equal(r.body.results[0].workflowType, 'wf');
});

test('unknown endpoint returns 404', async () => {
  const server = await createServer({ store: 'memory', sweeperIntervalMs: 0 });
  const r = await req(server, 'GET', '/api/nope');
  assert.equal(r.status, 404);
});
