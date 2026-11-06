# How the forecasting works

This document explains the mathematics behind the system and why each choice was made. All the code it describes is in `packages/forecast`, a set of pure functions that both the server and the browser import, so the two can never disagree.

Throughout, `y` is a series of daily quantities sold, oldest first, with zeros filled in for days without sales. Only `sale` movements count as demand. A return restores stock but does not reduce recorded demand, because the customer's original demand did happen, and subtracting it would hide the signal the reorder point needs.

## 1. The models

Each model produces `fitted[i]`, the one-step-ahead forecast for day `i` using only data from before day `i`. That rule is what makes accuracy scores honest. A model is never graded on data it has already seen.

### Simple moving average, SMA(k)

`fitted[i] = mean(y[i-k .. i-1])`, and the forecast for every future day is the mean of the last `k` days.

**Intuition:** recent days are equally informative, and older days do not matter at all. It is easy to explain and hard to break, but it lags behind any change.

### Simple exponential smoothing, SES(α)

`L₀ = y₀`, then for each later day `fitted[i] = L` and `L = α·yᵢ + (1−α)·L`. The forecast is `L`, flat.

**Intuition:** every past day counts, with weight shrinking by `(1−α)` per day. A high α reacts fast and is noisy. A low α is smooth and slow. The weight on the day `i` days back is `α(1−α)ⁱ`, which is what the explanation panel displays.

### Holt's linear trend, Holt(α, β)

This adds a smoothed trend `T` to the level:

- `L₀ = y₀`, and `T₀` is the mean first difference over the first `min(4, n−1)` points
- `fitted[i] = L + T`
- `L' = α·yᵢ + (1−α)(L + T)`
- `T' = β(L' − L) + (1−β)T`
- The forecast for `h` days ahead is `L + h·T`, clamped at 0

**Intuition:** it estimates both where demand is and which way it is heading.

### Croston(α)

Croston smooths two things separately: the size of non-zero demands (`z`) and the interval between them (`p`). The forecast is the rate `z / p`.

**Intuition:** an item that sells 6 units every third day has a rate of 2 per day. SES would swing between high and low, while Croston stays at 2. It is only a candidate when at least 30% of days have no sales.

## 2. Why SES and SMA under-forecast trends

The original dashboard's sample data rises steadily: `y = [12, 18, 15, 22, 20, 28, 24, 31, 29, 35]`. These values are locked in as golden tests:

| Model | In-sample MAE | Next-day forecast |
|---|---|---|
| SMA k=3 | 4.809524 | 31.666667 |
| SES α=0.3 | 6.142400 | 28.584480 |
| SES α=0.8 | 4.275196 | 33.827883 |

The last sale was 35 and the series is climbing, yet all three forecasts fall below 35. This is structural. SMA and SES are weighted averages of past values, so on a rising series their forecast can never exceed the highest recent value, and it trails behind it. Raising α narrows the gap but cannot close it. Holt fixes this by projecting the trend, and on a perfectly linear series `y = 10 + 2t` it forecasts `10 + 2(n−1+h)` exactly, which the test suite also checks.

Under-forecasting matters more than over-forecasting here, because it leads directly to stockouts.

An early version of the code also rounded each SES step with `toFixed(2)` and fed the rounded value back in, compounding the error. All calculations now keep full precision, and values are rounded in one place only, when the API serializes a response.

## 3. Choosing a model and measuring accuracy

**Holdout.** The last `holdout` days (14 by default) are set aside. Parameters are tuned on the training part only, and then one-step-ahead predictions are scored on the holdout. Selecting on in-sample error would reward overfitting.

**Metrics.**

- **MAE**, the mean absolute error, is in units and is what selection uses.
- **WAPE** is `Σ|e| / Σ|y|`, which compares across products of different volumes. It is null when nothing sold.
- **Bias** is `mean(predicted − actual)`. Negative means under-forecasting, which is a stockout risk.
- **MAPE is deliberately not used.** It divides by each day's actual sales, so it is undefined on any zero-sales day, and those days are common in inventory data.

**Selection.** The candidates are SMA with k in {3, 7, 14}, SES with α from 0.05 to 0.95, Holt with α and β from 0.1 to 0.9, and Croston with α in {0.1, 0.2} if eligible. That is about 105 fits, each over at most a few hundred numbers, so no caching is needed. The lowest holdout MAE wins, but a tie within 1% goes to the simpler model, in the order SMA, SES, Croston, Holt. A model that wins by a margin too small to trust should not add complexity. When this happens, the explanation says so.

## 4. The live forecast

Refitting on every sale would work, but it would mean reading the history on the write path. Instead, each product stores a small SES state: `{ alpha, level, mse, n, lastClosedDay, openDay, openQty, next }`. A sale updates it in O(1) with no read of daily demand, and a test asserts this.

**Closing a day.** `sesStep(state, y)` applies the SES recurrence. The batch `ses()` function is literally a fold over the same `sesStep`, so batch and live cannot drift apart. A property test folds random daily sequences with gaps through the live path and checks the result equals batch SES to within 1e-9.

**Rollover.** Days roll over lazily. On the next sale or forecast read, the open day is closed and any missing days are closed with 0. No cron job is needed.

**The provisional rule.** While a day is open, its total is only a lower bound on what it will end up being:

`next = openQty > level ? α·openQty + (1−α)·level : level`

Today cannot sell less than what has already sold, so a surge moves the forecast immediately, while a slow morning does not drag it down. Responses mark this `provisional: true` until the day closes.

**Self-healing.** `dailydemands` is the source of truth. `GET /forecast/:sku`, `POST /forecast/:sku/tune` and `npm run rebuild` recompute the state from it and overwrite any drift. The write is conditional on the state not having changed since it was read, so it can never overwrite a concurrent sale.

**Two reorder points.** The live state is always SES, because only SES has an O(1) update. The reorder point in the inventory table therefore comes from the live SES state and updates on every sale. The forecast panel shows the reorder point for whichever model was selected, which on a trending product is Holt. They differ on purpose: the table is the fast operational signal, and the panel is the considered recommendation.

## 5. Prediction intervals

`σ` is the square root of the exponentially weighted mean of squared one-step errors, with λ = 0.1, so recent errors count more. The same formula is used in batch and live.

The 80% interval uses `z = 1.2816`, with the lower bound clamped at 0:

| Model | Half-width at `h` days ahead | Basis |
|---|---|---|
| SES | `z·σ·√(1 + (h−1)·α²)` | Exact for this model |
| Holt | `z·σ·√(1 + Σⱼ₌₁^{h−1} α²(1 + jβ)²)` | Exact for this model |
| SMA, Croston, cold start | `z·σ·√h` | Approximate, flagged `intervalMethod: "approx"` |

Uncertainty grows with the horizon, so the band on the chart widens, and Holt's widens fastest because an error in the trend compounds.

## 6. Reorder point and order quantity

With lead time `L`, review period `R` and service level `s`:

- `demandLT` is the sum of the first `L` forecast values, extended flat if the horizon is shorter
- `safetyStock = z(s) · σ · √L`, with `z` of 1.2816, 1.6449, 1.96 or 2.3263 for service levels of 90%, 95%, 97.5% or 99%
- `reorderPoint = ceil(demandLT + safetyStock)`
- `orderUpTo` is the demand over `L + R` days plus safety stock
- `suggestedOrderQty = max(0, ceil(orderUpTo − currentStock))`
- `daysOfCover = currentStock / dailyForecast`, or null if the forecast is 0

The reorder point has two parts. `demandLT` covers what will probably sell while an order is on its way, and `safetyStock` covers forecast error during that wait. Errors over `L` days accumulate roughly with `√L`, not `L`, when they are independent. A manager can still set `reorderPointOverride`, which takes precedence.

## 7. Cold start

A new product has too little history to fit a model. Let `n` be the days since its first sale.

- **Blend.** Below 14 days, `forecast = w·own + (1−w)·prior`, with `w = n/14`. The forecast starts at the category average and hands over to the product's own data day by day.
- **Prior.** The median daily mean of products in the same category with at least 28 days of history. The median resists one best-seller skewing it. It falls back to the product's own mean, and then to 0.
- **Thin history.** Selection needs at least `holdout + 7` days. Below that, the method reported is `coldstart`, using SMA(min(3, n)) blended with the prior.
- **Confidence.** `low` under 14 days, `medium` under 56, otherwise `high`, dropping one level if the holdout WAPE exceeds 0.5.

## 8. Explanations

`explain()` builds its text from templates and numbers. No language model is involved, so an explanation is always accurate to the calculation and always reproducible.

- **Summary:** "Expect about 33.8 units/day (SES, α=0.80). Up from 29.1 because 24 Oct sold 35, above the 29.1 expected."
- **Change:** `previous` is the forecast recomputed without the last day, which takes one extra fold.
- **Honest attribution:** if the forecast moved against the latest sale, such as Holt rising on a below-expected day because of its trend, the text says "even though" and credits the longer-run pattern, not that sale.
- **Weights:** the first seven values of `α(1−α)ⁱ` for SES, and `1/k` each for SMA.
- **Notes:** a narrowly beaten model, or thin history.

## 9. How this addresses the gaps in commercial systems

The project's Review 1 research looked at enterprise systems such as GAINS, Dynamics 365 and watsonx.ai, and identified three gaps for small and mid-sized operations. This section describes those gaps as the project framed them. It is not an independent evaluation of those products.

| Gap | What this system does |
|---|---|
| **Batch forecasting.** Forecasts refresh on a schedule, so they lag behind what is happening now. | Each sale updates the forecast and reorder point in O(1), and the change reaches the dashboard over server-sent events. In local measurements, sale-to-event latency was about 31 ms at p95. |
| **Black-box output.** Users see a number with no reason behind it. | Every forecast includes a plain explanation, the weights on recent days, holdout accuracy, a confidence level and a leaderboard of the models it was compared with. |
| **Cold start.** New products have no forecast until they build up history. | New products get a category prior that blends into their own data over 14 days, with confidence reported as low. |

The system also covers intermittent demand with Croston, turns forecasts into reorder points and order quantities, and scores accuracy per product. It makes no claim to match the breadth of those platforms. Seasonality, multi-location stock and external signals such as weather are out of scope.
