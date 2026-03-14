const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  health: () => request('/api/health'),
  athletesList: () => request('/api/athletes/list'),
  athletes: () => request('/api/athletes'),
  athlete: (id) => request(`/api/athlete/${id}`),
  athleteHistory: (id, days) => request(`/api/athlete/${id}/history/${days}`),
  refresh: (body) => request('/api/athlete/refresh', { method: 'POST', body: JSON.stringify(body) }),
  controversies: (id) => request(`/api/athlete/${id}/controversy`),
};
