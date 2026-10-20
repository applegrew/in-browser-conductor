import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/index.js';
import { WorkflowStatus, TaskStatus } from '../src/enums.js';

async function newServer() {
  return createServer({ store: 'memory', sweeperIntervalMs: 0 });
}

test('simple linear workflow completes via poll/update', async () => {
  const server = await newServer();
  await server.registerTaskDefs([{ name: 't1', retryCount: 0 }]);
  await server.registerWorkflowDef({
    name: 'wf', version: 1,
    tasks: [{ name: 't1', taskReferenceName: 't1_ref', type: 'SIMPLE', inputParameters: { a: '${workflow.input.a}' } }],
  });

  const id = await server.startWorkflow({ name: 'wf', version: 1, input: { a: 1 } });
  let wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.RUNNING);

  const task = await server.poll('t1');
  assert.ok(task, 'expected a pollable task');
  assert.equal(task.inputData.a, 1);
  assert.equal(task.status, TaskStatus.IN_PROGRESS);

  await server.updateTask({ taskId: task.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: { r: 2 } });

  wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
  assert.deepEqual(wf.output, { r: 2 });
});

test('INLINE, SET_VARIABLE and outputParameters run synchronously', async () => {
  const server = await newServer();
  await server.registerWorkflowDef({
    name: 'calc', version: 1,
    tasks: [
      { name: 'set', taskReferenceName: 'set_ref', type: 'SET_VARIABLE', inputParameters: { x: 40 } },
      { name: 'add', taskReferenceName: 'add_ref', type: 'INLINE', evaluatorType: 'javascript',
        inputParameters: { expr: '${set_ref.output.x}' }, expression: 'return input.expr + 2;' },
    ],
    outputParameters: { answer: '${add_ref.output.result}' },
  });

  const id = await server.startWorkflow({ name: 'calc', version: 1, input: {} });
  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
  assert.equal(wf.variables.x, 40);
  assert.equal(wf.output.answer, 42);
});

test('SWITCH follows the selected branch', async () => {
  const server = await newServer();
  await server.registerTaskDefs([
    { name: 'paint_red', retryCount: 0 },
    { name: 'paint_blue', retryCount: 0 },
    { name: 'finish', retryCount: 0 },
  ]);
  await server.registerWorkflowDef({
    name: 'switch_wf', version: 1,
    tasks: [
      {
        name: 'decide', taskReferenceName: 'decide_ref', type: 'SWITCH',
        inputParameters: { switchCaseValue: '${workflow.input.color}' },
        decisionCases: {
          red: [{ name: 'paint_red', taskReferenceName: 'red_ref', type: 'SIMPLE' }],
          blue: [{ name: 'paint_blue', taskReferenceName: 'blue_ref', type: 'SIMPLE' }],
        },
        defaultCase: [{ name: 'paint_blue', taskReferenceName: 'blue_ref', type: 'SIMPLE' }],
      },
      { name: 'finish', taskReferenceName: 'finish_ref', type: 'SIMPLE' },
    ],
  });

  const id = await server.startWorkflow({ name: 'switch_wf', version: 1, input: { color: 'red' } });

  let task = await server.poll('paint_red');
  assert.ok(task, 'expected red branch task');
  await server.updateTask({ taskId: task.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: {} });

  task = await server.poll('finish');
  assert.ok(task, 'expected finish task after switch branch');
  await server.updateTask({ taskId: task.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: {} });

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
});

test('FORK_JOIN + JOIN waits for all branches', async () => {
  const server = await newServer();
  await server.registerTaskDefs([
    { name: 'a', retryCount: 0 },
    { name: 'b', retryCount: 0 },
  ]);
  await server.registerWorkflowDef({
    name: 'fork_wf', version: 1,
    tasks: [
      {
        type: 'FORK_JOIN', taskReferenceName: 'fork_ref',
        forkTasks: [
          [{ name: 'a', taskReferenceName: 'a_ref', type: 'SIMPLE' }],
          [{ name: 'b', taskReferenceName: 'b_ref', type: 'SIMPLE' }],
        ],
      },
      { type: 'JOIN', taskReferenceName: 'join_ref', joinOn: ['a_ref', 'b_ref'] },
    ],
  });

  const id = await server.startWorkflow({ name: 'fork_wf', version: 1, input: {} });
  assert.ok(await server.poll('a'));
  assert.ok(await server.poll('b'));

  // Complete only one branch: workflow should still be running.
  const a = await server.poll('a');
  assert.equal(a, null);
  // (a was already polled above and is IN_PROGRESS)

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.RUNNING);

  const aTask = (await server.getTasksForWorkflow(id)).results.find((t) => t.referenceTaskName === 'a_ref');
  await server.updateTask({ taskId: aTask.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: {} });

  let wf2 = await server.getWorkflow(id);
  assert.equal(wf2.status, WorkflowStatus.RUNNING, 'join should wait for b too');

  const bTask = (await server.getTasksForWorkflow(id)).results.find((t) => t.referenceTaskName === 'b_ref');
  await server.updateTask({ taskId: bTask.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: {} });

  wf2 = await server.getWorkflow(id);
  assert.equal(wf2.status, WorkflowStatus.COMPLETED);
});

test('SUB_WORKFLOW runs a child and resumes the parent', async () => {
  const server = await newServer();
  await server.registerTaskDefs([{ name: 'after', retryCount: 0 }]);
  await server.registerWorkflowDef({
    name: 'child', version: 1,
    tasks: [{ name: 'c1', taskReferenceName: 'c1_ref', type: 'NOOP' }],
  });
  await server.registerWorkflowDef({
    name: 'parent', version: 1,
    tasks: [
      { type: 'SUB_WORKFLOW', taskReferenceName: 'sub_ref', subWorkflowParam: { name: 'child', version: 1 } },
      { name: 'after', taskReferenceName: 'after_ref', type: 'SIMPLE' },
    ],
  });

  const id = await server.startWorkflow({ name: 'parent', version: 1, input: {} });
  let wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.RUNNING, 'parent waits for the SIMPLE task');

  const after = await server.poll('after');
  assert.ok(after, 'after task should be scheduled once child completes');
  await server.updateTask({ taskId: after.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: {} });

  wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);

  // Parent should reference the child.
  const subTask = wf.tasks.find((t) => t.referenceTaskName === 'sub_ref');
  assert.ok(subTask.inputData.workflowId);
});

test('task retries then completes', async () => {
  const server = await newServer();
  await server.registerTaskDefs([{ name: 'flaky', retryCount: 1, retryDelaySeconds: 0 }]);
  await server.registerWorkflowDef({
    name: 'retry_wf', version: 1,
    tasks: [{ name: 'flaky', taskReferenceName: 'flaky_ref', type: 'SIMPLE' }],
  });

  const id = await server.startWorkflow({ name: 'retry_wf', version: 1, input: {} });

  const first = await server.poll('flaky');
  assert.equal(first.retryCount, 0);
  await server.updateTask({ taskId: first.taskId, workflowInstanceId: id, status: 'FAILED', outputData: {} });

  const second = await server.poll('flaky');
  assert.ok(second, 'retry should be scheduled');
  assert.equal(second.retryCount, 1);
  assert.notEqual(second.taskId, first.taskId);

  await server.updateTask({ taskId: second.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: { ok: true } });

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
});

test('non-optional task with no retries fails the workflow and triggers failureWorkflow', async () => {
  const server = await newServer();
  await server.registerTaskDefs([
    { name: 'boom', retryCount: 0 },
    { name: 'cleanup', retryCount: 0 },
  ]);
  await server.registerWorkflowDef({
    name: 'cleanup_wf', version: 1,
    tasks: [{ name: 'cleanup', taskReferenceName: 'cleanup_ref', type: 'SIMPLE' }],
  });
  await server.registerWorkflowDef({
    name: 'main_wf', version: 1,
    failureWorkflow: 'cleanup_wf',
    tasks: [{ name: 'boom', taskReferenceName: 'boom_ref', type: 'SIMPLE' }],
  });

  const id = await server.startWorkflow({ name: 'main_wf', version: 1, input: { n: 1 } });
  const task = await server.poll('boom');
  await server.updateTask({ taskId: task.taskId, workflowInstanceId: id, status: 'FAILED', outputData: {}, reasonForIncompletion: 'kaboom' });

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.FAILED);
  assert.equal(wf.failedReferenceTaskNames[0], 'boom_ref');

  // The failure workflow should have been started.
  const cleanupTask = await server.poll('cleanup');
  assert.ok(cleanupTask, 'failure workflow should be running');
});

test('optional task failure continues the workflow', async () => {
  const server = await newServer();
  await server.registerTaskDefs([
    { name: 'optional_task', retryCount: 0 },
    { name: 'final_task', retryCount: 0 },
  ]);
  await server.registerWorkflowDef({
    name: 'optional_wf', version: 1,
    tasks: [
      { name: 'optional_task', taskReferenceName: 'opt_ref', type: 'SIMPLE', optional: true },
      { name: 'final_task', taskReferenceName: 'fin_ref', type: 'SIMPLE' },
    ],
  });

  const id = await server.startWorkflow({ name: 'optional_wf', version: 1, input: {} });
  const opt = await server.poll('optional_task');
  await server.updateTask({ taskId: opt.taskId, workflowInstanceId: id, status: 'FAILED', outputData: {} });

  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.RUNNING);

  const finalTask = await server.poll('final_task');
  assert.ok(finalTask, 'final task should run despite optional failure');
  await server.updateTask({ taskId: finalTask.taskId, workflowInstanceId: id, status: 'COMPLETED', outputData: {} });

  const done = await server.getWorkflow(id);
  assert.equal(done.status, WorkflowStatus.COMPLETED);
});

test('dynamic workflow via inline workflowDef', async () => {
  const server = await newServer();
  const id = await server.startWorkflow({
    name: 'adhoc',
    workflowDef: {
      name: 'adhoc', version: 1,
      tasks: [{ name: 'd', taskReferenceName: 'd_ref', type: 'NOOP' }],
    },
    input: {},
  });
  const wf = await server.getWorkflow(id);
  assert.equal(wf.status, WorkflowStatus.COMPLETED);
});

test('HTTP task executes via fetch', async () => {
  const server = await newServer();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    statusText: 'OK',
    headers: { forEach: () => {} },
    text: async () => JSON.stringify({ ok: true }),
  });

  try {
    await server.registerWorkflowDef({
      name: 'http_wf', version: 1,
      tasks: [{
        name: 'http_task', taskReferenceName: 'http_ref', type: 'HTTP',
        inputParameters: { http_request: { uri: 'https://example.com/data', method: 'GET' } },
      }],
    });

    const id = await server.startWorkflow({ name: 'http_wf', version: 1, input: {} });
    // HTTP completes asynchronously; poll the workflow until terminal.
    let wf;
    for (let i = 0; i < 100; i++) {
      wf = await server.getWorkflow(id);
      if (wf.status !== WorkflowStatus.RUNNING) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.equal(wf.status, WorkflowStatus.COMPLETED);
    const httpTask = wf.tasks.find((t) => t.referenceTaskName === 'http_ref');
    assert.equal(httpTask.outputData.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('retry delay respects FIXED logic', async () => {
  const { retryDelay } = await import('../src/engine/server.js');
  assert.equal(retryDelay({ retryDelaySeconds: 5, retryLogic: 'FIXED' }, 1), 5);
  assert.equal(retryDelay({ retryDelaySeconds: 5, retryLogic: 'FIXED' }, 3), 5);
  const exp = retryDelay({ retryDelaySeconds: 5, retryLogic: 'EXPONENTIAL_BACKOFF' }, 3);
  assert.equal(exp, 10 * 2 * 2); // base (max 10) * 2^(attempt-1)
});
