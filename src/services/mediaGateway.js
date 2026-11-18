const { AsteriskAriController } = require('./asteriskAriController');
const { AsteriskMediaBridge } = require('./asteriskMediaBridge');
const { setMediaBridgeAdapter, providerName } = require('./mediaBridge');
const sipIdentityStore = require('./sipIdentityStore');

let controller = null;
let adapter = null;
let sweepTimer = null;

function configuredProvider() {
  return String(process.env.MEDIA_BRIDGE_PROVIDER || '').trim().toLowerCase();
}

async function start() {
  const provider = configuredProvider();
  if (provider !== 'asterisk') {
    return {
      started: false,
      provider: provider || 'unconfigured',
      reason: 'Set MEDIA_BRIDGE_PROVIDER=asterisk to enable the local Asterisk media bridge',
    };
  }
  if (!process.env.ASTERISK_ARI_USERNAME || !process.env.ASTERISK_ARI_PASSWORD) {
    return {
      started: false,
      provider: 'asterisk',
      reason: 'ASTERISK_ARI_USERNAME and ASTERISK_ARI_PASSWORD are required',
    };
  }
  controller = new AsteriskAriController();
  adapter = new AsteriskMediaBridge(controller);
  setMediaBridgeAdapter(adapter);
  await controller.start();
  await sipIdentityStore.provisionAll().catch((error) => {
    console.error('[Media Gateway] SIP identity provisioning failed:', error.message);
  });
  if (!sweepTimer) {
    sweepTimer = setInterval(() => {
      sipIdentityStore.sweepExpired().catch((error) => {
        console.error('[Media Gateway] expired SIP identity sweep failed:', error.message);
      });
    }, 5 * 60_000);
    sweepTimer.unref?.();
  }
  return status();
}

async function stop() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
  if (controller) await controller.stop();
  controller = null;
  adapter = null;
  setMediaBridgeAdapter();
  return { stopped: true };
}

function status() {
  return {
    provider: configuredProvider() || providerName(),
    adapterConfigured: Boolean(adapter),
    started: Boolean(controller && controller.status().started),
    controller: controller ? controller.status() : null,
  };
}

module.exports = { start, stop, status, getController: () => controller, getAdapter: () => adapter };
