const dashboardStore = require('../../utils/dashboardStore');

function record(values = {}) {
  return dashboardStore.recordAiUsage({
    tenantId: values.tenantId,
    businessId: values.businessId,
    callId: values.callId,
    provider: values.provider || 'nileagi',
    operation: values.operation || 'unknown',
    durationMs: values.durationMs,
    inputBytes: values.inputBytes,
    inputAudioSeconds: values.inputAudioSeconds,
    outputBytes: values.outputBytes,
    outputAudioSeconds: values.outputAudioSeconds,
    inputCharacters: values.inputCharacters,
    outputCharacters: values.outputCharacters,
    success: values.success === true,
    errorCode: values.errorCode,
    retryCount: values.retryCount,
  });
}

function list(tenantId, filters = {}) {
  return dashboardStore.listAiUsage(tenantId, filters);
}

module.exports = { record, list };
