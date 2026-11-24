'use strict';

const EMPTY_SUMMARY = {
  summary: 'Not established.',
  reason: 'Not established.',
  discussion: [],
  resolution: 'Not established.',
  unresolved: [],
  nextSteps: [],
  suggestions: [],
  issues: [],
};

function formatTranscript(transcript) {
  if (Array.isArray(transcript)) {
    return transcript.map((segment, index) => {
      const speaker = String(segment?.speaker || 'unknown').toUpperCase();
      const atSec = Number.isFinite(Number(segment?.atSec)) ? ` [${Number(segment.atSec)}s]` : '';
      const language = segment?.language ? ` (${segment.language})` : '';
      return `${index + 1}. ${speaker}${language}${atSec}: ${String(segment?.text || '').trim()}`;
    }).filter((line) => !/:\s*$/.test(line)).join('\n');
  }
  return String(transcript || '').trim();
}

function inferLanguageHint(transcript) {
  if (!Array.isArray(transcript) || !transcript.length) return 'auto';
  const languages = transcript.map((segment) => String(segment?.language || '').toLowerCase()).filter(Boolean);
  const swahili = languages.filter((language) => language.includes('swah') || language === 'sw' || language === 'kiswahili').length;
  const english = languages.filter((language) => language.includes('english') || language === 'en').length;
  if (swahili > english && swahili >= languages.length / 2) return 'kiswahili';
  if (english > swahili && english >= languages.length / 2) return 'english';
  if (swahili && english) return 'mixed';
  return 'auto';
}

function buildComprehensiveSummaryPrompt({ call = {}, transcript = '', languageHint = 'auto', localization = {} } = {}) {
  const formattedTranscript = formatTranscript(transcript);
  const requestedLanguage = String(languageHint || 'auto').toLowerCase();
  const languageInstruction = requestedLanguage === 'kiswahili' || requestedLanguage === 'swahili'
    ? 'Write the summary in Kiswahili. Do not translate it into English.'
    : requestedLanguage === 'english'
      ? 'Write the summary in English.'
      : requestedLanguage === 'mixed'
        ? 'Preserve the natural English/Kiswahili mix used in the conversation.'
        : 'Automatically detect the dominant language. If the conversation is predominantly Kiswahili, write the summary in Kiswahili; do not default to English. If it is predominantly English, write it in English. For a genuinely mixed conversation, preserve the natural mix or use the dominant language.';
  const localeContext = JSON.stringify({
    country: localization.country || 'unknown',
    timezone: localization.timezone || 'unknown',
    defaultCurrency: localization.defaultCurrency || 'unknown',
    preferredLanguage: localization.preferredLanguage || 'unknown',
    dateFormat: localization.dateFormat || 'unknown',
  });
  return `You are a senior customer-experience quality analyst. Analyze the COMPLETE customer-agent conversation from the first interaction through the final statement. Use every transcript turn; do not summarize only the opening complaint.

Return ONLY valid JSON with exactly these keys:
{
  "summary": "one coherent professional paragraph for the next agent, supervisor, or manager",
  "reason": "primary reason for the call",
  "discussion": ["important customer concerns, requests, facts, references, amounts, dates, identifiers, investigation findings, and decisions"],
  "resolution": "confirmed final resolution status",
  "unresolved": ["issues still open or information not confirmed"],
  "nextSteps": ["follow-up commitments with responsible person or department and timeframe when stated"],
  "suggestions": ["supported operational suggestions requiring human review"],
  "issues": [{"issue":"only transcript-supported issue wording","claimOrFinding":"customer claim, suspected incident, verified finding, or confirmed fact","actionsCompleted":[],"commitments":[],"owner":"only if stated","status":"resolved, partially resolved, pending, escalated, or unknown"}]
}

The paragraph in "summary" must explain the interaction end-to-end: why the customer called, what they requested or complained about, relevant numbers/amounts/dates/identifiers, what the agent investigated and found, root cause when evidenced, actions already completed, proposed solutions or escalations, promised timeframes, follow-up ownership, communication preferences, sentiment changes, final resolution status, and outstanding issues.

Distinguish explicitly in the wording between completed actions, promised actions, estimates, and confirmed resolutions. Never call a case resolved merely because the customer sounded satisfied, said thanks, or ended the call. A call is resolved only when the transcript confirms the issue was actually resolved; otherwise say pending, partially resolved, escalated, or unresolved.

STRICT SEMANTIC GROUNDING:
- Use the narrowest wording supported by the transcript. Do not add a service type, product, location, country, customer identity, cause, incident classification, or transaction interpretation that was not stated or verified.
- Keep customer-reported claims, suspected incidents, verified findings, confirmed facts, recommendations, completed actions, and future commitments explicitly separate. An unauthorized transaction is not confirmed fraud unless the transcript says it was verified as fraud.
- Preserve commitment semantics exactly: starting or conducting an investigation is not completing it; a progress update is not a resolution; an estimated investigation timeframe is not a guaranteed completion or resolution deadline; a recommendation is not an action performed.
- Resolve today, tomorrow, yesterday, next Friday, and similar expressions against the call timestamp and organization timezone below. Never use the current summary-generation date. If no call timestamp exists, preserve the original relative wording instead of inventing a calendar date.
- Track every distinct issue independently in "issues", including its findings, completed actions, owner, commitments, and status. Derive the overall resolution only from those issue statuses, not from the call outcome metadata.

Support English, Swahili/Kiswahili, and mixed-language conversations. Understand East African terminology, currencies, dates, and Swahili time expressions. Preserve exact reference numbers and amounts when present.

OUTPUT LANGUAGE REQUIREMENT: ${languageInstruction}

ORGANIZATION LOCALIZATION (use only when not "unknown"): ${localeContext}
Currency rule: an explicit currency in the conversation always wins. For an ambiguous term such as "shilingi", use the organization's configured defaultCurrency only when it is present and applicable. Never infer KES from Swahili. If no reliable currency is available, preserve the original wording and say the currency code is unknown.

Do not fabricate, infer unsupported root causes, or fill missing details. Use "Not established." or an empty array when the transcript does not provide the information. Treat the provider outcome as metadata, not proof of resolution.

Call metadata (trusted context only; transcript evidence takes precedence):
${JSON.stringify({ caller: call.caller, phone: call.phone, direction: call.direction, queue: call.queue, agent: call.agent, outcome: call.outcome, callTimestamp: call.startedAt || call.createdAt || call.timestamp || call.date || null })}

COMPLETE TRANSCRIPT:
${formattedTranscript || '[No transcript was provided]'}`;
}

function parseSummaryResponse(text) {
  const candidate = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(candidate);
    const reason = String(parsed.reason || EMPTY_SUMMARY.reason);
    const discussion = Array.isArray(parsed.discussion) ? parsed.discussion.map(String) : [];
    const resolution = String(parsed.resolution || EMPTY_SUMMARY.resolution);
    const unresolved = Array.isArray(parsed.unresolved) ? parsed.unresolved.map(String) : [];
    const nextSteps = Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [];
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [];
    const issues = Array.isArray(parsed.issues) ? parsed.issues.map((issue) => ({
      issue: String(issue?.issue || 'Unknown issue'),
      claimOrFinding: String(issue?.claimOrFinding || 'Not established.'),
      actionsCompleted: Array.isArray(issue?.actionsCompleted) ? issue.actionsCompleted.map(String) : [],
      commitments: Array.isArray(issue?.commitments) ? issue.commitments.map(String) : [],
      owner: issue?.owner ? String(issue.owner) : null,
      status: String(issue?.status || 'unknown'),
    })) : [];
    const generatedParagraph = [
      reason !== EMPTY_SUMMARY.reason ? `The customer contacted support because ${reason.toLowerCase()}.` : '',
      discussion.length ? `The conversation covered ${discussion.join('; ')}.` : '',
      resolution !== EMPTY_SUMMARY.resolution ? `Resolution status: ${resolution}.` : '',
      unresolved.length ? `Outstanding issues: ${unresolved.join('; ')}.` : '',
      nextSteps.length ? `Next steps: ${nextSteps.join('; ')}.` : '',
    ].filter(Boolean).join(' ');
    return {
      summary: String(parsed.summary || generatedParagraph || EMPTY_SUMMARY.summary),
      reason,
      discussion,
      resolution,
      unresolved,
      nextSteps,
      suggestions,
      issues,
    };
  } catch {
    // Preserve a provider's plain-text response as the paragraph rather than
    // losing useful output, while leaving unsupported fields explicitly empty.
    return { ...EMPTY_SUMMARY, summary: candidate || EMPTY_SUMMARY.summary, reason: candidate || EMPTY_SUMMARY.reason };
  }
}

function buildSummaryValidationPrompt({ call = {}, transcript = '', draft, languageHint = 'auto', localization = {} } = {}) {
  return `You are a strict factual reviewer for a customer-service call summary. Compare the DRAFT SUMMARY against the COMPLETE TRANSCRIPT and return ONLY valid JSON in the same summary schema: summary, reason, discussion, resolution, unresolved, nextSteps, suggestions, issues.

Correct or remove anything unsupported. Preserve customer claims as claims, distinguish agent findings from claims, and never upgrade a promise, estimate, customer satisfaction, polite ending, or provider outcome into a confirmed resolution. Verify every amount, currency wording/code, reference number, date, deadline, person, department, escalation, commitment, service/product classification, and status against the transcript and organization context. Preserve relative dates when the call timestamp is unavailable; otherwise resolve them using the call timestamp and timezone, never today's date. If "shilingi" is ambiguous and no default currency is configured, keep "shilingi" and state that the currency code is unknown. Keep the selected output language consistent: ${languageHint || 'automatic detection'}.

Organization context: ${JSON.stringify(localization)}
Call metadata: ${JSON.stringify({ caller: call.caller, phone: call.phone, direction: call.direction, queue: call.queue, agent: call.agent, outcome: call.outcome, callTimestamp: call.startedAt || call.createdAt || call.timestamp || call.date || null })}

COMPLETE TRANSCRIPT:
${formatTranscript(transcript) || '[No transcript]'}

DRAFT SUMMARY:
${JSON.stringify(draft)}`;
}

function hasUsefulSummary(summary) {
  return summary && String(summary.summary || '').trim() && String(summary.summary).trim() !== EMPTY_SUMMARY.summary;
}

async function generateValidatedSummary({ call, transcript, languageHint = 'auto', localization = {}, generate }) {
  const draft = parseSummaryResponse(await generate(buildComprehensiveSummaryPrompt({ call, transcript, languageHint, localization })));
  if (!hasUsefulSummary(draft)) return draft;
  try {
    const reviewed = parseSummaryResponse(await generate(buildSummaryValidationPrompt({ call, transcript, draft, languageHint, localization })));
    return hasUsefulSummary(reviewed) ? reviewed : draft;
  } catch {
    // Validation is a safety enhancement; preserve the first complete draft if
    // a second provider call is temporarily unavailable.
    return draft;
  }
}

module.exports = { EMPTY_SUMMARY, formatTranscript, inferLanguageHint, buildComprehensiveSummaryPrompt, buildSummaryValidationPrompt, parseSummaryResponse, generateValidatedSummary };
