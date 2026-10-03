export class MissionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MissionError';
    this.code = code;
    this.details = details;
  }
}

export function invariant(condition, code, message, details) {
  if (!condition) throw new MissionError(code, message, details);
}
