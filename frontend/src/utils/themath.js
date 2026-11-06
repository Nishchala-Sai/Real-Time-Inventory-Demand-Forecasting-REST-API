export function calculateSMA(data, period = 3) {
  if (!data || data.length < period) return [];
  
  const forecasts = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      forecasts.push(null); 
    } else {
      const window = data.slice(i - period, i);
      const sum = window.reduce((acc, val) => acc + val, 0);
      forecasts.push(Number((sum / period).toFixed(2)));
    }
  }
  return forecasts;
}

export function calculateExponentialSmoothing(data, alpha = 0.3) {
  if (!data || data.length === 0) return [];
  
  const forecasts = [data[0]];
  for (let i = 1; i < data.length; i++) {
    forecasts.push(alpha * data[i - 1] + (1 - alpha) * forecasts[i - 1]);
  }
  return forecasts;
}