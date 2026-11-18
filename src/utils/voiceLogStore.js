const fs = require('fs');
const path = require('path');

const logFile = process.env.VOICE_LOG_FILE || path.join(process.cwd(), 'data', 'voice-events.jsonl');

function append(event) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...event })}\n`, 'utf8');
}

function readAll() {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch (error) {
        console.error('[Voice Logs] skipping malformed log record:', error.message);
        return [];
      }
    });
}

module.exports = { append, readAll };
