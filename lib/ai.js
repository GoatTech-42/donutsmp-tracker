const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const KEYS = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean);
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
let keyIndex = 0;

const SYSTEM_PROMPT = `You are a DonutSMP market bot. Output ONE LINE per opportunity. Format:
BUY [item] @ [price] → SELL @ [target] | Profit: [amount] | ROI: [%] | Risk: [Low/Med/High] | Conf: [%] | Reason: [one sentence]

Rules:
- Only use provided market data
- Account for 5% auction tax
- Never invent prices
- One line per flip, max 5 lines
- If no good flips: "NO ACTIONABLE FLIPS"
- Factor in crafting recipes: if ingredients are cheaper than result, note craft flip
- Factor in enchantment premiums: enchanted items sell for more than base
- Factor in neural network predictions and anomaly signals
- Note outlier opportunities (items priced far from fair value)

Example:
BUY Shulker Box @ 75K → SELL @ 250K | Profit: 162K | ROI: 216% | Risk: Med | Conf: 95% | High sales volume, floor well below fair value`;

const compact = n => `$${new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n)}`;

async function request(messages, maxTokens = 600) {
  if (!KEYS.length) throw new Error('GROQ_API_KEY required');
  let lastError = 'No provider response';
  for (let offset = 0; offset < KEYS.length; offset++) {
    const index = (keyIndex + offset) % KEYS.length;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${KEYS[index]}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: maxTokens }) });
      if (!response.ok) { lastError = `Provider ${response.status}`; continue; }
      const data = await response.json();
      keyIndex = (index + 1) % KEYS.length;
      return { content: data.choices?.[0]?.message?.content || 'ERROR', model: data.model, usage: data.usage };
    } catch (e) { lastError = e.name === 'AbortError' ? 'timeout' : e.message; }
    finally { clearTimeout(timer); }
  }
  throw new Error(`AI unavailable: ${lastError}`);
}

function buildMarketContext(intel) {
  const lines = [];
  lines.push(`AUCTIONS: ${intel.summary.totalAuctions} | ITEMS: ${intel.summary.uniqueItems} | SALES: ${intel.summary.recordedSales} | MKT VAL: ${compact(intel.summary.marketValue)}`);
  
  const craftFlips = intel.topFlips.filter(f => f.type === 'craft' && f.ingredients).slice(0, 5);
  if (craftFlips.length) {
    lines.push(`CRAFT FLIPS:`);
    for (const f of craftFlips) {
      const ingredients = f.ingredients.map(i => `${i.count}×${i.name}@${compact(i.unitPrice)}`).join('+');
      lines.push(`CRAFT | ${f.name} | Cost: ${compact(f.totalCost)} (${ingredients}) → Sell: ${compact(f.sellPrice)} | Profit: ${compact(f.profit)} | ROI: ${f.roi}% | Risk: ${f.risk.label} | Conf: ${f.confidence}%`);
    }
  }
  
  const marketFlips = intel.topFlips.filter(f => f.type !== 'craft').slice(0, 5);
  if (marketFlips.length) {
    lines.push(`MARKET FLIPS:`);
    for (const f of marketFlips) {
      lines.push(`${f.type.toUpperCase()} | ${f.name} | Floor: ${compact(f.floor || f.buyPrice)} | Fair: ${compact(f.fairValue || f.sellPrice)} | Listings: ${f.listings} | Sales: ${f.sales || f.volume} | Vol: ${f.volatility || 0}% | Conf: ${f.confidence}%`);
    }
  }
  
  if (intel.enchantPremiums?.length) {
    lines.push(`ENCHANT PREMIUMS:`);
    for (const e of intel.enchantPremiums.slice(0, 5)) {
      lines.push(`${e.enchantName} ${e.level} on ${e.baseItem}: ${(e.valueMultiplier * 100).toFixed(0)}% of base, +${compact(e.premiumOverBase)} premium`);
    }
  }
  
  if (intel.predictions?.length) {
    lines.push(`NN PREDS:`);
    for (const p of intel.predictions.slice(0, 8)) {
      lines.push(`${p.name} | Cur: ${compact(p.current)} | Pred: ${compact(p.predicted)} | Δ: ${p.change}% | Trend: ${p.trend} | Conf: ${p.confidence}%`);
    }
  }
  
  if (intel.anomalies?.length) {
    lines.push(`OUTLIERS/ANOMALIES:`);
    for (const a of intel.anomalies.slice(0, 5)) {
      lines.push(`${a.item} | ${a.type} | Deviation: ${a.deviation}% | Score: ${a.anomalyScore}% | Current: ${compact(a.currentPrice)} vs Avg: ${compact(a.avgPrice)} | ${a.listings} listings`);
    }
  }
  
  if (intel.outliers?.length) {
    lines.push(`STATISTICAL OUTLIERS (Z>2):`);
    for (const o of intel.outliers.slice(0, 5)) {
      lines.push(`${o.name} | Z-score: ${o.zScore} | Price: ${compact(o.price)} vs Avg: ${compact(o.avg)} | IQR flag: ${o.iqrOutlier ? 'YES' : 'no'} | ${o.sales} sales`);
    }
  }
  
  if (intel.neuralNet?.pricePredictor?.trained) {
    lines.push(`NN: ${intel.neuralNet.pricePredictor.epochs} epochs, loss ${intel.neuralNet.pricePredictor.lastLoss?.toFixed(4)}`);
  }
  
  return lines.join('\n');
}

function analyze(intel) {
  const context = buildMarketContext(intel);
  return request([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: context }]);
}

function quickInsight(question, context = '') {
  return request([{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: `${context}\nQ: ${question}\nAnswer in ONE LINE.` }], 300).then(r => r.content);
}

module.exports = { analyze, quickInsight };
