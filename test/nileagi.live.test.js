const test = require('node:test');
const fs = require('node:fs');
require('dotenv').config();
const config = require('../src/integrations/nileagi/config');
const client = require('../src/integrations/nileagi/client');

const current = config.fromEnv();
const liveEnabled = process.env.NILEAGI_LIVE_TEST === 'true';
const audioFile = process.env.NILEAGI_LIVE_AUDIO_FILE;
const ready = liveEnabled && current.enabled && current.adapter === 'rafiki-api' && current.apiKey && current.baseUrl && current.ttsEnabled;

test('NileAGI live Rafiki API integration', { skip: ready ? false : 'Live test not run: configure NILEAGI_LIVE_TEST=true and a real Rafiki API key' }, async () => {
  const health = await client.health();
  assertHealth(health);
  const voices = await client.listVoices();
  if (!voices) throw new Error('Live Rafiki voices request returned no response');
  const tts = await client.synthesize('Habari za siku.', { language: 'sw' });
  if (!tts.audio.length) throw new Error('Live TTS returned no audio');
  if (current.sttEnabled) {
    const stt = await client.transcribe(audioFile && fs.existsSync(audioFile) ? fs.readFileSync(audioFile) : tts.audio, { language: 'sw', filename: 'live.wav' });
    if (!stt.text) throw new Error('Live STT returned no transcript');
  }
  if (current.voiceEnabled) {
    const turn = await client.talk(tts.audio, { language: 'sw' });
    if (!turn || typeof turn !== 'object' || typeof turn.transcript !== 'string' || typeof turn.reply !== 'string' || typeof turn.audio_url !== 'string') {
      throw new Error('Live Talk response did not contain transcript, reply, and audio_url');
    }
  }
});

function assertHealth(value) {
  if (!value || (value.status && value.status !== 'ok')) throw new Error(`Rafiki health check failed: ${JSON.stringify(value)}`);
}
