// Minimal TypeScript declarations for in-browser-conductor.

export interface Store {
  init(): Promise<void>;
  get(collection: string, key: string): Promise<any>;
  put(collection: string, key: string, value: any): Promise<any>;
  delete(collection: string, key: string): Promise<boolean>;
  list(collection: string): Promise<any[]>;
  clear(collection?: string): Promise<void>;
}

export class MemoryStore implements Store {
  init(): Promise<void>;
  get(collection: string, key: string): Promise<any>;
  put(collection: string, key: string, value: any): Promise<any>;
  delete(collection: string, key: string): Promise<boolean>;
  list(collection: string): Promise<any[]>;
  clear(collection?: string): Promise<void>;
}

export class LocalStorageStore extends MemoryStore {
  constructor(options?: { storageKey?: string; storage?: Storage; debounceMs?: number });
  flush(): Promise<void>;
}

export class SqliteStore extends MemoryStore {
  constructor(options?: { sqlJs?: any; wasmUrl?: string; dbName?: string });
}

export function createStore(spec?: string | Store, options?: any): Store;

export interface ServerOptions {
  store?: string | Store;
  storeOptions?: any;
  logger?: any;
  sweeperIntervalMs?: number;
}

export class ConductorServer {
  constructor(options?: ServerOptions);
  init(): Promise<void>;
  dispose(): void;
  onEvent(fn: (e: any) => void): () => void;
  registerWorkflowDef(def: any, overwrite?: boolean): Promise<any>;
  updateWorkflowDefs(defs: any[]): Promise<any>;
  getWorkflowDef(name: string, version?: number): Promise<any>;
  getAllWorkflowDefs(): Promise<any[]>;
  deleteWorkflowDef(name: string, version: number): Promise<void>;
  registerTaskDefs(defs: any[]): Promise<void>;
  updateTaskDef(def: any): Promise<any>;
  getTaskDef(name: string): Promise<any>;
  getAllTaskDefs(): Promise<any[]>;
  deleteTaskDef(name: string): Promise<void>;
  startWorkflow(request: any): Promise<string>;
  executeWorkflow(request: any, opts?: any): Promise<any>;
  getWorkflow(id: string, includeTasks?: boolean): Promise<any>;
  getWorkflowStatus(id: string, opts?: any): Promise<any>;
  getTasksForWorkflow(id: string, opts?: any): Promise<any>;
  getRunningWorkflows(name: string, version?: number, startTime?: number, endTime?: number): Promise<string[]>;
  pause(id: string): Promise<any>;
  resume(id: string): Promise<any>;
  retry(id: string, opts?: any): Promise<any>;
  restart(id: string, opts?: any): Promise<any>;
  rerun(id: string, body: any): Promise<any>;
  skipTask(id: string, taskReferenceName: string, body?: any): Promise<any>;
  terminate(id: string, reason?: string): Promise<any>;
  remove(id: string, opts?: any): Promise<void>;
  decide(id: string): Promise<void>;
  getTask(taskId: string): Promise<any>;
  poll(taskType: string, workerId?: string, domain?: string): Promise<any>;
  batchPoll(taskType: string, workerId?: string, domain?: string, count?: number, timeout?: number): Promise<any[]>;
  updateTask(result: any): Promise<string>;
  updateTaskV2(result: any): Promise<any>;
  updateTaskByRef(workflowId: string, taskRefName: string, status: string, output: any, workerId?: string): Promise<any>;
  getQueueSizes(): Promise<Record<string, number>>;
  getQueueSize(taskType: string): Promise<number>;
  requeue(taskType: string): Promise<number>;
  searchWorkflows(args?: any): Promise<any>;
  searchTasks(args?: any): Promise<any>;
}

export function createServer(options?: ServerOptions): Promise<ConductorServer>;

export interface ConductorClientOptions {
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export class ConductorClient {
  constructor(options?: ConductorClientOptions);
  metadataResource: any;
  workflowResource: any;
  taskResource: any;
  queueResource: any;
  eventResource: any;
  request(method: string, path: string, opts?: any): Promise<any>;
}

export interface ConductorWorkerOptions {
  taskType: string;
  baseURL?: string;
  workerId?: string;
  domain?: string;
  concurrency?: number;
  pollInterval?: number;
  executeTask?: (input: any) => Promise<any> | any;
  client?: ConductorClient;
  onTaskComplete?: (e: any) => void;
}

export class ConductorWorker {
  constructor(options: ConductorWorkerOptions);
  start(): void;
  stop(): void;
  poll(): Promise<any>;
}

export function patchFetch(server: ConductorServer, options?: { basePath?: string }): () => void;
export function registerServiceWorker(server: ConductorServer, options?: any): Promise<any>;
export function install(options?: any): Promise<{ server: ConductorServer; client: ConductorClient; uninstall: () => void }>;
export function handleHttpRequest(request: any, server: ConductorServer, options?: any): Promise<any>;
export function toFetchResponse(res: any): any;

export const enums: Record<string, Record<string, string>>;
