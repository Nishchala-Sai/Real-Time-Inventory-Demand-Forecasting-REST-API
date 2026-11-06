/**
 * Accuracy of predictions against actuals, skipping pairs with a null prediction.
 * MAPE is deliberately absent: it is undefined on zero-sales days.
 * @param {number[]} actual
 * @param {(number|null)[]} predicted
 * @returns {{mae: number|null, rmse: number|null, wape: number|null, bias: number|null, n: number}}
 *   `wape` is null when actuals sum to 0. Negative `bias` means under-forecasting.
 */
export function metrics(actual, predicted) {
  let absSum = 0;
  let sqSum = 0;
  let errSum = 0;
  let actualSum = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    if (predicted[i] === null) continue;
    const e = predicted[i] - actual[i];
    absSum += Math.abs(e);
    sqSum += e * e;
    errSum += e;
    actualSum += Math.abs(actual[i]);
    n++;
  }
  if (n === 0) return { mae: null, rmse: null, wape: null, bias: null, n: 0 };
  return {
    mae: absSum / n,
    rmse: Math.sqrt(sqSum / n),
    wape: actualSum === 0 ? null : absSum / actualSum,
    bias: errSum / n,
    n,
  };
}

/**
 * Square root of the exponentially weighted mean of squared one-step errors (λ = 0.1).
 * @param {number[]} y
 * @param {(number|null)[]} fitted
 * @returns {number}
 */
export function ewmSigma(y, fitted) {
  let mse = null;
  for (let i = 0; i < y.length; i++) {
    if (fitted[i] === null) continue;
    const sq = (y[i] - fitted[i]) ** 2;
    mse = mse === null ? sq : 0.9 * mse + 0.1 * sq;
  }
  return mse === null ? 0 : Math.sqrt(mse);
}
