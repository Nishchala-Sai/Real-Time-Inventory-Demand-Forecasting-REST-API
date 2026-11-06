const BASE = '/api/v1';
const NO_RETRY = new Set(['/auth/login', '/auth/refresh']);

let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

function send(method, path, body) {
  return fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function refreshSession() {
  try {
    return (await send('POST', '/auth/refresh')).ok;
  } catch {
    return false;
  }
}

async function toError(response) {
  const payload = await response.json().catch(() => null);
  return {
    status: response.status,
    code: payload?.error?.code ?? 'INTERNAL',
    message: payload?.error?.message ?? 'Something went wrong',
  };
}

export async function request(method, path, body) {
  let response = await send(method, path, body);
  if (response.status === 401 && !NO_RETRY.has(path)) {
    if (await refreshSession()) {
      response = await send(method, path, body);
    } else {
      onUnauthorized();
    }
  }
  if (!response.ok) throw await toError(response);
  return response.status === 204 ? null : response.json();
}
