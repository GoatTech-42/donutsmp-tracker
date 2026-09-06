// Runs MarketPredictor training off the main thread. Receives a model snapshot
// + price histories + auctions via workerData, trains, and posts back the
// updated save() + training metrics. Plain JS only (neural-network.js has no
// other deps) so it is safe to load inside a worker.
const { parentPort, workerData } = require('worker_threads')
const { MarketPredictor } = require('../lib/neural-network')

const { modelState, priceHistories, auctions } = workerData || {}

const predictor = new MarketPredictor()
if (modelState) predictor.load(modelState)

const histories = new Map(Object.entries(priceHistories || {}))

let train = { loss: 0, samples: 0 }
try {
  train = predictor.train(histories, auctions || [])
} catch (e) {
  train = { error: e.message }
}

parentPort.postMessage({ save: predictor.save(), train })
