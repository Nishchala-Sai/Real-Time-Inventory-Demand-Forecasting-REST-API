import { fitModel } from './select.js';
import { coldStart } from './coldstart.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LABELS = { sma: 'SMA', ses: 'SES', holt: 'Holt', croston: 'Croston', coldstart: 'new product' };

function shortDay(day) {
  const [, month, date] = day.split('-');
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}

function describeParams(method, params) {
  if (method === 'coldstart') return LABELS.coldstart;
  if (method === 'sma') return `SMA, k=${params.window}`;
  const greek = `α=${params.alpha.toFixed(2)}`;
  if (method === 'holt') return `Holt, ${greek}, β=${params.beta.toFixed(2)}`;
  return `${LABELS[method]}, ${greek}`;
}

function weightsFor(method, params, days) {
  if (method === 'ses') {
    const recent = days.slice(-7).reverse();
    return recent.map((day, i) => ({ day, weight: params.alpha * (1 - params.alpha) ** i }));
  }
  if (method === 'sma') {
    const recent = days.slice(-params.window).reverse();
    return recent.map((day) => ({ day, weight: 1 / recent.length }));
  }
  return [];
}

function previousValue(method, params, y, prior) {
  const before = y.slice(0, -1);
  if (method === 'coldstart') return coldStart(before, { prior, horizon: 1 }).forecast[0];
  return fitModel(method, before, params, 1).forecast[0];
}

function changeSentence({ previous, current, driverDay, driverQty }) {
  const fmt = (v) => v.toFixed(1);
  if (fmt(current) === fmt(previous)) return `Unchanged from ${fmt(previous)}.`;
  const direction = current > previous ? 'Up' : 'Down';
  const relation = driverQty > previous ? 'above' : driverQty < previous ? 'below' : 'matching';
  return `${direction} from ${fmt(previous)} because ${shortDay(driverDay)} sold ${driverQty}, ${relation} the ${fmt(previous)} expected.`;
}

function buildNotes(method, runnerUp, n) {
  const notes = [];
  if (runnerUp) {
    notes.push(`${LABELS[runnerUp.method]} beat ${LABELS[method]} on the holdout, but by under 1%, so the simpler model was kept.`);
  }
  if (n < 14) notes.push(`Only ${n} days of history, so this leans on the category average.`);
  return notes;
}

/**
 * Plain-language account of a forecast, built from templates.
 * @param {{method: string, params?: object, y: number[], days: string[], current: number,
 *   prior?: number|null, runnerUp?: object|null}} input `days[i]` is the day of `y[i]`
 * @returns {{summary: string, weights: object[], change: object|null, notes: string[]}}
 */
export function explain({ method, params = {}, y, days, current, prior = null, runnerUp = null }) {
  const headline = `Expect about ${current.toFixed(1)} units/day (${describeParams(method, params)}).`;
  const notes = buildNotes(method, runnerUp, y.length);
  if (y.length < 2) return { summary: headline, weights: [], change: null, notes };
  const change = {
    previous: previousValue(method, params, y, prior),
    current,
    driverDay: days.at(-1),
    driverQty: y.at(-1),
  };
  return {
    summary: `${headline} ${changeSentence(change)}`,
    weights: weightsFor(method, params, days),
    change,
    notes,
  };
}
