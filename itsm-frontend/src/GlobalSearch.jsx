import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from './i18n/I18nContext';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// QUICK_LINKS moved inside component

function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function GlobalSearch({ token, sidebar = false }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const QUICK_LINKS = [
    { label: t('dashboard.dashboard'),      to: '/',                icon: '🏠' },
    { label: t('breadcrumb.newTicket'),     to: '/create-ticket',   icon: '🎫' },
    { label: t('kb.title'),                 to: '/kb',              icon: '📚' },
    { label: t('asset.title'),              to: '/assets',          icon: '💻' },
    { label: t('change.title'),             to: '/changes',         icon: '🔄' },
    { label: t('catalog.title'),            to: '/catalog',         icon: '📦' },
    { label: t('breadcrumb.reports'),       to: '/reports',         icon: '📊' },
    { label: t('canned.title'),             to: '/canned-responses',icon: '💬' },
    { label: t('settings.settings'),        to: '/settings',        icon: '⚙️' },
    { label: t('breadcrumb.users'),         to: '/admin/users',     icon: '👥' },
    { label: t('auditLog.title'),           to: '/audit-log',       icon: '🔍' },
  ];
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor]   = useState(0);
  const [filter, setFilter]   = useState('all'); // all | tickets | kb | assets
  const inputRef  = useRef(null);
  const listRef   = useRef(null);
  const modalRef  = useRef(null);
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
    if (open) {
      setQuery(''); setResults([]); setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Search
  useEffect(() => {
    if (!debouncedQ.trim() || !token) { setResults([]); return; }
    setLoading(true);
    const q = encodeURIComponent(debouncedQ.trim());
    const headers = { Authorization: `Bearer ${token}` };

    const fetches = [];
    if (filter === 'all' || filter === 'tickets')
      fetches.push(fetch(`${API_BASE}/tickets/?search=${q}&limit=5`, { headers }).then(r => r.json()).then(d => ({ type: 'tickets', data: d })).catch(() => ({ type: 'tickets', data: {} })));
    if (filter === 'all' || filter === 'kb')
      fetches.push(fetch(`${API_BASE}/kb/articles/?search=${q}&limit=4`, { headers }).then(r => r.json()).then(d => ({ type: 'kb', data: d })).catch(() => ({ type: 'kb', data: {} })));
    if (filter === 'all' || filter === 'assets')
      fetches.push(fetch(`${API_BASE}/assets/?search=${q}&limit=3`, { headers }).then(r => r.json()).then(d => ({ type: 'assets', data: d })).catch(() => ({ type: 'assets', data: {} })));

    Promise.all(fetches).then(responses => {
      const items = [];
      responses.forEach(({ type, data }) => {
        if (type === 'tickets') {
          (data.items ?? []).forEach(t => items.push({
            label: `#${t.id} — ${t.title}`, sub: `Ticket · ${t.status} · ${t.priority}`,
            to: `/tickets/${t.id}`, icon: t.ticket_type === 'incident' ? '🚨' : '📋',
          }));
        }
        if (type === 'kb') {
          (data.items ?? []).forEach(a => items.push({
            label: a.title, sub: `KB Article · ${a.category || 'General'}`,
            to: `/kb/${a.id}`, icon: '📚',
          }));
        }
        if (type === 'assets') {
          const list = data.items ?? (Array.isArray(data) ? data : []);
          list.forEach(a => items.push({
            label: a.name, sub: `Asset · ${a.type || ''}`,
            to: `/assets/${a.id}`, icon: '💻',
          }));
        }
      });
      setResults(items);
      setCursor(0);
    }).finally(() => setLoading(false));
  }, [debouncedQ, token, filter]);

  const visibleItems = query.trim() ? results : QUICK_LINKS;

  const handleSelect = useCallback((item) => {
    navigate(item.to);
    setOpen(false);
  }, [navigate]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, visibleItems.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = visibleItems[cursor];
      if (item) handleSelect(item);
    }
  }, [visibleItems, cursor, handleSelect]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // Collapsed sidebar — just show icon button
  if (!open && sidebar) {
    return (
      <button onClick={() => setOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 hover:text-white text-sm transition">
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <span className="flex-1 text-left truncate">{t('search.searchLabel')}</span>
        <kbd className="text-xs bg-white/10 rounded px-1.5 py-0.5 font-mono hidden lg:block">⌘K</kbd>
      </button>
    );
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4 sm:px-0"
         // Use onMouseDown on backdrop — fires before click on results, doesn't steal focus
         onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      <div ref={modalRef}
           className="relative w-full max-w-3xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">

        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>
          <input ref={inputRef} type="text" value={query}
                 onChange={e => { setQuery(e.target.value); setCursor(0); }}
                 onKeyDown={handleKeyDown}
                 placeholder={t('search.searchPlaceholder')}
                 className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none" />
          {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          <kbd className="text-xs bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded px-1.5 py-0.5 text-gray-500 font-mono flex-shrink-0">Esc</kbd>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {[[t('search.filterAll'),'all'],[t('search.filterTickets'),'tickets'],[t('search.filterKb'),'kb'],[t('search.filterAssets'),'assets']].map(([label, key]) => (
            <button key={key}
                    onMouseDown={e => { e.preventDefault(); setFilter(key); setCursor(0); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                      filter === key
                        ? 'bg-indigo-600 text-white'
                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {!query.trim() && (
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 py-1 mb-1">{t('search.quickNav')}</p>
          )}
          {query.trim() && results.length === 0 && !loading && (
            <p className="px-4 py-8 text-center text-sm text-gray-400">{t('search.noResults').replace('{q}', query)}</p>
          )}
          {visibleItems.map((item, i) => (
            <button key={i} data-idx={i}
                    // onMouseDown prevents blur from firing before click
                    onMouseDown={e => { e.preventDefault(); handleSelect(item); }}
                    onMouseEnter={() => setCursor(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${
                      cursor === i ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}>
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
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↑↓</kbd> {t('search.navigate')}</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↵</kbd> {t('search.open')}</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">Esc</kbd> {t('search.close')}</span>
        </div>
      </div>
    </div>
  );
}
