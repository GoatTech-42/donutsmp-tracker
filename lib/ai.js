const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2
].filter(Boolean);
let keyIndex = 0;

const SYSTEM_PROMPT = `You are DonutSMP's market analyst. Analyze auction house data and give investment advice.

SERVER RULES:
- Hardcore anarchy server, Java+Bedrock (donutsmp.net)
- Currencies: Money (coins) and Shards (AFK 1/min, kills 10/kill)
- /ah max 25 listings, /orders for wholesale, /sell for instant cash
- /shop removed June 2026. TNT duping allowed. Season 2 (Dec 2024)
- Border expanding to 30M blocks (drops prices for scarce items)

KNOWN PRICES: Dragon Head ~23.6M, Netherite Block ~48M, Ancient Debris ~1.3M, Beacon ~128K, Enchanted Golden Apple ~743K, Diamond Block ~30K, Bottle o' Enchanting 6-20K, Redstone Block AH ~300K vs /orders ~146K

ANALYZE:
1. Price trends & momentum (which items gaining/losing value?)
2. Cross-market arbitrage (/orders buy vs /ah sell spreads)
3. Supply shifts & what they mean for prices
4. Flip opportunities with specific buy/sell targets
5. Risk: bubbles, crashes, border expansion impact
6. Top player wealth trends from leaderboards

FORMAT: Use markdown. Lead with top 3 picks. Include specific coin targets and ROI%. Mark risk levels.`;

async function groqRequest(messages, maxTokens = 1024) {
  if (!GROQ_KEYS.length) throw new Error('No GROQ_API_KEY set');
  let lastErr;
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const key = GROQ_KEYS[(keyIndex + i) % GROQ_KEYS.length];
    try {
      const res = await fetch(GROQ_API, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          messages,
          temperature: 0.7,
          max_tokens: maxTokens
        })
      });
      if (!res.ok) { lastErr = await res.text(); continue; }
      const data = await res.json();
      keyIndex = (keyIndex + i) % GROQ_KEYS.length;
      return { content: data.choices?.[0]?.message?.content || 'No response.', model: data.model, usage: data.usage };
    } catch (e) { lastErr = e.message; }
  }
  throw new Error('Groq failed: ' + lastErr);
}

async function analyze(marketData, extraContext = '') {
  const prompt = 'Analyze this DonutSMP market data:\n\n' + marketData;
  return groqRequest([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: extraContext ? prompt + '\n\n' + extraContext : prompt }
  ], 1536);
}

async function quickInsight(question, context = '') {
  const res = await groqRequest([
    { role: 'system', content: 'DonutSMP market expert. Answer concisely with specific coin values. ' + context },
    { role: 'user', content: question }
  ], 512);
  return res.content;
}

module.exports = { analyze, quickInsight };
