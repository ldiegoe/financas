// Helpers compartilhados pelos testes.

// Storage em memória que implementa a interface mínima de localStorage.
export const createMemoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => { data.clear(); },
    // Inspeção (não faz parte da API de localStorage, mas útil em testes)
    _data: data,
  };
};
