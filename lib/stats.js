// Pure, dependency-free market statistics. Imported by analyzer.js and unit tests.

const TAX_RATE = Number(process.env.AUCTION_TAX_RATE || 0.05)

const normalize = value =>
  String(value || '')
    .toLowerCase()
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')

const percentile = (values, p) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * p
  const lower = Math.floor(index)
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower)
}

// IQR filter: drop prices that sit far outside the middle 50% of listings.
// Falls back to raw when there aren't enough samples for a stable IQR.
function iqrFilter(values) {
  if (values.length < 10) return values.slice()
  const sorted = [...values].sort((a, b) => a - b)
  const q1 = percentile(sorted, 0.25)
  const q3 = percentile(sorted, 0.75)
  const iqr = q3 - q1
  if (iqr === 0) return values.slice()
  const lo = q1 - 1.5 * iqr
  const hi = q3 + 1.5 * iqr
  const filtered = values.filter(v => v >= lo && v <= hi)
  return filtered.length < values.length * 0.4 ? values.slice() : filtered
}

function madFilter(values) {
  if (values.length < 6) return values.slice()
  const med = percentile([...values].sort((a, b) => a - b), 0.5)
  const deviations = values.map(v => Math.abs(v - med)).sort((a, b) => a - b)
  const mad = percentile(deviations, 0.5) || 1
  const lo = med - 3.5 * 1.4826 * mad
  const hi = med + 3.5 * 1.4826 * mad
  return values.filter(v => v >= lo && v <= hi)
}

const ENCHANT_MULTIPLIERS = {
  protection: { 1: 1.05, 2: 1.12, 3: 1.2, 4: 1.3 },
  fire_protection: { 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.25 },
  feather_falling: { 1: 1.02, 2: 1.05, 3: 1.1, 4: 1.18 },
  blast_protection: { 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.25 },
  projectile_protection: { 1: 1.03, 2: 1.08, 3: 1.15, 4: 1.25 },
  sharpness: { 1: 1.08, 2: 1.18, 3: 1.3, 4: 1.45, 5: 1.65 },
  smite: { 1: 1.05, 2: 1.12, 3: 1.2, 4: 1.3, 5: 1.45 },
  bane_of_arthropods: { 1: 1.03, 2: 1.08, 3: 1.12, 4: 1.18, 5: 1.25 },
  knockback: { 1: 1.02, 2: 1.06 },
  fire_aspect: { 1: 1.05, 2: 1.12 },
  looting: { 1: 1.08, 2: 1.18, 3: 1.3 },
  efficiency: { 1: 1.05, 2: 1.12, 3: 1.2, 4: 1.3, 5: 1.45 },
  silk_touch: { 1: 1.15 },
  unbreaking: { 1: 1.08, 2: 1.18, 3: 1.3 },
  fortune: { 1: 1.1, 2: 1.22, 3: 1.4 },
  power: { 1: 1.08, 2: 1.18, 3: 1.3, 4: 1.45, 5: 1.6 },
  punch: { 1: 1.03, 2: 1.08 },
  flame: { 1: 1.1 },
  infinity: { 1: 1.15 },
  luck_of_the_sea: { 1: 1.05, 2: 1.12, 3: 1.2 },
  lure: { 1: 1.03, 2: 1.08, 3: 1.12 },
  mending: { 1: 1.25 },
  binding_curse: { 1: 0.95 },
  vanishing_curse: { 1: 0.95 },
  thorns: { 1: 1.05, 2: 1.12, 3: 1.2 },
  depth_strider: { 1: 1.03, 2: 1.08, 3: 1.12 },
  frost_walker: { 1: 1.03, 2: 1.08 },
  soul_speed: { 1: 1.03, 2: 1.08, 3: 1.12 },
  swift_sneak: { 1: 1.08, 2: 1.15, 3: 1.25 }
}

module.exports = { TAX_RATE, normalize, percentile, iqrFilter, madFilter, ENCHANT_MULTIPLIERS }
