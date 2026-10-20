/**
 * Sample Conductor definitions used by the demo. These are plain Conductor
 * JSON definitions — identical to what you'd register against a real
 * Conductor server.
 */
window.SAMPLES = {
  taskDefs: [
    { name: 'greet', retryCount: 1, timeoutSeconds: 30, retryDelaySeconds: 1, ownerEmail: 'demo@example.com' },
    { name: 'validate_order', retryCount: 0, ownerEmail: 'demo@example.com' },
    { name: 'charge_payment', retryCount: 0, ownerEmail: 'demo@example.com' },
    { name: 'ship_order', retryCount: 0, ownerEmail: 'demo@example.com' },
    { name: 'vip_handler', retryCount: 0, ownerEmail: 'demo@example.com' },
    { name: 'standard_handler', retryCount: 0, ownerEmail: 'demo@example.com' },
  ],

  workflows: {
    greeting: {
      name: 'greeting',
      description: 'A simple greeting workflow executed by a remote worker.',
      version: 1,
      ownerEmail: 'demo@example.com',
      inputParameters: ['name'],
      tasks: [
        {
          name: 'greet',
          taskReferenceName: 'greet_ref',
          type: 'SIMPLE',
          inputParameters: { name: '${workflow.input.name}' },
        },
      ],
      outputParameters: { greeting: '${greet_ref.output.greeting}' },
    },

    order_processing: {
      name: 'order_processing',
      description: 'Fork/join: validate and charge in parallel, then ship.',
      version: 1,
      ownerEmail: 'demo@example.com',
      tasks: [
        {
          type: 'FORK_JOIN',
          taskReferenceName: 'process_fork',
          forkTasks: [
            [{ name: 'validate_order', taskReferenceName: 'validate_ref', type: 'SIMPLE', inputParameters: { orderId: '${workflow.input.orderId}' } }],
            [{ name: 'charge_payment', taskReferenceName: 'charge_ref', type: 'SIMPLE', inputParameters: { orderId: '${workflow.input.orderId}', amount: '${workflow.input.amount}' } }],
          ],
        },
        { type: 'JOIN', taskReferenceName: 'process_join', joinOn: ['validate_ref', 'charge_ref'] },
        { name: 'ship_order', taskReferenceName: 'ship_ref', type: 'SIMPLE', inputParameters: { orderId: '${workflow.input.orderId}' } },
      ],
      outputParameters: { trackingNumber: '${ship_ref.output.trackingNumber}' },
    },

    inline: {
      name: 'inline_demo',
      description: 'Synchronous SET_VARIABLE + INLINE computation.',
      version: 1,
      ownerEmail: 'demo@example.com',
      tasks: [
        { name: 'set', taskReferenceName: 'set_ref', type: 'SET_VARIABLE', inputParameters: { x: 40 } },
        {
          name: 'add', taskReferenceName: 'add_ref', type: 'INLINE',
          evaluatorType: 'javascript',
          inputParameters: { expr: '${set_ref.output.x}' },
          expression: 'return input.expr + 2;',
        },
      ],
      outputParameters: { answer: '${add_ref.output.result}' },
    },

    switch_demo: {
      name: 'switch_demo',
      description: 'SWITCH on an input value.',
      version: 1,
      ownerEmail: 'demo@example.com',
      tasks: [
        {
          name: 'pick', taskReferenceName: 'pick_ref', type: 'SWITCH',
          inputParameters: { switchCaseValue: '${workflow.input.tier}' },
          decisionCases: {
            vip: [{ name: 'vip_handler', taskReferenceName: 'vip_ref', type: 'SIMPLE', inputParameters: { user: '${workflow.input.user}' } }],
            standard: [{ name: 'standard_handler', taskReferenceName: 'std_ref', type: 'SIMPLE', inputParameters: { user: '${workflow.input.user}' } }],
          },
          defaultCase: [{ name: 'standard_handler', taskReferenceName: 'std_ref', type: 'SIMPLE', inputParameters: { user: '${workflow.input.user}' } }],
        },
      ],
      outputParameters: { handled: '${pick_ref.output}' },
    },
  },

  /** Worker implementations. Each maps a task name to `async (input) => output`. */
  workers: {
    greet: async (input) => ({ greeting: `Hello, ${input.name || 'world'}!` }),
    validate_order: async (input) => ({ valid: true, orderId: input.orderId }),
    charge_payment: async (input) => ({ charged: true, amount: input.amount, orderId: input.orderId }),
    ship_order: async (input) => ({ trackingNumber: `TRK-${Math.floor(Math.random() * 100000)}`, orderId: input.orderId }),
    vip_handler: async (input) => ({ tier: 'vip', user: input.user, perks: ['priority', 'lounge'] }),
    standard_handler: async (input) => ({ tier: 'standard', user: input.user, perks: [] }),
  },
};
