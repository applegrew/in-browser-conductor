/**
 * Error types mirroring Conductor OSS exceptions where the HTTP status and
 * body shape matter to clients.
 */

export class ConductorError extends Error {
  constructor(message, { status = 500, code = null, details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends ConductorError {
  constructor(message, details) {
    super(message, { status: 404, details });
  }
}

export class ConflictError extends ConductorError {
  constructor(message, details) {
    super(message, { status: 409, details });
  }
}

export class BadRequestError extends ConductorError {
  constructor(message, details) {
    super(message, { status: 400, details });
  }
}

/** Thrown by workers / inline tasks to fail a task, and by the engine for
 * request-level errors that should map to a specific HTTP status. */
export class ApplicationException extends Error {
  constructor(message, { type = 'ApplicationException', details = null, status = 500 } = {}) {
    super(message);
    this.name = type;
    this.details = details;
    this.status = status;
  }
}
