'use strict';

/**
 * `pjsip show channelstats` parsing against the real Asterisk 22 output.
 *
 * The gateway (Asterisk 22.11.0, channels/pjsip/cli_commands.c) prints the
 * channel column as the channel *name* with the "PJSIP/" prefix deliberately
 * stripped and the field truncated to 18 characters, so no row ever contains
 * "PJSIP/" and a 31-character endpoint username only appears truncated. An
 * earlier parser filtered on "PJSIP/" and therefore matched nothing, which
 * made every live call look like it had no gateway RTP at all.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseChannelStats, findChannelRow } = require('../src/services/asteriskCli');

const SAMPLE = [
  '                                             ...........Receive......... .........Transmit..........',
  ' BridgeId ChannelId ........ UpTime.. Codec.   Count    Lost Pct  Jitter   Count    Lost Pct  Jitter RTT....',
  ' =================',
  ' mpange-b mpange_c10a5d66ab8 00:00:58 ulaw     2044     0   0   0.001   2044     0   0   0.009   0.006',
  ' mpange-b sip-test-00000001 00:00:57 alaw     2041     0   0   0.008   2041     0   0   0.010   0.007',
  ' mpange-b mpange_c10a5d66ab8 01:15:00 ulaw   145K   120K   0   0.010   140K   118K   0   0.011   0.020',
  ' PJSIP/mpange_c10a5d66ab8abcdef not valid',
  ' PJSIP/mpange_c10a5d66ab8abcdef direct media',
  'No objects found.',
  '',
].join('\n');

test('parses the Asterisk 22 channelstats layout without a PJSIP/ prefix', () => {
  const rows = parseChannelStats(SAMPLE);
  assert.equal(rows.length, 3, JSON.stringify(rows));

  const [agent, caller, stale] = rows;
  assert.equal(agent.channel, 'mpange_c10a5d66ab8');
  assert.equal(agent.bridge, 'mpange-b');
  assert.equal(agent.codec, 'ulaw');
  assert.equal(agent.uptimeSeconds, 58);
  // Receive count is the first counter, transmit count is the fifth: the old
  // parser read rx-loss as the transmit count.
  assert.equal(agent.rxPackets, 2044);
  assert.equal(agent.rxLost, 0);
  assert.equal(agent.txPackets, 2044);
  assert.equal(agent.txLost, 0);

  assert.equal(caller.channel, 'sip-test-00000001');
  assert.equal(caller.codec, 'alaw');

  // Counters above 100000 are printed divided by 1000 with a "K" suffix.
  assert.equal(stale.rxPackets, 145000);
  assert.equal(stale.rxLost, 120000);
  assert.equal(stale.txPackets, 140000);
  assert.equal(stale.uptimeSeconds, 4500);
});

test('ignores header, separator and rows without RTP statistics', () => {
  assert.deepEqual(parseChannelStats('No objects found.'), []);
  assert.deepEqual(parseChannelStats(''), []);
  assert.deepEqual(parseChannelStats(null), []);
  assert.deepEqual(parseChannelStats('                    ...Receive......... .........Transmit..........'), []);
});

test('findChannelRow matches the truncated username and prefers the freshest row', () => {
  const rows = parseChannelStats(SAMPLE);
  // Real endpoint usernames are `mpange_` + 24 hex characters; only the first
  // 18 characters survive in the channel column.
  const username = 'mpange_c10a5d66ab8f0e1d2c3b4a5';
  assert.equal(username.slice(0, 18), 'mpange_c10a5d66ab8');

  const freshest = findChannelRow(rows, { username });
  assert.ok(freshest, 'expected a row for the agent endpoint');
  assert.equal(freshest.uptimeSeconds, 58);

  assert.equal(findChannelRow(rows, { username: 'mpange_000000000000000000000000' }), null);
  assert.equal(findChannelRow(rows, { channelId: 'sip-test-00000001' }).channel, 'sip-test-00000001');
  assert.equal(findChannelRow([], { username }), null);
});
