const MAX_GAP_DAYS = 730;
const DAY_MS = 86_400_000;

/**
 * Shift a `YYYY-MM-DD` key by whole days.
 * @param {string} day
 * @param {number} delta
 * @returns {string}
 */
export function addDays(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Reject smoothing parameters outside the open interval (0, 1).
 * @param {string} name
 * @param {number} value
 */
export function assertUnit(name, value) {
  if (!(value > 0 && value < 1)) throw new RangeError(`${name} must be between 0 and 1`);
}

/**
 * Close one day of demand. This is the only SES recurrence, so batch and live cannot disagree.
 * @param {{alpha: number, level: number, mse: number, n: number}} state
 * @param {number} y demand for the closed day
 * @returns {object} a new state
 */
export function sesStep(state, y) {
  const { alpha, level, mse, n } = state;
  if (n === 0) return { ...state, level: y, mse: 0, n: 1 };
  const e = y - level;
  return {
    ...state,
    level: alpha * y + (1 - alpha) * level,
    mse: n === 1 ? e * e : 0.9 * mse + 0.1 * e * e,
    n: n + 1,
  };
}

// Today cannot sell less than what has already sold, so a surge moves the forecast
// immediately while a slow morning leaves it alone.
function provisionalNext({ alpha, level, n, openQty }) {
  if (n === 0) return openQty;
  return openQty > level ? alpha * openQty + (1 - alpha) * level : level;
}

/**
 * Apply a sale to the live state in O(1), rolling over any days that have ended.
 * @param {object} state `{ alpha, level, mse, n, lastClosedDay, openDay, openQty, next }`
 * @param {string} day the sale's day key
 * @param {number} qty units sold (0 only rolls the day over)
 * @returns {object} a new state
 */
export function sesAdvance(state, day, qty) {
  let s = state;
  if (!s.openDay) {
    s = { ...s, openDay: day, openQty: 0 };
  } else if (day > s.openDay) {
    s = sesStep(s, s.openQty);
    const oldest = addDays(day, -MAX_GAP_DAYS);
    const first = addDays(s.openDay, 1);
    for (let d = first > oldest ? first : oldest; d < day; d = addDays(d, 1)) s = sesStep(s, 0);
    s = { ...s, lastClosedDay: addDays(day, -1), openDay: day, openQty: 0 };
  }
  const openQty = s.openQty + qty;
  return { ...s, openQty, next: provisionalNext({ ...s, openQty }) };
}

/**
 * Build the live state from closed daily history.
 * @param {{alpha: number, y: number[], lastClosedDay?: string|null, openDay?: string|null, openQty?: number}} input
 * @returns {object} live state
 */
export function sesState({ alpha, y, lastClosedDay = null, openDay = null, openQty = 0 }) {
  const closed = y.reduce(sesStep, { alpha, level: 0, mse: 0, n: 0 });
  const state = { ...closed, lastClosedDay, openDay, openQty };
  return { ...state, next: provisionalNext(state) };
}

/**
 * Simple exponential smoothing.
 * @param {number[]} y daily quantities, oldest first
 * @param {{alpha?: number, horizon?: number}} [options]
 * @returns {{fitted: (number|null)[], forecast: number[], sigma: number, params: {alpha: number}}}
 */
export function ses(y, { alpha = 0.3, horizon = 7 } = {}) {
  assertUnit('alpha', alpha);
  const fitted = [];
  let state = { alpha, level: 0, mse: 0, n: 0 };
  for (const value of y) {
    fitted.push(state.n === 0 ? null : state.level);
    state = sesStep(state, value);
  }
  return {
    fitted,
    forecast: Array(horizon).fill(state.level),
    sigma: Math.sqrt(state.mse),
    params: { alpha },
  };
}
