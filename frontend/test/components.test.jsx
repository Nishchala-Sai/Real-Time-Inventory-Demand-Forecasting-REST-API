import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForecastChart from '../src/components/ForecastChart';
import ForecastPanel from '../src/components/ForecastPanel';
import InventoryTable from '../src/components/InventoryTable';
import LoginForm from '../src/components/LoginForm';
import { forecastResponse, jsonResponse, products } from './fixtures';

// Chart.js needs a real canvas, and these tests only care about the data it is given.
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <ul aria-label="legend">
      {data.datasets.map((dataset) => <li key={dataset.label}>{dataset.label}</li>)}
    </ul>
  ),
}));

const { history, forecast } = forecastResponse;

describe('ForecastChart', () => {
  it('builds the legend from the actual alpha', () => {
    const { rerender } = render(<ForecastChart history={history} forecast={forecast} method="ses" params={{ alpha: 0.8 }} />);
    expect(screen.getByText('SES (α=0.80) forecast')).toBeInTheDocument();
    rerender(<ForecastChart history={history} forecast={forecast} method="ses" params={{ alpha: 0.25 }} />);
    expect(screen.getByText('SES (α=0.25) forecast')).toBeInTheDocument();
  });

  it.each([
    ['sma', { window: 7 }, 'SMA (k=7) fitted'],
    ['holt', { alpha: 0.5, beta: 0.2 }, 'Holt (α=0.50, β=0.20) fitted'],
    ['croston', { alpha: 0.1 }, 'Croston (α=0.10) fitted'],
    ['coldstart', { window: 3 }, 'New product (k=3) fitted'],
  ])('labels %s with its parameters', (method, params, label) => {
    render(<ForecastChart history={history} forecast={forecast} method={method} params={params} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('InventoryTable', () => {
  it('shows the status as text, not only colour', () => {
    render(<InventoryTable products={products} />);
    expect(screen.getByText('Reorder Needed')).toBeInTheDocument();
    expect(screen.getByText('Optimal')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('filters to low stock and flashes updated rows', () => {
    render(<InventoryTable products={products} flashing={['P101']} />);
    expect(screen.getByText('Mechanical Keyboard').closest('tr')).toHaveClass('row-flash');
    fireEvent.click(screen.getByLabelText('Low stock only'));
    expect(screen.queryByText('Wireless Mouse')).not.toBeInTheDocument();
    expect(screen.getByText('Mechanical Keyboard')).toBeInTheDocument();
  });
});

describe('LoginForm', () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('shows the server error and allows another try', async () => {
    render(<LoginForm onLogin={vi.fn().mockRejectedValue({ message: 'Invalid email or password' })} />);
    fill();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('passes the credentials on', async () => {
    const onLogin = vi.fn().mockResolvedValue();
    render(<LoginForm onLogin={onLogin} />);
    fill();
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('a@example.com', 'secret-secret'));
  });
});

describe('ForecastPanel', () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => jsonResponse(forecastResponse));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the explanation, metrics and reorder advice', async () => {
    render(<ForecastPanel sku="P101" canEdit refreshKey={0} />);
    expect(await screen.findByText(/Expect about 33\.8 units\/day/)).toBeInTheDocument();
    expect(screen.getByText(/Holt beat SES/)).toBeInTheDocument();
    expect(screen.getByText('4.28')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('-3.90')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('245')).toBeInTheDocument();
    expect(screen.getByText('300 units')).toBeInTheDocument();
  });

  it('previews alpha locally with no request per tick', async () => {
    render(<ForecastPanel sku="P101" canEdit refreshKey={0} />);
    const slider = await screen.findByRole('slider');
    const before = fetchSpy.mock.calls.length;
    for (const value of ['0.2', '0.3', '0.4', '0.5', '0.6']) fireEvent.change(slider, { target: { value } });
    expect(fetchSpy.mock.calls.length).toBe(before);
    expect(screen.getByText('SES (α=0.60) forecast')).toBeInTheDocument();
    expect(screen.getByText(/SES, α=0\.60/)).toBeInTheDocument();
  });

  it('Apply α saves the previewed value through tune', async () => {
    render(<ForecastPanel sku="P101" canEdit refreshKey={0} />);
    const slider = await screen.findByRole('slider');
    fireEvent.change(slider, { target: { value: '0.4' } });
    fetchSpy.mockImplementationOnce(async () => jsonResponse({ sku: 'P101', alpha: 0.4, next: 30, reorderPoint: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply α' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved α = 0.40.');
    const [url, options] = fetchSpy.mock.calls.find(([path]) => path.includes('/tune'));
    expect(url).toBe('/api/v1/forecast/P101/tune');
    expect(JSON.parse(options.body)).toEqual({ alpha: 0.4 });
  });

  it('hides the editing controls from suppliers', async () => {
    render(<ForecastPanel sku="P101" canEdit={false} refreshKey={0} />);
    await screen.findByRole('slider');
    expect(screen.queryByRole('button', { name: 'Apply α' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auto-tune α' })).not.toBeInTheDocument();
  });

  it('shows an error when the forecast fails', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ error: { code: 'NOT_FOUND', message: 'Product not found' } }, 404));
    render(<ForecastPanel sku="P101" canEdit refreshKey={0} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Product not found');
  });
});
