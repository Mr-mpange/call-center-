'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildComprehensiveSummaryPrompt, buildSummaryValidationPrompt, formatTranscript, inferLanguageHint, parseSummaryResponse, generateValidatedSummary } = require('../src/services/callSummary');

test('summary prompt includes the complete multilingual transcript and evidence rules', () => {
  const transcript = [
    { speaker: 'customer', language: 'Kiswahili', atSec: 0, text: 'Nimetozwa TSh 45,000 mara mbili jana saa tatu usiku.' },
    { speaker: 'agent', language: 'English', atSec: 8, text: 'I checked the ledger and found a duplicate pending charge.' },
    { speaker: 'customer', language: 'Mixed', atSec: 16, text: 'Please reverse one charge and send confirmation by SMS.' },
  ];
  const prompt = buildComprehensiveSummaryPrompt({ call: { outcome: 'resolved' }, transcript });
  assert.match(prompt, /TSh 45,000/);
  assert.match(prompt, /duplicate pending charge/);
  assert.match(prompt, /reverse one charge/);
  assert.match(prompt, /COMPLETE TRANSCRIPT/);
  assert.match(prompt, /Never call a case resolved merely because/);
  assert.match(prompt, /Swahili\/Kiswahili/);
  assert.equal(formatTranscript(transcript).split('\n').length, 3);
});

test('summary parser preserves the complete paragraph and structured evidence', () => {
  const parsed = parseSummaryResponse(JSON.stringify({
    summary: 'The customer reported a duplicate TSh 45,000 charge; the agent verified it as pending and promised an SMS update after reversal.',
    reason: 'Duplicate charge',
    discussion: ['TSh 45,000 charged twice'],
    resolution: 'Reversal promised; not yet confirmed',
    unresolved: ['Final reversal confirmation'],
    nextSteps: ['Billing team to send SMS update'],
    suggestions: [],
  }));
  assert.match(parsed.summary, /duplicate TSh 45,000/);
  assert.equal(parsed.resolution, 'Reversal promised; not yet confirmed');
  assert.deepEqual(parsed.unresolved, ['Final reversal confirmation']);
});

test('summary parser builds a paragraph when provider omits the summary field', () => {
  const parsed = parseSummaryResponse(JSON.stringify({
    reason: 'Duplicate charge',
    discussion: ['The agent verified a pending duplicate'],
    resolution: 'Reversal promised; not confirmed',
    unresolved: ['Final confirmation'],
    nextSteps: ['Billing team to send an SMS'],
  }));
  assert.notEqual(parsed.summary, 'Not established.');
  assert.match(parsed.summary, /Duplicate charge/i);
  assert.match(parsed.summary, /Final confirmation/i);
});

test('summary prompt applies configured TZS without inferring KES from Swahili', () => {
  const prompt = buildComprehensiveSummaryPrompt({
    transcript: 'CUSTOMER: Nimekatwa shilingi elfu kumi.',
    languageHint: 'kiswahili',
    localization: { country: 'Tanzania', timezone: 'Africa/Dar_es_Salaam', defaultCurrency: 'TZS', preferredLanguage: 'Kiswahili' },
  });
  assert.match(prompt, /TZS/);
  assert.match(prompt, /Never infer KES from Swahili/);
  assert.match(prompt, /Write the summary in Kiswahili/);
});

test('summary prompt preserves ambiguous shilingi when tenant currency is unknown', () => {
  const prompt = buildComprehensiveSummaryPrompt({ transcript: 'CUSTOMER: Nimetuma shilingi elfu tano.' });
  assert.match(prompt, /preserve the original wording/);
  assert.match(prompt, /currency code is unknown/);
});

test('language detection recognizes multilingual transcript metadata', () => {
  assert.equal(inferLanguageHint([{ language: 'Kiswahili' }, { language: 'English' }]), 'mixed');
  assert.equal(inferLanguageHint([{ language: 'Kiswahili' }, { language: 'Kiswahili' }]), 'kiswahili');
});

test('validation stage sends the complete transcript and draft back to the model', async () => {
  const prompts = [];
  const result = await generateValidatedSummary({
    call: { outcome: 'completed' },
    transcript: 'CUSTOMER: Nimeomba kurejeshewa TZS 10,000. AGENT: Nita-forward kwa billing.',
    languageHint: 'kiswahili',
    localization: { defaultCurrency: 'TZS' },
    generate: async (prompt) => {
      prompts.push(prompt);
      return JSON.stringify({ summary: 'Muhtasari wa mazungumzo.', reason: 'Refund', discussion: [], resolution: 'Pending', unresolved: ['Refund not confirmed'], nextSteps: [], suggestions: [] });
    },
  });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /COMPLETE TRANSCRIPT/);
  assert.match(prompts[1], /DRAFT SUMMARY/);
  assert.equal(result.summary, 'Muhtasari wa mazungumzo.');
  assert.match(buildSummaryValidationPrompt({ transcript: 'shilingi', draft: result }), /shilingi/);
});
