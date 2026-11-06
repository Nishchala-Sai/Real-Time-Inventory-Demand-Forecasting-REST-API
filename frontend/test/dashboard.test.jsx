import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request, setUnauthorizedHandler } from '../src/api';
import App from '../src/App';
import { forecastResponse, jsonResponse, products } from './fixtures';

vi.mock('react-chartjs-2', () => ({ Line: () => null }));

class FakeEventSource {
  static CLOSED = 2;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listeners = {};
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  close() {
    this.closed = true;
  }

  emit(type, event) {
    act(() => this.listeners[type]({ data: JSON.stringify({ type, ...event }) }));
  }
}

function routeFetch(role, overrides = {}) {
  return vi.fn(async (url, options = {}) => {
    const path = url.replace('/api/v1', '');
    if (overrides[path]) return overrides[path](options);
    if (path === '/auth/me') return jsonResponse({ user: { email: `${role}@example.com`, role } });
    if (path.startsWith('/products')) return jsonResponse({ items: products, next: null });
    if (path.startsWith('/forecast/')) return jsonResponse(forecastResponse);
    if (path === '/stock-movements') return jsonResponse({ movement: {}, product: {}, forecast: {} }, 201);
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
  });
}

describe('App', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the login form when there is no session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401)));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('shows managers the simulate button and sends a sale', async () => {
    const fetchSpy = routeFetch('manager');
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);
    await screen.findByText('14 units');
    fireEvent.click(screen.getByRole('button', { name: 'Simulate sale' }));
    await screen.findByText(/^Sold \d × /);
    const [, options] = fetchSpy.mock.calls.find(([url]) => url.endsWith('/stock-movements'));
    expect(JSON.parse(options.body)).toMatchObject({ type: 'sale', qty: expect.any(Number) });
  });

  it('hides simulate and tune controls from suppliers', async () => {
    vi.stubGlobal('fetch', routeFetch('supplier'));
    render(<App />);
    await screen.findByText('supplier@example.com (supplier)');
    await screen.findByRole('slider');
    expect(screen.queryByRole('button', { name: 'Simulate sale' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply α' })).not.toBeInTheDocument();
  });

  it('updates stock in place from live events without refetching', async () => {
    const fetchSpy = routeFetch('manager');
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);
    await screen.findByText('14 units');
    const before = fetchSpy.mock.calls.filter(([url]) => url.includes('/products')).length;
    FakeEventSource.instances[0].emit('stock.updated', {
      sku: 'P101',
      data: { sku: 'P101', currentStock: 9, reorderPoint: 20, status: 'low', daysOfCover: 0.3 },
    });
    expect(screen.getByText('9 units')).toBeInTheDocument();
    expect(screen.getByText('9 units').closest('tr')).toHaveClass('row-flash');
    expect(fetchSpy.mock.calls.filter(([url]) => url.includes('/products')).length).toBe(before);
  });

  it('shows a toast when an alert opens', async () => {
    vi.stubGlobal('fetch', routeFetch('manager'));
    render(<App />);
    await screen.findByText('14 units');
    FakeEventSource.instances[0].emit('alert.opened', {
      id: 'e1',
      sku: 'P101',
      data: { name: 'Mechanical Keyboard', currentStock: 9, reorderPoint: 20 },
    });
    expect(screen.getByText(/Low stock: Mechanical Keyboard has 9 left/)).toBeInTheDocument();
  });

  it('debounces forecast refetches for the selected product only', async () => {
    const fetchSpy = routeFetch('manager');
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);
    await screen.findByRole('slider');
    const forecastCalls = () => fetchSpy.mock.calls.filter(([url]) => url.includes('/forecast/')).length;
    const before = forecastCalls();
    vi.useFakeTimers();
    try {
      const source = FakeEventSource.instances[0];
      source.emit('forecast.updated', { sku: 'P102', data: {} });
      act(() => vi.advanceTimersByTime(1500));
      expect(forecastCalls()).toBe(before);
      for (let i = 0; i < 5; i++) source.emit('forecast.updated', { sku: 'P101', data: {} });
      act(() => vi.advanceTimersByTime(1500));
      expect(forecastCalls()).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches lists on reconnect and closes the stream on sign out', async () => {
    const fetchSpy = routeFetch('manager', { '/auth/logout': async () => jsonResponse(null, 204) });
    vi.stubGlobal('fetch', fetchSpy);
    render(<App />);
    await screen.findByText('14 units');
    const source = FakeEventSource.instances[0];
    source.emit('open', {});
    const before = fetchSpy.mock.calls.filter(([url]) => url.includes('/products')).length;
    source.emit('open', {});
    await waitFor(() => {
      expect(fetchSpy.mock.calls.filter(([url]) => url.includes('/products')).length).toBe(before + 1);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(source.closed).toBe(true);
  });
});

describe('api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refreshes once on a 401 and retries', async () => {
    const responses = [
      jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401),
      jsonResponse({ user: {} }),
      jsonResponse({ ok: true }),
    ];
    const fetchSpy = vi.fn(async () => responses.shift());
    vi.stubGlobal('fetch', fetchSpy);
    await expect(request('GET', '/products')).resolves.toEqual({ ok: true });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/api/v1/products', '/api/v1/auth/refresh', '/api/v1/products']);
  });

  it('signals logout when the refresh fails', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401)));
    await expect(request('GET', '/products')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('does not try to refresh a failed login and tolerates a non-JSON error', async () => {
    const fetchSpy = vi.fn(async () => new Response('Bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(request('POST', '/auth/login', {})).rejects.toMatchObject({ status: 502, code: 'INTERNAL' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
