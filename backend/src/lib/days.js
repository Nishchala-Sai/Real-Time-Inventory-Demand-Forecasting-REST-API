import { addDays } from '@inventory/forecast';

export { addDays };

const formatters = new Map();

function formatterFor(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone }));
  }
  return formatters.get(timeZone);
}

export function dayKey(date, timeZone) {
  return formatterFor(timeZone).format(date);
}

export function range(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}
