window.CorrigenAPI = (() => {
  async function request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  return {
    get: (path) => request(path),
    post: (path, body = {}) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    patch: (path, body = {}) => request(path, { method: 'PATCH', body: JSON.stringify(body) })
  };
})();
