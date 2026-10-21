import { TaskStatus, TaskType } from '../enums.js';
import {
  buildContext,
  latestTasksByRef,
  jsonPath,
  substitute,
  evaluateSwitchCase,
} from '../expression.js';
import { createTaskRecord, isTerminalTask } from './model.js';

/**
 * The Decider is Conductor's core state machine. Given a workflow execution
 * it walks the workflow definition graph and decides which tasks are ready to
 * schedule, evaluating operators (FORK/JOIN, SWITCH, DO_WHILE, SUB_WORKFLOW,
 * SET_VARIABLE, TERMINATE, DYNAMIC, DYNAMIC_FORK) inline.
 *
 * `next(workflow)` mutates the workflow (adding control-task records and
 * updating `deciderState`/`variables`) and returns an action bundle:
 *   {
 *     tasks:         [ScheduledTask],   // ready leaves to schedule
 *     subworkflows:  [SubWorkflowStart],// child workflows to start
 *     terminates:    {status,output,reason} | null,
 *     progress:      bool,              // decider mutated state
 *     completed:     bool,              // workflow reached a natural end
 *   }
 *
 * `iteration` is threaded through every operator so a `DO_WHILE` body can run
 * the same reference names repeatedly: records are tagged with the loop
 * iteration and all lookups are iteration-aware (null = top level).
 */
export class Decider {
  constructor(server) {
    this.server = server;
  }

  next(workflow, def) {
    this.wf = workflow;
    this.def = def;
    this.result = { tasks: [], subworkflows: [], terminates: null, progress: false, completed: false };

    const done = this._walk(def.tasks || [], null);
    this.result.completed = done;
    return this.result;
  }

  /** Fresh evaluation context reflecting any records added during the walk. */
  _ctx() {
    return buildContext(this.wf, latestTasksByRef(this.wf));
  }

  /**
   * Latest attempt for a reference name, optionally scoped to a loop
   * iteration. When `iteration` is null (top-level walk) the latest record
   * across all iterations is returned.
   */
  _latestForRef(ref, iteration) {
    let latest = null;
    for (const t of this.wf.tasks || []) {
      if (t.referenceTaskName !== ref) continue;
      if (iteration != null && t.iteration !== iteration) continue;
      if (!latest || (t.seq ?? 0) >= (latest.seq ?? 0)) latest = t;
    }
    return latest;
  }

  // ---- helpers ----------------------------------------------------------

  _addRecord(td, { type, status, inputData = {}, outputData = {}, seq = 0, iteration = null, dynamic = false }) {
    const rec = createTaskRecord(this.wf, this.def, td, inputData, {
      resolvedType: type,
      taskDefName: td.name,
      seq,
      iteration,
      dynamic,
    });
    rec.status = status;
    rec.outputData = outputData;
    if (status === TaskStatus.COMPLETED || status === TaskStatus.COMPLETED_WITH_ERRORS) {
      rec.startTime = Date.now();
      rec.endTime = Date.now();
    }
    this.wf.tasks.push(rec);
    this.result.progress = true;
    return rec;
  }

  _leaf(taskDef, inputData, iteration = null, dynamic = false) {
    this.result.tasks.push({ taskDef, inputData, iteration, dynamic });
  }

  _resolvedType(td) {
    if (td.type === TaskType.FORK) return TaskType.FORK_JOIN;
    if (td.type === TaskType.DECISION) return TaskType.SWITCH;
    return td.type;
  }

  _inputFor(td, iteration = null) {
    const root = this._ctx();
    if (td.inputExpression) {
      const expr = typeof td.inputExpression === 'string' ? td.inputExpression : td.inputExpression.expression;
      return jsonPath(root, expr) ?? {};
    }
    const base = { ...(td.inputTemplate || {}), ...(td.inputParameters || {}) };
    return substitute(base, root);
  }

  // ---- walk -------------------------------------------------------------

  _walk(segment, iteration) {
    for (const td of segment) {
      const r = this._process(td, iteration);
      if (r === 'blocked' || r === 'terminate') return false;
      // 'done' / 'continue' -> keep walking
    }
    return true;
  }

  _process(td, iteration) {
    const type = this._resolvedType(td);
    const ref = td.taskReferenceName;
    const existing = this._latestForRef(ref, iteration);

    if (!existing) return this._start(td, type, iteration);

    if (existing.status === TaskStatus.COMPLETED || existing.status === TaskStatus.COMPLETED_WITH_ERRORS) {
      return 'done';
    }
    if (
      existing.status === TaskStatus.SKIPPED ||
      existing.status === TaskStatus.FAILED ||
      existing.status === TaskStatus.FAILED_WITH_TERMINAL_ERROR ||
      existing.status === TaskStatus.TIMED_OUT ||
      existing.status === TaskStatus.CANCELED
    ) {
      return 'blocked';
    }
    // SCHEDULED / IN_PROGRESS
    if (this._isContainer(type)) {
      return this._advanceContainer(td, type, existing, iteration);
    }
    return 'blocked';
  }

  _isContainer(type) {
    return (
      type === TaskType.SWITCH ||
      type === TaskType.DO_WHILE ||
      type === TaskType.SUB_WORKFLOW ||
      type === TaskType.DYNAMIC_FORK
    );
  }

  // ---- start (no existing record) --------------------------------------

  _start(td, type, iteration) {
    switch (type) {
      case TaskType.SET_VARIABLE:
        return this._startSetVariable(td, iteration);
      case TaskType.TERMINATE:
        return this._startTerminate(td, iteration);
      case TaskType.FORK_JOIN:
        return this._startFork(td, iteration);
      case TaskType.JOIN:
      case TaskType.EXCLUSIVE_JOIN:
        return this._startJoin(td, type, iteration);
      case TaskType.SWITCH:
        return this._startSwitch(td, iteration);
      case TaskType.DO_WHILE:
        return this._startDoWhile(td, iteration);
      case TaskType.SUB_WORKFLOW:
        return this._startSubWorkflow(td, iteration);
      case TaskType.START_WORKFLOW:
        return this._startStartWorkflow(td, iteration);
      case TaskType.DYNAMIC:
        return this._startDynamic(td, iteration);
      case TaskType.DYNAMIC_FORK:
        return this._startDynamicFork(td, iteration);
      default:
        // Leaf task (SIMPLE, HTTP, INLINE, WAIT, HUMAN, ...).
        this._leaf(td, this._inputFor(td, iteration), iteration);
        return 'blocked';
    }
  }

  _startSetVariable(td, iteration) {
    const vars = this._inputFor(td, iteration);
    this.wf.variables = { ...(this.wf.variables || {}), ...(vars || {}) };
    this._addRecord(td, { type: TaskType.SET_VARIABLE, status: TaskStatus.COMPLETED, inputData: vars, outputData: vars, iteration });
    return 'continue';
  }

  _startTerminate(td, iteration) {
    const input = this._inputFor(td, iteration);
    const status = input.terminationStatus || 'COMPLETED';
    const output = input.workflowOutput != null ? input.workflowOutput : undefined;
    const reason = input.terminationReason || '';
    this._addRecord(td, { type: TaskType.TERMINATE, status: TaskStatus.COMPLETED, inputData: input, outputData: input, iteration });
    this.result.terminates = { status, output, reason };
    return 'terminate';
  }

  _startFork(td, iteration) {
    const branches = td.forkTasks || [];
    const joinOn = branches.map((branch) => {
      if (!branch || branch.length === 0) return null;
      const last = branch[branch.length - 1];
      return last.taskReferenceName;
    }).filter(Boolean);
    this.wf.deciderState.forkStack = this.wf.deciderState.forkStack || [];
    this.wf.deciderState.forkStack.push(joinOn);

    this._addRecord(td, { type: TaskType.FORK_JOIN, status: TaskStatus.COMPLETED, iteration });

    for (const branch of branches) {
      this._walk(branch || [], iteration);
    }
    return 'continue';
  }

  _startJoin(td, type, iteration) {
    let joinOn = (td.joinOn || []).slice();
    if (joinOn.length === 0) {
      const stack = this.wf.deciderState.forkStack || [];
      if (stack.length) {
        joinOn = stack[stack.length - 1].slice();
        // Don't pop yet: only pop when the join completes.
      }
    }
    this.wf.deciderState.joinOn = this.wf.deciderState.joinOn || {};
    this.wf.deciderState.joinOn[td.taskReferenceName] = joinOn;

    const any = type === TaskType.EXCLUSIVE_JOIN;
    const done = joinOn.length > 0 && (any
      ? joinOn.some((ref) => this._refCompleted(ref, iteration))
      : joinOn.every((ref) => this._refCompleted(ref, iteration)));

    if (!done) return 'blocked';

    const output = {};
    for (const ref of joinOn) {
      const t = this._latestForRef(ref, iteration);
      if (t) output[ref] = t.outputData;
    }
    this._addRecord(td, { type, status: TaskStatus.COMPLETED, outputData: output, iteration });
    const stack = this.wf.deciderState.forkStack || [];
    if (stack.length) stack.pop();
    return 'continue';
  }

  _refCompleted(ref, iteration) {
    const t = this._latestForRef(ref, iteration);
    if (!t) return false;
    return t.status === TaskStatus.COMPLETED || t.status === TaskStatus.COMPLETED_WITH_ERRORS || t.status === TaskStatus.SKIPPED;
  }

  _startSwitch(td, iteration) {
    const evaluatorType = td.evaluatorType || 'value-param';
    let caseKey = null;
    if (evaluatorType === 'javascript') {
      const expression = td.expression || '';
      const value = this._evalJs(expression);
      caseKey = value ? 'true' : 'false';
    } else {
      const value = evaluateSwitchCase(
        this.wf,
        td,
        td.inputParameters?.switchCaseValue,
        td.inputParameters?.switchCaseExpression
      );
      caseKey = String(value);
    }

    const cases = td.decisionCases || {};
    let chosen = null;
    if (Object.prototype.hasOwnProperty.call(cases, caseKey)) chosen = cases[caseKey];
    else if (td.defaultCase) chosen = td.defaultCase;

    this.wf.deciderState.switches = this.wf.deciderState.switches || {};
    this.wf.deciderState.switches[td.taskReferenceName] = { caseKey, list: chosen || [] };

    this._addRecord(td, { type: TaskType.SWITCH, status: TaskStatus.IN_PROGRESS, inputData: { caseValue: caseKey }, iteration });

    if (!chosen || chosen.length === 0) {
      // Nothing to run in the selected branch: complete immediately.
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      return 'continue';
    }
    this._walk(chosen, iteration);
    return 'blocked';
  }

  _startDoWhile(td, iteration) {
    this.wf.deciderState.doWhile = this.wf.deciderState.doWhile || {};
    this.wf.deciderState.doWhile[td.taskReferenceName] = { iteration: 0 };
    this._addRecord(td, { type: TaskType.DO_WHILE, status: TaskStatus.IN_PROGRESS, iteration });
    const loopOver = td.loopOver || [];
    if (loopOver.length === 0) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      return 'continue';
    }
    this._walk(loopOver, 0);
    return 'blocked';
  }

  _startSubWorkflow(td, iteration) {
    const input = this._inputFor(td, iteration);
    const sub = td.subWorkflowParam || {};
    const name = sub.name;
    const version = sub.version;
    this._addRecord(td, { type: TaskType.SUB_WORKFLOW, status: TaskStatus.IN_PROGRESS, inputData: input, iteration });
    this.result.subworkflows.push({
      taskDef: td,
      inputData: input,
      name,
      version,
      correlationId: sub.correlationId,
      idempotencyKey: sub.idempotencyKey,
      idempotencyStrategy: sub.idempotencyStrategy,
    });
    return 'blocked';
  }

  _startStartWorkflow(td, iteration) {
    const input = this._inputFor(td, iteration);
    const spec = input.startWorkflow || {};
    this._addRecord(td, { type: TaskType.START_WORKFLOW, status: TaskStatus.IN_PROGRESS, inputData: input, iteration });
    this.result.subworkflows.push({
      taskDef: td,
      inputData: spec.input || {},
      name: spec.name,
      version: spec.version,
      correlationId: spec.correlationId,
      idempotencyKey: spec.idempotencyKey,
      idempotencyStrategy: spec.idempotencyStrategy,
      fireAndForget: true,
    });
    return 'blocked';
  }

  _startDynamic(td, iteration) {
    const input = this._inputFor(td, iteration);
    const nameParam = td.dynamicTaskNameParam || 'taskToExecute';
    const taskName = input[nameParam] || td.dynamicTaskName;
    if (!taskName) {
      this._addRecord(td, { type: TaskType.DYNAMIC, status: TaskStatus.COMPLETED, outputData: input, iteration });
      return 'continue';
    }
    const taskDef = this.server.getTaskDefSync(taskName) || { name: taskName, type: TaskType.SIMPLE };
    const resolvedType = taskDef.type || TaskType.SIMPLE;

    this.wf.deciderState.dynamics = this.wf.deciderState.dynamics || {};
    this.wf.deciderState.dynamics[td.taskReferenceName] = { taskName, resolvedType };

    const dynamicInput = { ...input };
    delete dynamicInput[nameParam];

    this.result.tasks.push({
      taskDef: { ...td, type: resolvedType },
      taskDefName: taskName,
      inputData: dynamicInput,
      iteration,
      dynamic: true,
    });
    return 'blocked';
  }

  _startDynamicFork(td, iteration) {
    const input = this._inputFor(td, iteration);
    const tasksParam = td.dynamicForkTasksParam || 'dynamicTasks';
    const inputParam = td.dynamicForkTasksInputParamName || 'dynamicTasksInput';
    const taskSpecs = input[tasksParam] || [];
    const inputs = input[inputParam] || [];

    this._addRecord(td, { type: TaskType.DYNAMIC_FORK, status: TaskStatus.IN_PROGRESS, inputData: input, iteration });
    this.wf.deciderState.dynamicForks = this.wf.deciderState.dynamicForks || {};
    const childRefs = [];

    taskSpecs.forEach((spec, i) => {
      const childRef = `${td.taskReferenceName}__${i}`;
      childRefs.push(childRef);
      const childTaskDef = {
        name: spec.taskName || spec.name,
        taskReferenceName: childRef,
        type: spec.type || TaskType.SIMPLE,
        inputParameters: spec.inputParameters,
      };
      this.result.tasks.push({
        taskDef: childTaskDef,
        taskDefName: childTaskDef.name,
        inputData: inputs[i] || {},
        iteration,
        dynamic: true,
      });
    });

    this.wf.deciderState.dynamicForks[td.taskReferenceName] = { childRefs };
    return 'blocked';
  }

  // ---- advance containers ----------------------------------------------

  _advanceContainer(td, type, existing, iteration) {
    switch (type) {
      case TaskType.SWITCH:
        return this._advanceSwitch(td, iteration);
      case TaskType.DO_WHILE:
        return this._advanceDoWhile(td, iteration);
      case TaskType.DYNAMIC_FORK:
        return this._advanceDynamicFork(td, iteration);
      default:
        return 'blocked';
    }
  }

  _advanceSwitch(td, iteration) {
    const info = (this.wf.deciderState.switches || {})[td.taskReferenceName];
    const chosen = info ? info.list : [];
    if (chosen.length === 0) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      return 'continue';
    }
    const done = this._walk(chosen, iteration);
    if (done) {
      const rec = this._latestForRef(td.taskReferenceName, iteration);
      if (rec) rec.status = TaskStatus.COMPLETED;
      this.result.progress = true;
      return 'continue';
    }
    return 'blocked';
  }

  _advanceDoWhile(td, iteration) {
    const state = (this.wf.deciderState.doWhile || {})[td.taskReferenceName];
    if (!state) return 'blocked';
    const loopOver = td.loopOver || [];
    const current = state.iteration;
    const done = loopOver.every((inner) => this._loopIterationDone(inner.taskReferenceName, current));

    if (!done) {
      this._walk(loopOver, current);
      return 'blocked';
    }

    const shouldLoop = this._evaluateLoopCondition(td, loopOver, current);
    if (shouldLoop) {
      state.iteration = current + 1;
      this._walk(loopOver, state.iteration);
      return 'blocked';
    }
    const rec = this._latestForRef(td.taskReferenceName, iteration);
    if (rec) rec.status = TaskStatus.COMPLETED;
    this.result.progress = true;
    return 'continue';
  }

  _loopIterationDone(ref, iteration) {
    const records = (this.wf.tasks || []).filter((t) => t.referenceTaskName === ref && t.iteration === iteration);
    if (records.length === 0) return false;
    return records.some((t) => isTerminalTask(t.status) && t.status !== TaskStatus.FAILED && t.status !== TaskStatus.FAILED_WITH_TERMINAL_ERROR);
  }

  _evaluateLoopCondition(td, loopOver, iteration) {
    const cond = td.loopCondition;
    if (!cond) return false;
    const scope = {};
    for (const inner of loopOver) {
      const rec = this._latestForRef(inner.taskReferenceName, iteration);
      scope[inner.taskReferenceName] = { input: rec ? rec.inputData : {}, output: rec ? rec.outputData : {} };
    }
    // Support `${...}` JSONPath first, then a JS boolean expression with `$`.
    const substituted = substitute(cond, { workflow: this._ctx().workflow, ...scope });
    if (typeof substituted === 'boolean') return substituted;
    const fn = new Function('$', `"use strict"; return (${cond});`);
    return !!fn(scope);
  }

  _advanceDynamicFork(td, iteration) {
    const info = (this.wf.deciderState.dynamicForks || {})[td.taskReferenceName];
    if (!info) return 'blocked';
    const allDone = info.childRefs.every((ref) => this._refCompleted(ref, iteration));
    if (!allDone) return 'blocked';
    const rec = this._latestForRef(td.taskReferenceName, iteration);
    if (rec) rec.status = TaskStatus.COMPLETED;
    this.result.progress = true;
    return 'continue';
  }

  // ---- misc -------------------------------------------------------------

  _evalJs(expression) {
    const root = this._ctx();
    const fn = new Function('input', 'workflow', `"use strict"; return (${expression});`);
    return fn(root.workflow.input, root.workflow);
  }
}
