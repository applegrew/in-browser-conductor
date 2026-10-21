import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, ConductorServer, MemoryStore } from '../src/index.js';
import { ConflictError } from '../src/errors.js';
import { WorkflowStatus } from '../src/enums.js';

async function newServer() {
  return createServer({ store: 'memory', sweeperIntervalMs: 0 });
}

test('U7: START_WORKFLOW launches the child once and completes the parent', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'child', version: 1, tasks: [{ name: 'c', taskReferenceName: 'c_ref', type: 'NOOP' }] });
  await server.registerWorkflowDef({
    name: 'parent', version: 1,
    tasks: [{ name: 'start_child', taskReferenceName: 'start_ref', type: 'START_WORKFLOW',
      inputParameters: { startWorkflow: { name: 'child', version: 1, input: {} } } }],
  });

  const id = await server.startWorkflow({ name: 'parent', version: 1, input: {} });
  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED, 'parent should complete, not hang');

  const startRec = wf.tasks.find((t) => t.referenceTaskName === 'start_ref');
  assert.ok(startRec, 'START_WORKFLOW must write a task record');
  assert.equal(startRec.status, 'COMPLETED');
  assert.ok(startRec.outputData.workflowId, 'record should carry the child id');

  const children = await server.searchWorkflows({ query: "workflowType = 'child'" });
  assert.equal(children.totalHits, 1, 'child must be started exactly once');
});

test('U6: START_WORKFLOW forwards correlationId and a failing child does not fail the parent', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'child', version: 1, tasks: [{ name: 'c', taskReferenceName: 'c_ref', type: 'NOOP' }] });
  await server.registerWorkflowDef({
    name: 'parent', version: 1,
    tasks: [{ name: 'start_child', taskReferenceName: 'start_ref', type: 'START_WORKFLOW',
      inputParameters: { startWorkflow: { name: 'child', version: 1, correlationId: 'corr-child', input: {} } } }],
  });

  const id = await server.startWorkflow({ name: 'parent', version: 1, input: {} });
  const parent = await server.getWorkflow(id);
  assert.equal(parent.status, WorkflowStatus.COMPLETED);

  const children = await server.getWorkflowsByCorrelationId('child', 'corr-child', true, false);
  assert.equal(children.length, 1, 'child should carry the correlationId');
});

test('U1+U1b: DO_WHILE iterates and body operators carry the iteration', async () => {
  const server = await newServer();
  await server.registerTaskDefs([{ name: 'body_task', retryCount: 0 }]);
  await server.registerWorkflowDef({
    name: 'loop_wf', version: 1,
    tasks: [{
      type: 'DO_WHILE',
      taskReferenceName: 'loop_ref',
      loopCondition: '$.body_ref.output.count < 2',
      loopOver: [
        { name: 'marker', taskReferenceName: 'marker_ref', type: 'SET_VARIABLE', inputParameters: { marked: true } },
        { name: 'body_task', taskReferenceName: 'body_ref', type: 'SIMPLE', inputParameters: { prev: '${body_ref.output.count}' } },
      ],
    }],
  });

  const id = await server.startWorkflow({ name: 'loop_wf', version: 1, input: {} });

  for (let expected = 0; expected < 2; expected++) {
    const task = await server.poll('body_task');
    assert.ok(task, `expected iteration ${expected} body task`);
    const prev = (task.inputData && task.inputData.prev) || 0;
    assert.equal(prev, expected);
    await server.updateTask({ taskId: task.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: { count: expected + 1 } });
  }

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
  assert.equal(wf.tasks.filter((t) => t.referenceTaskName === 'body_ref').length, 2, 'two body iterations');
  assert.equal(wf.tasks.filter((t) => t.referenceTaskName === 'marker_ref').length, 2, 'two operator iterations');
});

test('U8: concurrent idempotent starts launch only one workflow', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({ name: 'wf', version: 1, tasks: [{ name: 't', taskReferenceName: 't_ref', type: 'NOOP' }] });

  const results = await Promise.allSettled([
    server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL' }),
    server.startWorkflow({ name: 'wf', version: 1, idempotencyKey: 'k', idempotencyStrategy: 'FAIL' }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one start should succeed');
  assert.equal(rejected.length, 1, 'one start should conflict');
  assert.ok(rejected[0].reason instanceof ConflictError);

  const res = await server.searchWorkflows({ query: "workflowType = 'wf'" });
  assert.equal(res.totalHits, 1, 'only one workflow must be created');
});

test('U3: a timed-out optional WAIT continues the workflow', async () => {
  let now = 1_000_000;
  const store = new MemoryStore();
  const server = new ConductorServer({ store, now: () => now, sweeperIntervalMs: 0 });
  await server.init();

  await server.registerTaskDefs([{ name: 'wait_task', retryCount: 0, timeoutSeconds: 1, timeoutPolicy: 'TIME_OUT_WF' }]);
  await server.registerWorkflowDef({
    name: 'wf', version: 1,
    tasks: [
      { name: 'wait_task', taskReferenceName: 'wait_ref', type: 'WAIT', optional: true },
      { name: 'after', taskReferenceName: 'after_ref', type: 'NOOP' },
    ],
  });

  const id = await server.startWorkflow({ name: 'wf', version: 1, input: {} });
  assert.equal((await server.getWorkflow(id)).status, WorkflowStatus.RUNNING);

  now += 2000;
  await server._sweep();

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED, 'optional WAIT timeout should continue');
  assert.equal(wf.tasks.find((t) => t.referenceTaskName === 'wait_ref').status, 'COMPLETED_WITH_ERRORS');
});

test('DECISION is an alias for SWITCH', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({
    name: 'wf', version: 1,
    tasks: [{
      type: 'DECISION',
      taskReferenceName: 'decide_ref',
      inputParameters: { switchCaseValue: '${workflow.input.x}' },
      decisionCases: { a: [{ name: 'a', taskReferenceName: 'a_ref', type: 'NOOP' }] },
      defaultCase: [{ name: 'b', taskReferenceName: 'b_ref', type: 'NOOP' }],
    }],
  });

  const id = await server.startWorkflow({ name: 'wf', version: 1, input: { x: 'a' } });
  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
  assert.ok(wf.tasks.some((t) => t.referenceTaskName === 'a_ref'), 'should follow the matching case');
});
