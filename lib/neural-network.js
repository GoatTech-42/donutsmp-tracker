class NeuralNetwork {
  constructor(inputSize, hiddenSizes, outputSize, learningRate = 0.01) {
    this.inputSize = inputSize;
    this.hiddenSizes = hiddenSizes;
    this.outputSize = outputSize;
    this.learningRate = learningRate;
    this.layers = [];
    this.weights = [];
    this.biases = [];
    this.history = [];
    this.trained = false;
    this.epochs = 0;
    this.lossHistory = [];
    
    this.initLayers();
  }
  
  initLayers() {
    const sizes = [this.inputSize, ...this.hiddenSizes, this.outputSize];
    for (let i = 0; i < sizes.length - 1; i++) {
      const rows = sizes[i + 1];
      const cols = sizes[i];
      this.weights[i] = this.randomMatrix(rows, cols);
      this.biases[i] = new Array(rows).fill(0).map(() => Math.random() * 0.2 - 0.1);
    }
  }
  
  randomMatrix(rows, cols) {
    const std = Math.sqrt(2 / cols);
    return Array.from({ length: rows }, () => 
      Array.from({ length: cols }, () => (Math.random() - 0.5) * 2 * std)
    );
  }
  
  relu(x) { return Math.max(0, x); }
  reluDerivative(x) { return x > 0 ? 1 : 0; }
  sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  sigmoidDerivative(x) { const s = this.sigmoid(x); return s * (1 - s); }
  
  forward(input) {
    this.layers[0] = input;
    for (let i = 0; i < this.weights.length; i++) {
      const next = new Array(this.weights[i].length).fill(0);
      for (let j = 0; j < this.weights[i].length; j++) {
        let sum = this.biases[i][j];
        for (let k = 0; k < this.layers[i].length; k++) {
          sum += this.weights[i][j][k] * this.layers[i][k];
        }
        next[j] = i === this.weights.length - 1 ? sum : this.relu(sum);
      }
      this.layers[i + 1] = next;
    }
    return this.layers[this.layers.length - 1];
  }
  
  backward(target) {
    const output = this.layers[this.layers.length - 1];
    const errors = output.map((o, i) => target[i] - o);
    
    for (let i = this.weights.length - 1; i >= 0; i--) {
      const layerOutput = this.layers[i + 1];
      const layerInput = this.layers[i];
      
      for (let j = 0; j < this.weights[i].length; j++) {
        const derivative = i === this.weights.length - 1 ? 1 : this.reluDerivative(layerOutput[j]);
        const delta = errors[j] * derivative;
        
        for (let k = 0; k < layerInput.length; k++) {
          this.weights[i][j][k] += this.learningRate * delta * layerInput[k];
        }
        this.biases[i][j] += this.learningRate * delta;
        
        if (i > 0) {
          for (let k = 0; k < this.weights[i - 1][0].length; k++) {
            errors[k] = (errors[k] || 0) + delta * this.weights[i][j][k];
          }
        }
      }
    }
    
    return errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
  }
  
  train(inputs, targets, epochs = 100) {
    let totalLoss = 0;
    for (let epoch = 0; epoch < epochs; epoch++) {
      let epochLoss = 0;
      for (let i = 0; i < inputs.length; i++) {
        this.forward(inputs[i]);
        epochLoss += this.backward(targets[i]);
      }
      totalLoss = epochLoss / inputs.length;
      this.lossHistory.push(totalLoss);
      this.epochs++;
      
      if (epoch % 20 === 0) {
        this.learningRate *= 0.99;
      }
    }
    this.trained = true;
    return totalLoss;
  }
  
  predict(input) {
    return this.forward(input);
  }
  
  save() {
    return {
      inputSize: this.inputSize,
      hiddenSizes: this.hiddenSizes,
      outputSize: this.outputSize,
      learningRate: this.learningRate,
      weights: this.weights,
      biases: this.biases,
      epochs: this.epochs,
      lossHistory: this.lossHistory,
      trained: this.trained
    };
  }
  
  static load(data) {
    const nn = new NeuralNetwork(data.inputSize, data.hiddenSizes, data.outputSize, data.learningRate);
    nn.weights = data.weights;
    nn.biases = data.biases;
    nn.epochs = data.epochs;
    nn.lossHistory = data.lossHistory;
    nn.trained = data.trained;
    return nn;
  }
}

class MarketPredictor {
  constructor() {
    this.pricePredictor = new NeuralNetwork(20, [64, 32, 16], 1, 0.01);
    this.trendPredictor = new NeuralNetwork(20, [32, 16], 3, 0.01);
    this.anomalyDetector = new NeuralNetwork(15, [32, 16], 1, 0.01);
    this.trainingData = [];
    this.maxTrainingSamples = 1000;
    this.lastTrainingTime = 0;
    this.trainingInterval = 5 * 60 * 1000;
  }
  
  extractFeatures(itemName, priceHistory, currentAuctions) {
    const prices = priceHistory.slice(-20).map(h => h.price);
    while (prices.length < 20) prices.unshift(prices[0] || 0);
    
    const currentPrice = prices[prices.length - 1] || 0;
    const avg5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avg10 = prices.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const avg20 = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min20 = Math.min(...prices);
    const max20 = Math.max(...prices);
    const volatility = this.calcVolatility(prices);
    const momentum = prices.length >= 2 ? (prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2] : 0;
    const listings = currentAuctions.filter(a => a.itemName === itemName).length;
    const avgListingPrice = listings > 0 ? currentAuctions.filter(a => a.itemName === itemName).reduce((s, a) => s + a.pricePerUnit, 0) / listings : 0;
    const spread = avgListingPrice > 0 ? (avgListingPrice - currentPrice) / currentPrice : 0;
    
    return [
      currentPrice / 1e6,
      avg5 / 1e6,
      avg10 / 1e6,
      avg20 / 1e6,
      min20 / 1e6,
      max20 / 1e6,
      volatility,
      momentum,
      Math.min(listings / 50, 1),
      avgListingPrice / 1e6,
      spread,
      (avg5 - avg10) / 1e6,
      (avg10 - avg20) / 1e6,
      (currentPrice - avg5) / 1e6,
      prices.length / 20,
      0, 0, 0, 0, 0, 0
    ];
  }
  
  calcVolatility(prices) {
    if (prices.length < 2) return 0;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    return Math.sqrt(variance) / (mean || 1);
  }
  
  prepareTrainingData(priceHistories, auctions) {
    const trainingPairs = [];
    
    for (const [itemName, history] of Object.entries(priceHistories)) {
      if (history.length < 25) continue;
      
      for (let i = 10; i < history.length - 1; i++) {
        const past = history.slice(0, i);
        const future = history[i + 1];
        const currentAuctions = auctions.filter(a => a.itemName === itemName);
        
        const features = this.extractFeatures(itemName, past, currentAuctions);
        const targetPrice = future.price / 1e6;
        const trend = future.price > past[past.length - 1].price ? [1, 0, 0] : 
                      future.price < past[past.length - 1].price ? [0, 0, 1] : [0, 1, 0];
        
        trainingPairs.push({ features, targetPrice, trend });
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
    
    const priceLoss = this.pricePredictor.train(priceInputs, priceTargets, 50);
    const trendLoss = this.trendPredictor.train(priceInputs, trendTargets, 30);
    
    this.trainingData.push(...recent.slice(-100));
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
  
  predict(itemName, priceHistory, currentAuctions) {
    if (!this.pricePredictor.trained) return null;
    
    const features = this.extractFeatures(itemName, priceHistory, currentAuctions);
    const predictedPrice = this.pricePredictor.predict(features)[0] * 1e6;
    const trend = this.trendPredictor.predict(features);
    const trendLabels = ['UP', 'FLAT', 'DOWN'];
    const predictedTrend = trendLabels[trend.indexOf(Math.max(...trend))];
    const confidence = Math.max(...trend);
    
    const currentPrice = priceHistory[priceHistory.length - 1]?.price || 0;
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
      if (history.length < 10) continue;
      const currentAuctions = auctions.filter(a => a.itemName === itemName);
      if (currentAuctions.length === 0) continue;
      
      const features = this.extractFeatures(itemName, history, currentAuctions);
      const anomalyScore = this.anomalyDetector.predict(features)[0];
      
      if (anomalyScore > 0.7) {
        const currentPrice = history[history.length - 1].price;
        const avgPrice = history.slice(-10).reduce((s, h) => s + h.price, 0) / 10;
        const deviation = ((currentPrice - avgPrice) / avgPrice) * 100;
        
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
}

module.exports = { NeuralNetwork, MarketPredictor };