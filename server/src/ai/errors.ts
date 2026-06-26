// AI mapping engine error type (§18.2). `terminal === true` means the failure is
// non-retryable: the caller must NOT retry the call and should fail the
// submission's AI-mapping step. Non-terminal errors are reserved for transient
// faults a worker may retry later.

export class AiError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal: boolean) {
    super(message);
    this.name = 'AiError';
    this.terminal = terminal;
    // Restore prototype chain (TS target ES2021 / extending built-in Error).
    Object.setPrototypeOf(this, AiError.prototype);
  }
}
