import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { apiFetch } from './apiFetch';
import { formatId } from './utils/ticketId';

const STATIC_LINKS = [
  { type: 'nav', label: 'Dashboard',         to: '/',               icon: '🏠' },
  { type: 'nav', label: 'New Ticket',         to: '/create-ticket',  icon: '🎫' },
  { type: 'nav', label: 'Knowledge Base',     to: '/kb',             icon: '📚' },
  { type: 'nav', label: 'Assets',             to: '/assets',         icon: '💻' },
  { type: 'nav', label: 'Change Requests',    to: '/changes',        icon: '🔄' },
  { type: 'nav', label: 'Service Catalog',    to: '/catalog',        icon: '📦' },
  { type: 'nav', label: 'Reports',            to: '/reports',        icon: '📊' },
  { type: 'nav', label: 'Canned Responses',   to: '/canned-responses', icon: '💬' },
  { type: 'nav', label: 'Settings',           to: '/settings',       icon: '⚙️' },
  { type: 'nav', label: 'Audit Log',          to: '/audit-log',      icon: '🔍' },
];

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function GlobalSearch() {
  const { token } = useAuth();
  const navigate  = useNavigate();
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor]   = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const debouncedQ = useDebounce(query, 250);

  // Cmd+K / Ctrl+K opens
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setCursor(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  // Search
  useEffect(() => {
    if (!debouncedQ.trim() || !token) { setResults([]); return; }
    const q = debouncedQ.trim();
    setLoading(true);
    Promise.allSettled([
      apiFetch(`/tickets/?search=${encodeURIComponent(q)}&limit=5`, token),
      apiFetch(`/kb/articles/?search=${encodeURIComponent(q)}&limit=4`, token),
      apiFetch(`/assets/?search=${encodeURIComponent(q)}&limit=4`, token),
    ]).then(([tickets, kb, assets]) => {
      const items = [];
      if (tickets.status === 'fulfilled') {
        (tickets.value.items ?? []).forEach(t => items.push({
          type: 'ticket', label: `${formatId(t.id, t.ticket_type)} — ${t.title}`,
          sub: `${t.status} · ${t.priority}`,
          to: `/tickets/${t.id}`, icon: t.ticket_type === 'incident' ? '🚨' : '📋',
        }));
      }
      if (kb.status === 'fulfilled') {
        (kb.value.items ?? []).forEach(a => items.push({
          type: 'kb', label: a.title, sub: `KB · ${a.category || 'General'}`,
          to: `/kb/${a.id}`, icon: '📚',
        }));
      }
      if (assets.status === 'fulfilled') {
        const assetItems = assets.value.items ?? (Array.isArray(assets.value) ? assets.value : []);
        assetItems.forEach(a => items.push({
          type: 'asset', label: a.name, sub: `Asset · ${a.type || ''}`,
          to: `/assets/${a.id}`, icon: '💻',
        }));
      }
      setResults(items);
      setCursor(0);
    }).finally(() => setLoading(false));
  }, [debouncedQ, token]);

  const visibleItems = query.trim()
    ? results
    : STATIC_LINKS;

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, visibleItems.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = visibleItems[cursor];
      if (item) { navigate(item.to); setOpen(false); }
    }
  }, [visibleItems, cursor, navigate]);

  // Scroll cursor into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
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
        <kbd className="ml-1 text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
           onClick={e => e.stopPropagation()}>

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input ref={inputRef} type="text" value={query} onChange={e => { setQuery(e.target.value); setCursor(0); }}
                 onKeyDown={handleKeyDown}
                 placeholder="Search tickets, KB articles, assets..."
                 className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none" />
          {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          <kbd className="text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-500 font-mono flex-shrink-0">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-96 overflow-y-auto py-2">
          {!query.trim() && (
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-4 py-1 mb-1">Quick navigation</p>
          )}
          {query.trim() && results.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No results for "{query}"
            </div>
          )}
          {visibleItems.map((item, i) => (
            <button key={i} data-idx={i}
                    onClick={() => { navigate(item.to); setOpen(false); }}
                    onMouseEnter={() => setCursor(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${cursor === i ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
              <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${cursor === i ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                  {item.label}
                </p>
                {item.sub && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{item.sub}</p>}
              </div>
              {cursor === i && (
                <kbd className="text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-400 font-mono flex-shrink-0">↵</kbd>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2 flex items-center gap-4 text-xs text-gray-400">
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↵</kbd> open</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
