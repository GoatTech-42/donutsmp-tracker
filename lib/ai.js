const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const KEYS = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean)
const MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b'
let keyIndex = 0

const SYSTEM_PROMPT = `You are a DonutSMP auction flip analyst. Output concise, actionable one-liners.

FORMAT (one line per opportunity, max 5 lines):
[BUY/SELL/CRAFT] [item] @ [price] → [action] @ [target] | Profit: [amt] | ROI: [%] | Risk: [L/M/H] | [one reason]

RULES:
- Factor in 5% auction tax on all sells
- Never invent prices — only use provided data
- For craft flips: ingredient names + costs → result + sell price
- For enchant items: note the premium enchantment adds
- Note neural predictions when they align with flip direction
- Note statistical outliers (Z-score > 2) as opportunities
- Max 5 lines. If nothing actionable: "NO ACTIONABLE FLIPS"

Example:
CRAFT Shulker Box @ 40K (5×Shulker Shell@8K) → SELL @ 120K | Profit: 74K | ROI: 185% | Risk: L | Craft cost well below floor`

const compact = n =>
  `$${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)}`

async function request(messages, maxTokens = 1200) {
  if (!KEYS.length) throw new Error('GROQ_API_KEY required')
  let lastError = 'No provider response'
  for (let offset = 0; offset < KEYS.length; offset++) {
    const index = (keyIndex + offset) % KEYS.length
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${KEYS[index]}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages, temperature: 0.1, max_tokens: maxTokens })
      })
      if (!response.ok) {
        lastError = `Provider ${response.status}`
        continue
      }
      const data = await response.json()
      keyIndex = (index + 1) % KEYS.length
      const content = data.choices?.[0]?.message?.content?.trim()
      // gpt-oss-120b can burn all tokens on reasoning and return empty content — retry once
      if (!content) {
        lastError = 'Empty completion (reasoning overflow)'
        continue
      }
      return { content, model: data.model, usage: data.usage }
    } catch (e) {
      lastError = e.name === 'AbortError' ? 'timeout' : e.message
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`AI unavailable: ${lastError}`)
}

function asText(v) {
  if (v == null) return '?'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  // Never let "[object Object]" leak into the prompt — that's what triggers the
  // cautious-assistant refusal the user just saw.
  try {
    if (typeof v === 'object') return v.display_name || v.name || v.id || JSON.stringify(v).slice(0, 80)
  } catch (_) {}
  return String(v)
}

function buildMarketContext(intel) {
  // Guard the empty-market path: with 0 flips the prompt would be near-empty
  // and the model correctly refuses to hallucinate. Surface that state explicitly.
  if (!intel.topFlips?.length && !intel.predictions?.length && !intel.outliers?.length) {
    return [
      `MARKET: empty — no actionable flips yet (auctions:${intel.summary.totalAuctions} sales:${intel.summary.recordedSales}).`,
      `Reply exactly: NO ACTIONABLE FLIPS`
    ].join('\n')
  }
  const lines = []
  lines.push(
    `AUCTIONS: ${intel.summary.totalAuctions} | ITEMS: ${intel.summary.uniqueItems} | SALES: ${intel.summary.recordedSales} | MKT VAL: ${compact(intel.summary.marketValue)}`
  )

  const craftFlips = intel.topFlips.filter(f => f.type === 'craft' && f.ingredients).slice(0, 8)
  if (craftFlips.length) {
    lines.push(`CRAFT FLIPS (${craftFlips.length}):`)
    for (const f of craftFlips) {
      const ingredients = f.ingredients
        .map(i => `${i.count}×${asText(i.name)}@${compact(i.unitPrice)}`)
        .join('+')
      lines.push(
        `${asText(f.name)} | ${ingredients} → ${compact(f.totalCost)} | SELL: ${compact(f.sellPrice)} | +${compact(f.profit)} | ROI:${f.roi}% | ${asText(f.risk?.label)}`
      )
    }
  }

  const marketFlips = intel.topFlips.filter(f => f.type !== 'craft').slice(0, 8)
  if (marketFlips.length) {
    lines.push(`MARKET FLIPS (${marketFlips.length}):`)
    for (const f of marketFlips) {
      lines.push(
        `${asText(f.name)} | Floor:${compact(f.buyPrice)} Fair:${compact(f.sellPrice)} | ${f.listings} list/${f.volume || f.sales || 0} sold | Vol:${f.volatility || 0}% | ${asText(f.risk?.label)}`
      )
    }
  }

  if (intel.enchantPremiums?.length) {
    lines.push(`ENCHANTS:`)
    for (const e of intel.enchantPremiums.slice(0, 6)) {
      lines.push(
        `${asText(e.enchantName)} Lv${asText(e.level)}: ×${e.valueMultiplier?.toFixed(2)} (+${compact(e.premiumOverBase)}), ${e.totalSales} sales`
      )
    }
  }

  if (intel.predictions?.length) {
    const sorted = [...intel.predictions].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    lines.push(`NN PRED:`)
    for (const p of sorted.slice(0, 6)) {
      lines.push(
        `${asText(p.name)}: ${compact(p.current)}→${compact(p.predicted)} Δ${p.change}% ${p.trend} (${p.confidence}%)`
      )
    }
  }

  if (intel.outliers?.length) {
    lines.push(`OUTLIERS:`)
    for (const o of intel.outliers.slice(0, 6)) {
      lines.push(
        `${asText(o.name)}: Z:${o.zScore} Dev:${o.deviation}% ${o.iqrOutlier ? 'IQR' : ''} ${asText(o.direction)} (${o.sales} sales)`
      )
    }
  }

  if (intel.anomalies?.length) {
    lines.push(`ANOMALIES:`)
    for (const a of intel.anomalies.slice(0, 4)) {
      lines.push(
        `${asText(a.item)}: ${asText(a.type)} score:${a.anomalyScore}% dev:${a.deviation}% ${compact(a.currentPrice)} vs avg ${compact(a.avgPrice)}`
      )
    }
  }

  if (intel.neuralNet?.pricePredictor?.trained) {
    lines.push(
      `NN: ${intel.neuralNet.pricePredictor.epochs}ep loss:${intel.neuralNet.pricePredictor.lastLoss?.toFixed(4)}`
    )
  }

  const out = lines.join('\n')
  // Final safety: if anything still stringified as [object Object], replace it
  return out.includes('[object Object]') ? out.replaceAll('[object Object]', '?') : out
}

function analyze(intel) {
  const context = buildMarketContext(intel)
  return request([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: context }
  ])
}

function quickInsight(question, context = '') {
  return request(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `${context}\nQ: ${question}\nAnswer in ONE LINE.` }
    ],
    300
  ).then(r => r.content)
}

module.exports = { analyze, quickInsight }
