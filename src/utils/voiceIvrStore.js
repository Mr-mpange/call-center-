const fs = require('fs');
const path = require('path');

const storeFile = process.env.VOICE_IVR_FILE || path.join(process.cwd(), 'data', 'voice-ivr-flows.json');

function readAll() {
  if (!fs.existsSync(storeFile)) return {};
  const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Voice IVR store must contain a JSON object');
  }
  return parsed;
}

function writeAll(flows) {
  fs.mkdirSync(path.dirname(storeFile), { recursive: true });
  const temporaryFile = `${storeFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(flows, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, storeFile);
}

function get(businessId) {
  return readAll()[businessId] || null;
}

function put(businessId, flow) {
  const flows = readAll();
  flows[businessId] = flow;
  writeAll(flows);
  return flow;
}

function remove(businessId) {
  const flows = readAll();
  if (!Object.hasOwn(flows, businessId)) return false;
  delete flows[businessId];
  writeAll(flows);
  return true;
}

module.exports = { readAll, get, put, remove };
