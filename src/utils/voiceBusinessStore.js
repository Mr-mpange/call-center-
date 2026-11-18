const fs = require('fs');
const path = require('path');
const dashboardStore = require('./dashboardStore');

const storeFile = process.env.VOICE_BUSINESSES_FILE || path.join(process.cwd(), 'data', 'voice-businesses.json');
let migrationChecked = false;

function migrateLegacyFile() {
  if (migrationChecked) return;
  migrationChecked = true;
  if (!fs.existsSync(storeFile)) return;
  const businesses = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  if (!Array.isArray(businesses)) throw new Error('Legacy voice business store must contain a JSON array');
  for (const business of businesses) {
    if (!business || typeof business !== 'object') continue;
    const tenantId = business.tenantId || (dashboardStore.getTenant(business.id) ? business.id : 'workspace');
    if (!dashboardStore.getTenant(tenantId)) {
      console.warn(`[Voice Businesses] legacy route ${String(business.id)} skipped: tenant ${String(tenantId)} does not exist`);
      continue;
    }
    if (!dashboardStore.getVoiceBusiness(tenantId, business.id)) {
      dashboardStore.upsertVoiceBusiness(tenantId, business);
      console.info(`[Voice Businesses] migrated legacy route ${String(business.id)} to tenant-scoped database storage`);
    }
  }
}

function read(tenantId) {
  migrateLegacyFile();
  return dashboardStore.listVoiceBusinesses(tenantId);
}

function readByNumber(number) {
  migrateLegacyFile();
  return dashboardStore.findVoiceBusinessByNumber(String(number || '').replace(/[^\d+]/g, ''));
}

function write(businesses, tenantId) {
  migrateLegacyFile();
  if (!Array.isArray(businesses)) throw new Error('Voice businesses must be an array');
  for (const business of businesses) {
    const scopedTenantId = business.tenantId || tenantId;
    if (!scopedTenantId) throw new Error('tenantId is required for voice business persistence');
    dashboardStore.upsertVoiceBusiness(scopedTenantId, business);
  }
}

function upsert(tenantId, business) {
  migrateLegacyFile();
  return dashboardStore.upsertVoiceBusiness(tenantId, business);
}

function get(tenantId, businessId) {
  migrateLegacyFile();
  return dashboardStore.getVoiceBusiness(tenantId, businessId);
}

function remove(tenantId, businessId) {
  migrateLegacyFile();
  return dashboardStore.deleteVoiceBusiness(tenantId, businessId);
}

module.exports = { exists: () => true, read, readByNumber, write, upsert, get, remove };
