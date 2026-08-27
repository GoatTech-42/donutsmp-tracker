const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const KEYS = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean);
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
let keyIndex = 0;

const SYSTEM_PROMPT = `You are a cautious DonutSMP market research assistant. Use only the supplied observations. Distinguish completed sales from active listings, account for the configured auction tax, state uncertainty, never invent prices or claim guaranteed profit, and return concise markdown with actionable entry, exit, risk, and confidence notes.`;

async function request(messages, maxTokens = 1200) {
  if (!KEYS.length) {
    const error = new Error('AI analysis is optional and requires GROQ_API_KEY');
    error.status = 503;
    throw error;
  }
  let lastError = 'No provider response';
  for (let offset = 0; offset < KEYS.length; offset++) {
    const index = (keyIndex + offset) % KEYS.length;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${KEYS[index]}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, temperature: .25, max_tokens: maxTokens }) });
      if (!response.ok) { lastError = `Provider returned ${response.status}`; continue; }
      const data = await response.json();
      keyIndex = (index + 1) % KEYS.length;
      return { content: data.choices?.[0]?.message?.content || 'No analysis returned.', model: data.model, usage: data.usage };
    } catch (error) { lastError = error.name === 'AbortError' ? 'Provider timed out' : error.message; }
    finally { clearTimeout(timer); }
  }
  const error = new Error(`AI analysis unavailable: ${lastError}`);
  error.status = 502;
  throw error;
}

function analyze(marketData, requestText = '') {
  return request([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Market observations:\n${marketData}\n\nAdditional request:\n${requestText || 'Summarize the three best risk-adjusted opportunities.'}` }]);
}
function quickInsight(question, context = '') {
  return request([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `Context: ${context}\n\nQuestion: ${question}` }], 700).then(result => result.content);
}
module.exports = { analyze, quickInsight };
