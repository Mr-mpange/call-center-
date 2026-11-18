'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  encryptPassword, decryptPassword, usernameFor, browserCredentials, __test,
} = require('../src/services/sipIdentityStore');

const { pjsipBlock, renderAgentsFile } = __test;

const ARI_PASSWORD = '497701c26622488944db3732d1c7e1942c049a25d211c7beb9ea537d7c1a988a';

function withEnv(overrides, callback) {
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('SIP passwords are encrypted at rest with AES-256-GCM', () => {
  withEnv({ SIP_CREDENTIAL_SECRET: 'unit-test-sip-secret-0123456789abcdef' }, () => {
    const password = 'a'.repeat(64);
    const payload = encryptPassword(password);

    assert.notEqual(payload, password, 'ciphertext must not contain the plaintext');
    assert.ok(payload.startsWith('v1:'), 'versioned ciphertext envelope');
    assert.equal(payload.split(':').length, 4, 'iv:tag:ciphertext envelope');
    assert.ok(!payload.includes(password));
    assert.equal(decryptPassword(payload), password);
  });
});

test('tampered or foreign ciphertext cannot be decrypted', () => {
  withEnv({ SIP_CREDENTIAL_SECRET: 'unit-test-sip-secret-0123456789abcdef' }, () => {
    const payload = encryptPassword('super-secret-password');
    const parts = payload.split(':');
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered-ciphertext-bytes').toString('base64url')].join(':');
    assert.throws(() => decryptPassword(tampered), /unable to authenticate|bad decrypt|unsupported|state/i);
    assert.throws(() => decryptPassword('not-a-ciphertext'), /Invalid SIP credential payload/);
    assert.throws(() => decryptPassword(''), /Invalid SIP credential payload/);
  });

  // A different deployment secret must not be able to read stored credentials.
  const foreign = withEnv({ SIP_CREDENTIAL_SECRET: 'unit-test-sip-secret-0123456789abcdef' }, () => encryptPassword('x'));
  withEnv({ SIP_CREDENTIAL_SECRET: 'some-other-deployment-secret-9876543210' }, () => {
    assert.throws(() => decryptPassword(foreign));
  });
});

test('missing encryption secret fails closed before anything is provisioned', () => {
  withEnv({ SIP_CREDENTIAL_SECRET: '', AUTH_SECRET: '' }, () => {
    assert.throws(() => encryptPassword('x'), /SIP_CREDENTIAL_SECRET/);
  });
});

test('agent usernames are stable per tenant/user and never collide across tenants', () => {
  const a = usernameFor('tenant-1', 'user-1');
  const b = usernameFor('tenant-1', 'user-1');
  const otherTenant = usernameFor('tenant-2', 'user-1');
  const otherUser = usernameFor('tenant-1', 'user-2');

  assert.equal(a, b, 'same tenant + user always maps to the same SIP identity');
  assert.notEqual(a, otherTenant, 'tenant isolation');
  assert.notEqual(a, otherUser, 'user isolation');
  assert.match(a, /^mpange_[a-f0-9]{24}$/, 'safe SIP username shape');
});

test('browser credentials expose only the calling agent identity', () => {
  const credentials = withEnv({ ASTERISK_SIP_DOMAIN: 'sip.example.test', ASTERISK_WSS_URL: 'wss://gw.example.test/ws' }, () => browserCredentials({
    identity: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentId: 'agent-1',
      username: 'mpange_deadbeefdeadbeefdeadbe',
      businessIds: ['business-1'],
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
    password: 'agent-password',
  }));

  assert.deepEqual(Object.keys(credentials).sort(), [
    'aor', 'businessIds', 'expiresAt', 'password', 'sipDomain', 'username', 'wsUrl',
  ]);
  assert.equal(credentials.username, 'mpange_deadbeefdeadbeefdeadbe');
  assert.equal(credentials.aor, 'sip:mpange_deadbeefdeadbeefdeadbe@sip.example.test');
  assert.equal(credentials.wsUrl, 'wss://gw.example.test/ws');

  const serialized = JSON.stringify(credentials);
  assert.ok(!/mpange_gateway/i.test(serialized), 'ARI username must never reach the browser');
  assert.ok(!serialized.includes(ARI_PASSWORD), 'ARI password must never reach the browser');
  assert.ok(!/passwordEnc/i.test(serialized), 'stored ciphertext must never reach the browser');
});

test('generated PJSIP endpoint blocks are browser-only and block direct DID dialing', () => {
  const block = pjsipBlock({
    tenantId: 'tenant-1',
    agentId: 'agent-1',
    username: 'mpange_deadbeefdeadbeefdeadbe',
  }, 'plain-agent-password');

  assert.match(block, /\[mpange_deadbeefdeadbeefdeadbe-auth\]/);
  assert.match(block, /type=auth/);
  assert.match(block, /password=plain-agent-password/);
  assert.match(block, /\[mpange_deadbeefdeadbeefdeadbe\]/);
  assert.match(block, /type=aor/);
  assert.match(block, /type=endpoint/);
  assert.match(block, /context=from-webrtc/, 'browser endpoints may only reach the blocked diagnostic context');
  assert.match(block, /transport=transport-wss/);
  assert.match(block, /media_encryption=dtls/);
  assert.match(block, /webrtc=yes/);
  assert.match(block, /direct_media=no/);

  assert.ok(!block.includes('from-at-trunk'), 'browser endpoints never get the trunk context');
  assert.ok(!block.includes('mpange_gateway'), 'ARI identity never lands in the endpoint file');
  assert.ok(!block.includes(ARI_PASSWORD), 'ARI secret never lands in the endpoint file');
  assert.ok(!/passwordEnc/.test(block));
});

test('renderAgentsFile skips identities whose stored secret cannot be read', () => {
  withEnv({ SIP_CREDENTIAL_SECRET: 'unit-test-sip-secret-0123456789abcdef' }, () => {
    const readable = renderAgentsFile([
      { tenantId: 't1', agentId: 'a1', username: 'mpange_aaaaaaaaaaaaaaaaaaaaaaaa', passwordEnc: encryptPassword('secret-one') },
      { tenantId: 't1', agentId: 'a2', username: 'mpange_bbbbbbbbbbbbbbbbbbbbbbbb', passwordEnc: 'v1:garbage' },
    ]);

    assert.ok(readable.includes('[mpange_aaaaaaaaaaaaaaaaaaaaaaaa]'));
    assert.ok(readable.includes('password=secret-one'));
    assert.ok(!readable.includes('[mpange_bbbbbbbbbbbbbbbbbbbbbbbb]'), 'undecryptable identity is omitted, not guessed');
    assert.ok(!readable.includes('garbage'));
    assert.ok(readable.includes('AUTO-GENERATED'));
    assert.ok(readable.includes('Never expose this file'), 'file carries an explicit warning');
  });
});
