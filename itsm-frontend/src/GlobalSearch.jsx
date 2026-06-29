import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const QUICK_LINKS = [
  { label: 'Dashboard',       to: '/',               icon: '🏠' },
  { label: 'New Ticket',      to: '/create-ticket',  icon: '🎫' },
  { label: 'Knowledge Base',  to: '/kb',             icon: '📚' },
  { label: 'Assets',          to: '/assets',         icon: '💻' },
  { label: 'Change Requests', to: '/changes',        icon: '🔄' },
  { label: 'Service Catalog', to: '/catalog',        icon: '📦' },
  { label: 'Reports',         to: '/reports',        icon: '📊' },
  { label: 'Canned Responses',to: '/canned-responses',icon: '💬' },
  { label: 'Settings',        to: '/settings',       icon: '⚙️' },
];

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function GlobalSearch({ token }) {
  const navigate   = useNavigate();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor]   = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const debouncedQ = useDebounce(query, 300);

  // Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(o => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setCursor(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  // Search tickets + KB
  useEffect(() => {
    if (!debouncedQ.trim() || !token) { setResults([]); return; }
    setLoading(true);
    const q = encodeURIComponent(debouncedQ.trim());
    const headers = { Authorization: `Bearer ${token}` };
    Promise.allSettled([
      fetch(`${API_BASE}/tickets/?search=${q}&limit=5`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/kb/articles/?search=${q}&limit=4`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/assets/?search=${q}&limit=3`, { headers }).then(r => r.json()),
    ]).then(([tickets, kb, assets]) => {
      const items = [];
      if (tickets.status === 'fulfilled') {
        (tickets.value.items ?? []).forEach(t => items.push({
          label: `#${t.id} — ${t.title}`,
          sub: `${t.status} · ${t.priority}`,
          to: `/tickets/${t.id}`,
          icon: t.ticket_type === 'incident' ? '🚨' : '📋',
        }));
      }
      if (kb.status === 'fulfilled') {
        (kb.value.items ?? []).forEach(a => items.push({
          label: a.title,
          sub: `KB · ${a.category || 'General'}`,
          to: `/kb/${a.id}`,
          icon: '📚',
        }));
      }
      if (assets.status === 'fulfilled') {
        const list = assets.value.items ?? (Array.isArray(assets.value) ? assets.value : []);
        list.forEach(a => items.push({
          label: a.name,
          sub: `Asset · ${a.type || ''}`,
          to: `/assets/${a.id}`,
          icon: '💻',
        }));
      }
      setResults(items);
      setCursor(0);
    }).finally(() => setLoading(false));
  }, [debouncedQ, token]);

  const visibleItems = query.trim() ? results : QUICK_LINKS;

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, visibleItems.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = visibleItems[cursor];
      if (item) { navigate(item.to); setOpen(false); }
    }
  }, [visibleItems, cursor, navigate]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
              className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-sm hover:border-indigo-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
              title="Search (⌘K)">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <span>Search</span>
        <kbd className="text-xs bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
           onClick={e => e.stopPropagation()}>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input ref={inputRef} type="text" value={query}
                 onChange={e => { setQuery(e.target.value); setCursor(0); }}
                 onKeyDown={handleKeyDown}
                 placeholder="Search tickets, KB articles, assets..."
                 className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none" />
          {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          <kbd className="text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-500 font-mono flex-shrink-0">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
          {!query.trim() && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 py-1 mb-1">Quick navigation</p>
          )}
          {query.trim() && results.length === 0 && !loading && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">No results for "{query}"</p>
          )}
          {visibleItems.map((item, i) => (
            <button key={i} data-idx={i}
                    onClick={() => { navigate(item.to); setOpen(false); }}
                    onMouseEnter={() => setCursor(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${cursor === i ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
              <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${cursor === i ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{item.label}</p>
                {item.sub && <p className="text-xs text-gray-400 truncate">{item.sub}</p>}
              </div>
              {cursor === i && <kbd className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1 text-gray-400 font-mono flex-shrink-0">↵</kbd>}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2 flex gap-4 text-xs text-gray-400">
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↵</kbd> open</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
