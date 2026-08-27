class NeuralNetwork {
  constructor(inputSize, hiddenSizes, outputSize, learningRate = 0.01) {
    this.inputSize = inputSize;
    this.hiddenSizes = hiddenSizes;
    this.outputSize = outputSize;
    this.learningRate = learningRate;
    this.layers = [];
    this.weights = [];
    this.biases = [];
    this.bnGamma = [];
    this.bnBeta = [];
    this.bnMean = [];
    this.bnVar = [];
    this.trained = false;
    this.epochs = 0;
    this.lossHistory = [];
    this.dropoutRate = 0.1;
    this.initLayers();
  }
  
  initLayers() {
    const sizes = [this.inputSize, ...this.hiddenSizes, this.outputSize];
    for (let i = 0; i < sizes.length - 1; i++) {
      const rows = sizes[i + 1];
      const cols = sizes[i];
      const std = Math.sqrt(2 / cols);
      this.weights[i] = Array.from({ length: rows }, () => 
        Array.from({ length: cols }, () => (Math.random() - 0.5) * 2 * std)
      );
      this.biases[i] = new Array(rows).fill(0).map(() => Math.random() * 0.1 - 0.05);
      if (i < sizes.length - 2) {
        this.bnGamma[i] = new Array(rows).fill(1);
        this.bnBeta[i] = new Array(rows).fill(0);
        this.bnMean[i] = new Array(rows).fill(0);
        this.bnVar[i] = new Array(rows).fill(1);
      }
    }
  }
  
  relu(x) { return Math.max(0, x); }
  reluDerivative(x) { return x > 0 ? 1 : 0; }
  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  softmax(x) { const max = Math.max(...x); const exp = x.map(v => Math.exp(v - max)); const sum = exp.reduce((a,b)=>a+b,0); return exp.map(v => v/sum); }
  
  batchNormForward(x, layerIdx, training) {
    if (layerIdx >= this.bnGamma.length) return x;
    let mean, var;
    if (training) {
      mean = x.reduce((a,b)=>a+b,0) / x.length;
      var = x.reduce((sum, v) => sum + (v - mean)**2, 0) / x.length;
      this.bnMean[layerIdx] = 0.9 * this.bnMean[layerIdx] + 0.1 * mean;
      this.bnVar[layerIdx] = 0.9 * this.bnVar[layerIdx] + 0.1 * var;
    } else {
      mean = this.bnMean[layerIdx];
      var = this.bnVar[layerIdx];
    }
    return x.map((v, i) => this.bnGamma[layerIdx][i] * (v - mean) / Math.sqrt(var + 1e-5) + this.bnBeta[layerIdx][i]);
  }
  
  dropout(x, training) {
    if (!training || this.dropoutRate === 0) return x;
    const mask = x.map(() => Math.random() > this.dropoutRate ? 1/(1-this.dropoutRate) : 0);
    return x.map((v, i) => v * mask[i]);
  }
  
  forward(input, training = false) {
    this.layers[0] = input;
    for (let i = 0; i < this.weights.length; i++) {
      const next = new Array(this.weights[i].length).fill(0);
      for (let j = 0; j < this.weights[i].length; j++) {
        let sum = this.biases[i][j];
        for (let k = 0; k < this.layers[i].length; k++) {
          sum += this.weights[i][j][k] * this.layers[i][k];
        }
        if (i < this.weights.length - 1) {
          sum = this.relu(sum);
          sum = this.batchNormForward([sum], i, training)[0];
          sum = this.dropout(sum, training)[0];
        }
        next[j] = sum;
      }
      this.layers[i + 1] = next;
    }
    if (this.outputSize > 1) {
      this.layers[this.layers.length - 1] = this.softmax(this.layers[this.layers.length - 1]);
    }
    return this.layers[this.layers.length - 1];
  }
  
  backward(target) {
    const output = this.layers[this.layers.length - 1];
    let errors = this.outputSize === 1 
      ? [target[0] - output[0]]
      : output.map((o, i) => target[i] - o);
    
    for (let i = this.weights.length - 1; i >= 0; i--) {
      const layerOutput = this.layers[i + 1];
      const layerInput = this.layers[i];
      
      for (let j = 0; j < this.weights[i].length; j++) {
        let derivative = 1;
        if (i < this.weights.length - 1) {
          derivative = this.reluDerivative(layerOutput[j]);
        }
        const delta = errors[j] * derivative * this.learningRate;
        
        for (let k = 0; k < layerInput.length; k++) {
          this.weights[i][j][k] += delta * layerInput[k];
        }
        this.biases[i][j] += delta;
        
        if (i > 0) {
          for (let k = 0; k < this.weights[i - 1][0].length; k++) {
            errors[k] = (errors[k] || 0) + delta * this.weights[i][j][k];
          }
        }
      }
    }
    
    return errors.reduce((sum, e) => sum + e * e, 0) / (errors.length || 1);
  }
  
  train(inputs, targets, epochs = 100, batchSize = 32) {
    let totalLoss = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;
      const indices = Array.from({ length: inputs.length }, (_, i) => i).sort(() => Math.random() - 0.5);
      
      for (let b = 0; b < indices.length; b += batchSize) {
        const batchIndices = indices.slice(b, b + batchSize);
        let batchLoss = 0;
        for (const idx of batchIndices) {
          this.forward(inputs[idx], true);
          batchLoss += this.backward(targets[idx]);
        }
        epochLoss += batchLoss / batchIndices.length;
      }
      totalLoss = epochLoss / Math.ceil(inputs.length / batchSize);
      this.lossHistory.push(totalLoss);
      this.epochs++;
      
      if (epoch % 10 === 0) {
        this.learningRate *= 0.995;
      }
    }
    this.trained = true;
    return totalLoss;
  }
  
  predict(input) {
    return this.forward(input, false);
  }
  
  save() {
    return {
      inputSize: this.inputSize,
      hiddenSizes: this.hiddenSizes,
      outputSize: this.outputSize,
      learningRate: this.learningRate,
      weights: this.weights,
      biases: this.biases,
      bnGamma: this.bnGamma,
      bnBeta: this.bnBeta,
      bnMean: this.bnMean,
      bnVar: this.bnVar,
      epochs: this.epochs,
      lossHistory: this.lossHistory,
      trained: this.trained,
      dropoutRate: this.dropoutRate
    };
  }
  
  static load(data) {
    const nn = new NeuralNetwork(data.inputSize, data.hiddenSizes, data.outputSize, data.learningRate);
    nn.weights = data.weights;
    nn.biases = data.biases;
    nn.bnGamma = data.bnGamma || [];
    nn.bnBeta = data.bnBeta || [];
    nn.bnMean = data.bnMean || [];
    nn.bnVar = data.bnVar || [];
    nn.epochs = data.epochs;
    nn.lossHistory = data.lossHistory;
    nn.trained = data.trained;
    nn.dropoutRate = data.dropoutRate || 0.1;
    return nn;
  }
}

class MarketPredictor {
  constructor() {
    this.pricePredictor = new NeuralNetwork(32, [128, 64, 32], 1, 0.008);
    this.trendPredictor = new NeuralNetwork(32, [64, 32], 3, 0.008);
    this.anomalyDetector = new NeuralNetwork(24, [64, 32], 1, 0.008);
    this.trainingData = [];
    this.maxTrainingSamples = 2000;
    this.lastTrainingTime = 0;
    this.trainingInterval = 5 * 60 * 1000;
    this.featureNames = this.getFeatureNames();
  }
  
  getFeatureNames() {
    return [
      'price', 'avg5', 'avg10', 'avg20', 'avg50',
      'min20', 'max20', 'volatility', 'momentum1', 'momentum5',
      'listings', 'avgListingPrice', 'spread',
      'avg5_avg10_diff', 'avg10_avg20_diff', 'price_avg5_diff',
      'historyDepth', 'salesVelocity', 'volumeNorm', 'volatilityNorm',
      'pricePosition', 'rsi14', 'macdSignal', 'bbPosition',
      'timeOfDay', 'dayOfWeek', 'listingsChange', 'salesChange',
      'priceAcceleration', 'volumeAcceleration', 'liquidityScore', 'riskScore'
    ];
  }
  
  extractFeatures(itemName, priceHistory, currentAuctions, allAuctions = []) {
    const prices = priceHistory.slice(-50).map(h => h.price || h.floor || 0).filter(p => p > 0);
    while (prices.length < 50) prices.unshift(prices[0] || 0);
    
    const currentPrice = prices[prices.length - 1] || 0;
    const avg5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avg10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const avg20 = prices.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const avg50 = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min20 = Math.min(...prices.slice(-20));
    const max20 = Math.max(...prices.slice(-20));
    const volatility = this.calcVolatility(prices.slice(-20));
    const momentum1 = prices.length >= 2 ? (prices[prices.length - 1] - prices[prices.length - 2]) / (prices[prices.length - 2] || 1) : 0;
    const momentum5 = prices.length >= 6 ? (prices[prices.length - 1] - prices[prices.length - 6]) / (prices[prices.length - 6] || 1) : 0;
    
    const listings = currentAuctions.filter(a => a.itemName === itemName).length;
    const itemAuctions = currentAuctions.filter(a => a.itemName === itemName);
    const avgListingPrice = listings > 0 ? itemAuctions.reduce((s, a) => s + (a.pricePerUnit || a.price / a.count), 0) / listings : 0;
    const spread = avgListingPrice > 0 ? (avgListingPrice - currentPrice) / (currentPrice || 1) : 0;
    
    const historyDepth = Math.min(prices.length / 50, 1);
    
    const recentSales = (() => {
      const sales = priceHistory.slice(-10);
      return sales.length > 0 ? sales.reduce((s, h) => s + (h.price || 0), 0) / sales.length : 0;
    })();
    const salesVelocity = currentPrice > 0 ? recentSales / currentPrice : 0;
    
    const volumes = priceHistory.slice(-10).map(h => h.volume || h.listings || 0).filter(v => v > 0);
    const volumeNorm = volumes.length ? Math.min(volumes.reduce((a,b)=>a+b,0) / 100, 1) : 0;
    const volatilityNorm = Math.min(volatility / 50, 1);
    
    const pricePosition = max20 > min20 ? (currentPrice - min20) / (max20 - min20) : 0.5;
    
    const rsi14 = this.calcRSI(prices.slice(-14));
    const macdSignal = this.calcMACD(prices);
    const bbPosition = this.calcBBPosition(prices.slice(-20), currentPrice);
    
    const now = new Date();
    const timeOfDay = now.getHours() / 24;
    const dayOfWeek = now.getDay() / 7;
    
    const listingsChange = priceHistory.length >= 2 ? (listings - (priceHistory[priceHistory.length - 2].listings || 0)) / 10 : 0;
    const salesChange = priceHistory.length >= 2 ? ((priceHistory[priceHistory.length - 1].sales || 0) - (priceHistory[priceHistory.length - 2].sales || 0)) / 10 : 0;
    
    const priceAcceleration = prices.length >= 3 ? (prices[prices.length - 1] - 2*prices[prices.length - 2] + prices[prices.length - 3]) / (prices[prices.length - 3] || 1) : 0;
    const volumeAcceleration = volumes.length >= 3 ? (volumes[volumes.length - 1] - 2*volumes[volumes.length - 2] + volumes[volumes.length - 3]) / (volumes[volumes.length - 3] || 1) : 0;
    
    const liquidityScore = Math.min((listings * 0.1) + (salesVelocity * 0.5), 1);
    const riskScore = Math.min(volatilityNorm * 0.5 + (1 - liquidityScore) * 0.5, 1);
    
    const max20 = Math.max(...prices.slice(-20));
    const min20 = Math.min(...prices.slice(-20));
    
    return [
      currentPrice / 1e6, avg5 / 1e6, avg10 / 1e6, avg20 / 1e6, avg50 / 1e6,
      min20 / 1e6, max20 / 1e6, volatility, momentum1, momentum5,
      Math.min(listings / 50, 1), avgListingPrice / 1e6, spread,
      (avg5 - avg10) / 1e6, (avg10 - avg20) / 1e6, (currentPrice - avg5) / 1e6,
      historyDepth, salesVelocity, volumeNorm, volatilityNorm,
      pricePosition, rsi14, macdSignal, bbPosition,
      timeOfDay, dayOfWeek, listingsChange, salesChange,
      priceAcceleration, volumeAcceleration, liquidityScore, riskScore
    ];
  }
  
  calcVolatility(prices) {
    if (prices.length < 2) return 0;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
    return Math.sqrt(variance) / (mean || 1);
  }
  
  calcRSI(prices) {
    if (prices.length < 2) return 0.5;
    let gains = 0, losses = 0;
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / (prices.length - 1);
    const avgLoss = losses / (prices.length - 1);
    if (avgLoss === 0) return 1;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs)) / 100;
  }
  
  calcMACD(prices) {
    if (prices.length < 26) return 0;
    const ema12 = this.ema(prices, 12);
    const ema26 = this.ema(prices, 26);
    return (ema12 - ema26) / (ema26 || 1);
  }
  
  ema(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }
  
  calcBBPosition(prices, currentPrice) {
    if (prices.length < 20) return 0.5;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const std = Math.sqrt(prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    return upper > lower ? (currentPrice - lower) / (upper - lower) : 0.5;
  }
  
  prepareTrainingData(priceHistories, auctions) {
    const trainingPairs = [];
    
    for (const [itemName, history] of Object.entries(priceHistories)) {
      if (history.length < 30) continue;
      
      for (let i = 15; i < history.length - 1; i++) {
        const past = history.slice(0, i);
        const future = history[i + 1];
        const currentAuctions = auctions.filter(a => a.itemName === itemName);
        
        const features = this.extractFeatures(itemName, past, currentAuctions);
        const targetPrice = (future.price || future.floor) / 1e6;
        const trend = (future.price || future.floor) > (past[past.length - 1].price || past[past.length - 1].floor) ? [1, 0, 0] : 
                      (future.price || future.floor) < (past[past.length - 1].price || past[past.length - 1].floor) ? [0, 0, 1] : [0, 1, 0];
        
        trainingPairs.push({ features, targetPrice, trend, itemName });
      }
    }
    
    return trainingPairs;
  }
  
  train(priceHistories, auctions) {
    const pairs = this.prepareTrainingData(priceHistories, auctions);
    if (pairs.length < 10) return { loss: 0, samples: pairs.length };
    
    const recent = pairs.slice(-this.maxTrainingSamples);
    const priceInputs = recent.map(p => p.features);
    const priceTargets = recent.map(p => [p.targetPrice]);
    const trendTargets = recent.map(p => p.trend);
    
    const priceLoss = this.pricePredictor.train(priceInputs, priceTargets, 80, 64);
    const trendLoss = this.trendPredictor.train(priceInputs, trendTargets, 60, 64);
    
    this.trainingData.push(...recent.slice(-200));
    this.lastTrainingTime = Date.now();
    
    return { 
      priceLoss: priceLoss.toFixed(6), 
      trendLoss: trendLoss.toFixed(6), 
      samples: recent.length,
      epochs: this.pricePredictor.epochs
    };
  }
  
  shouldTrain() {
    return Date.now() - this.lastTrainingTime > this.trainingInterval;
  }
  
  predict(itemName, priceHistory, currentAuctions, allAuctions = []) {
    if (!this.pricePredictor.trained) return null;
    
    const features = this.extractFeatures(itemName, priceHistory, currentAuctions, allAuctions);
    const predictedPrice = this.pricePredictor.predict(features)[0] * 1e6;
    const trend = this.trendPredictor.predict(features);
    const trendLabels = ['UP', 'FLAT', 'DOWN'];
    const predictedTrend = trendLabels[trend.indexOf(Math.max(...trend))];
    const confidence = Math.max(...trend);
    
    const currentPrice = priceHistory[priceHistory.length - 1]?.price || priceHistory[priceHistory.length - 1]?.floor || 0;
    const expectedChange = predictedPrice - currentPrice;
    const expectedChangePct = currentPrice > 0 ? (expectedChange / currentPrice) * 100 : 0;
    
    return {
      currentPrice,
      predictedPrice: Math.round(predictedPrice),
      expectedChange: Math.round(expectedChange),
      expectedChangePct: Math.round(expectedChangePct * 100) / 100,
      trend: predictedTrend,
      confidence: Math.round(confidence * 100),
      timeHorizon: '24h'
    };
  }
  
  detectAnomalies(priceHistories, auctions) {
    if (!this.anomalyDetector.trained) return [];
    
    const anomalies = [];
    for (const [itemName, history] of Object.entries(priceHistories)) {
      if (history.length < 15) continue;
      const currentAuctions = auctions.filter(a => a.itemName === itemName);
      if (currentAuctions.length === 0) continue;
      
      const features = this.extractFeatures(itemName, history, currentAuctions);
      const anomalyScore = this.anomalyDetector.predict(features)[0];
      
      if (anomalyScore > 0.75) {
        const currentPrice = history[history.length - 1].price || history[history.length - 1].floor;
        const avgPrice = history.slice(-10).reduce((s, h) => s + (h.price || h.floor), 0) / 10;
        const deviation = ((currentPrice - avgPrice) / (avgPrice || 1)) * 100;
        
        anomalies.push({
          item: itemName,
          anomalyScore: Math.round(anomalyScore * 100),
          currentPrice,
          avgPrice: Math.round(avgPrice),
          deviation: Math.round(deviation * 100) / 100,
          type: deviation > 0 ? 'price_spike' : 'price_drop',
          listings: currentAuctions.length
        });
      }
    }
    
    return anomalies.sort((a, b) => b.anomalyScore - a.anomalyScore);
  }
  
  getModelStats() {
    return {
      pricePredictor: {
        trained: this.pricePredictor.trained,
        epochs: this.pricePredictor.epochs,
        lastLoss: this.pricePredictor.lossHistory[this.pricePredictor.lossHistory.length - 1] || 0
      },
      trendPredictor: {
        trained: this.trendPredictor.trained,
        epochs: this.trendPredictor.epochs,
        lastLoss: this.trendPredictor.lossHistory[this.trendPredictor.lossHistory.length - 1] || 0
      },
      anomalyDetector: {
        trained: this.anomalyDetector.trained,
        epochs: this.anomalyDetector.epochs
      },
      trainingSamples: this.trainingData.length,
      lastTraining: this.lastTrainingTime
    };
  }
  
  save() {
    return {
      pricePredictor: this.pricePredictor.save(),
      trendPredictor: this.trendPredictor.save(),
      anomalyDetector: this.anomalyDetector.save(),
      trainingData: this.trainingData.slice(-500),
      lastTrainingTime: this.lastTrainingTime
    };
  }
  
  load(data) {
    if (!data) return;
    this.pricePredictor = NeuralNetwork.load(data.pricePredictor);
    this.trendPredictor = NeuralNetwork.load(data.trendPredictor);
    this.anomalyDetector = NeuralNetwork.load(data.anomalyDetector);
    this.trainingData = data.trainingData || [];
    this.lastTrainingTime = data.lastTrainingTime || 0;
  }
}

module.exports = { NeuralNetwork, MarketPredictor };