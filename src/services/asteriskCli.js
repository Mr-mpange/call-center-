const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function enabled() {
  return String(process.env.ASTERISK_CLI_ENABLED || 'false').toLowerCase() === 'true';
}

async function execute(command, { timeout = 10_000 } = {}) {
  if (!enabled()) return { ok: false, reason: 'Asterisk CLI access is not enabled' };
  const bin = process.env.ASTERISK_CLI_BIN || 'docker';
  const container = process.env.ASTERISK_CLI_DOCKER_CONTAINER || 'asterisk-asterisk-1';
  const args = bin === 'docker'
    ? ['exec', container, 'asterisk', '-rx', command]
    : ['-rx', command];
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout, maxBuffer: 1024 * 1024 });
    return { ok: true, output: String(stdout || '').trim(), stderr: String(stderr || '').trim() };
  } catch (error) {
    return {
      ok: false,
      reason: error.killed ? 'Asterisk CLI command timed out' : error.message,
      stderr: String(error.stderr || '').trim(),
    };
  }
}

async function reloadPjsip() {
  return execute('pjsip reload');
}

// Bind-mounted runtime files are created by the host user, which Docker maps
// to root inside the container. Asterisk (uid 1000) would otherwise be unable
// to read the generated agent endpoints, so restore its ownership before the
// configuration reload.
async function chownRuntimeFile(
  containerPath = process.env.ASTERISK_PJSIP_AGENTS_CONTAINER_FILE || '/etc/asterisk/runtime/pjsip-agents.conf',
) {
  if (!enabled()) return { ok: false, reason: 'Asterisk CLI access is not enabled' };
  const bin = process.env.ASTERISK_CLI_BIN || 'docker';
  const container = process.env.ASTERISK_CLI_DOCKER_CONTAINER || 'asterisk-asterisk-1';
  if (bin !== 'docker') return { ok: true, skipped: true, reason: 'Ownership sync requires the Docker CLI' };
  try {
    await execFileAsync('docker', ['exec', '-u', 'root', container, 'chown', 'asterisk:asterisk', containerPath], { timeout: 10_000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.killed ? 'Asterisk CLI command timed out' : error.message };
  }
}

async function showChannelStats() {
  const result = await execute('pjsip show channelstats');
  if (!result.ok) return result;
  return { ...result, channels: parseChannelStats(result.output) };
}

// `pjsip show channelstats` (Asterisk 22, channels/pjsip/cli_commands.c)
// prints one row per channel as:
//
//   <BridgeId:8> <ChannelId:18> <UpTime:8> <Codec:6> <RxCount> <RxLost>
//   <RxPct> <RxJitter> <TxCount> <TxLost> <TxPct> <TxJitter> <Rtt>
//
// Two details make a naive parse wrong:
//   * the channel column is the channel *name* with the "PJSIP/" prefix
//     deliberately stripped (the CLI drops it to save a column) and the whole
//     field truncated to 18 characters, so no row ever contains "PJSIP/" and a
//     31-character endpoint username only ever appears truncated;
//   * counters above 100000 are printed divided by 1000 with a trailing "K".
// Rows without RTP ("direct media", "not valid") have no uptime column, so the
// uptime field (always HH:MM:SS) anchors the layout instead.
const UPTIME_PATTERN = /^\d{1,3}:\d{2}:\d{2}$/;

function parseCounter(token) {
  const match = /^(\d+)(K)?$/.exec(String(token ?? '').replace(/,/g, ''));
  if (!match) return NaN;
  return Number(match[1]) * (match[2] ? 1000 : 1);
}

function parseUptimeSeconds(tokens, uptimeIndex) {
  const [hours, minutes, seconds] = tokens[uptimeIndex].split(':').map(Number);
  // Durations past a day are printed as a separate leading day count.
  const days = uptimeIndex >= 3 && /^\d+$/.test(tokens[uptimeIndex - 1])
    ? Number(tokens[uptimeIndex - 1])
    : 0;
  return (days * 24 + hours) * 3600 + minutes * 60 + seconds;
}

function parseChannelStats(output) {
  const channels = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    const uptimeIndex = tokens.findIndex((token) => UPTIME_PATTERN.test(token));
    // Header, separator and non-RTP rows never carry an uptime column.
    if (uptimeIndex < 2) continue;
    const stats = tokens.slice(uptimeIndex + 2);
    if (stats.length < 9) continue;
    const rxPackets = parseCounter(stats[0]);
    const txPackets = parseCounter(stats[4]);
    if (!Number.isFinite(rxPackets) || !Number.isFinite(txPackets)) continue;
    channels.push({
      bridge: tokens[0],
      channel: tokens[1],
      codec: tokens[uptimeIndex + 1],
      uptimeSeconds: parseUptimeSeconds(tokens, uptimeIndex),
      rxPackets,
      txPackets,
      rxLost: parseCounter(stats[1]),
      rxPct: Number(stats[2]),
      txLost: parseCounter(stats[5]),
      txPct: Number(stats[6]),
    });
  }
  return channels;
}

// Asterisk reuses an endpoint username across sessions, so a failed run can
// leave several rows for the same agent. The freshest row (smallest uptime) is
// the one belonging to the call currently being observed.
function findChannelRow(channels, { username, channelId } = {}) {
  const needle = String(channelId || '');
  const truncated = String(username || '').slice(0, 18);
  const matches = (channels || []).filter((row) => (
    (truncated && String(row.channel || '').includes(truncated))
    || (needle && String(row.channel || '').includes(needle))
  ));
  if (!matches.length) return null;
  return matches.reduce((best, row) => (
    Number(row.uptimeSeconds) < Number(best.uptimeSeconds) ? row : best
  ));
}

async function endpointState(resource) {
  const result = await execute(`pjsip show endpoint ${String(resource).replace(/[^A-Za-z0-9_.-]/g, '')}`);
  if (!result.ok) return null;
  const match = result.output.match(/Endpoint:\s+\S+\s+(Not in use|Unavailable|Available|In use)\s+(\d+)\s+of\s+(\S+)/i);
  return match ? { state: match[1], channels: Number(match[2]) } : null;
}

module.exports = {
  enabled, execute, reloadPjsip, chownRuntimeFile, showChannelStats, parseChannelStats, findChannelRow,
  endpointState,
};
