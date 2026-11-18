class NileagiError extends Error {
  constructor(message, { code = 'NILEAGI_ERROR', statusCode = 502, operation = null, cause = null } = {}) {
    super(message);
    this.name = 'NileagiError';
    this.code = code;
    this.statusCode = statusCode;
    this.operation = operation;
    if (cause) this.cause = cause;
  }
}

function unavailable(message, operation) {
  return new NileagiError(message, { code: 'NILEAGI_UNAVAILABLE', statusCode: 503, operation });
}

function unsupported(message, operation) {
  return new NileagiError(message, { code: 'NILEAGI_UNSUPPORTED', statusCode: 501, operation });
}

function configuration(message, operation) {
  return new NileagiError(message, { code: 'NILEAGI_CONFIGURATION_ERROR', statusCode: 503, operation });
}

module.exports = { NileagiError, unavailable, unsupported, configuration };
