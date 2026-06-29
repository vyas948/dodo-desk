import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';

// Simple SVG icons
const icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  ),
  ticket: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  kb: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  assets: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  changes: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  reports: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  canned: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
    </svg>
  ),
  settings: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  catalog: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
};


// ── Breadcrumb (inline) ───────────────────────────────────────────────────
function getCrumbs(pathname) {
  if (pathname === '/') return null;
  const map = {
    '/create-ticket':    [{ label: 'Dashboard', to: '/' }, { label: 'New Ticket' }],
    '/kb':               [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base' }],
    '/kb/new':           [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base', to: '/kb' }, { label: 'New Article' }],
    '/assets':           [{ label: 'Dashboard', to: '/' }, { label: 'Assets' }],
    '/assets/new':       [{ label: 'Dashboard', to: '/' }, { label: 'Assets', to: '/assets' }, { label: 'New Asset' }],
    '/changes':          [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests' }],
    '/changes/new':      [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests', to: '/changes' }, { label: 'New Change' }],
    '/catalog':          [{ label: 'Dashboard', to: '/' }, { label: 'Service Catalog' }],
    '/reports':          [{ label: 'Dashboard', to: '/' }, { label: 'Reports' }],
    '/canned-responses': [{ label: 'Dashboard', to: '/' }, { label: 'Canned Responses' }],
    '/settings':         [{ label: 'Dashboard', to: '/' }, { label: 'Settings' }],
    '/admin/users':      [{ label: 'Dashboard', to: '/' }, { label: 'Users' }],
  };
  if (map[pathname]) return map[pathname];
  const m = pathname.match(/^\/tickets\/(\d+)/);  if (m) return [{ label: 'Dashboard', to: '/' }, { label: `Ticket #${m[1]}` }];
  const k = pathname.match(/^\/kb\/(\d+)/);        if (k) return [{ label: 'Dashboard', to: '/' }, { label: 'Knowledge Base', to: '/kb' }, { label: 'Article' }];
  const a = pathname.match(/^\/assets\/(\d+)/);    if (a) return [{ label: 'Dashboard', to: '/' }, { label: 'Assets', to: '/assets' }, { label: `Asset #${a[1]}` }];
  const c = pathname.match(/^\/changes\/(\d+)/);   if (c) return [{ label: 'Dashboard', to: '/' }, { label: 'Change Requests', to: '/changes' }, { label: `CHG #${c[1]}` }];
  return null;
}

function Breadcrumb() {
  const location = useLocation();
  const crumbs = getCrumbs(location.pathname);
  if (!crumbs) return null;
  return (
    <nav className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mb-4 flex-wrap">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>}
            {isLast || !crumb.to
              ? <span className={isLast ? "text-gray-600 dark:text-gray-300 font-medium" : ""}>{crumb.label}</span>
              : <Link to={crumb.to} className="hover:text-indigo-500 transition">{crumb.label}</Link>
            }
          </span>
        );
      })}
    </nav>
  );
}

// ── GlobalSearch (inline) ─────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function GlobalSearch({ token }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  const QUICK_LINKS = [
    { label: 'Dashboard', to: '/', icon: '🏠' },
    { label: 'New Ticket', to: '/create-ticket', icon: '🎫' },
    { label: 'Knowledge Base', to: '/kb', icon: '📚' },
    { label: 'Assets', to: '/assets', icon: '💻' },
    { label: 'Change Requests', to: '/changes', icon: '🔄' },
    { label: 'Reports', to: '/reports', icon: '📊' },
    { label: 'Settings', to: '/settings', icon: '⚙️' },
  ];

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

  useEffect(() => {
    if (!query.trim() || !token) { setResults([]); return; }
    setLoading(true);
    const q = encodeURIComponent(query.trim());
    const h = { Authorization: `Bearer ${token}` };
    Promise.allSettled([
      fetch(`${API_BASE}/tickets/?search=${q}&limit=5`, { headers: h }).then(r => r.json()),
      fetch(`${API_BASE}/kb/articles/?search=${q}&limit=4`, { headers: h }).then(r => r.json()),
    ]).then(([tickets, kb]) => {
      const items = [];
      if (tickets.status === 'fulfilled') (tickets.value.items ?? []).forEach(t => items.push({ label: `#${t.id} — ${t.title}`, sub: t.status, to: `/tickets/${t.id}`, icon: '🎫' }));
      if (kb.status === 'fulfilled') (kb.value.items ?? []).forEach(a => items.push({ label: a.title, sub: `KB · ${a.category || 'General'}`, to: `/kb/${a.id}`, icon: '📚' }));
      setResults(items); setCursor(0);
    }).finally(() => setLoading(false));
  }, [query, token]);

  const items = query.trim() ? results : QUICK_LINKS;

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c+1, items.length-1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor(c => Math.max(c-1, 0)); }
    if (e.key === 'Enter')     { e.preventDefault(); if (items[cursor]) { navigate(items[cursor].to); setOpen(false); } }
  };

  if (!open) return (
    <button onClick={() => setOpen(true)} title="Search (Ctrl+K)"
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 text-sm hover:border-indigo-400 hover:text-gray-600 transition">
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      <span>Search</span>
      <kbd className="text-xs bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input ref={inputRef} type="text" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown}
                 placeholder="Search tickets, KB articles..." className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none" />
          {loading && <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
        </div>
        <div className="max-h-80 overflow-y-auto py-2">
          {!query.trim() && <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-4 py-1 mb-1">Quick navigation</p>}
          {query.trim() && results.length === 0 && !loading && <p className="px-4 py-6 text-center text-sm text-gray-400">No results for "{query}"</p>}
          {items.map((item, i) => (
            <button key={i} onClick={() => { navigate(item.to); setOpen(false); }} onMouseEnter={() => setCursor(i)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${cursor===i ? 'bg-indigo-50 dark:bg-indigo-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${cursor===i ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>{item.label}</p>
                {item.sub && <p className="text-xs text-gray-400 truncate">{item.sub}</p>}
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-2 flex gap-4 text-xs text-gray-400">
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">↵</kbd> open</span>
          <span><kbd className="bg-gray-100 dark:bg-gray-700 rounded px-1 font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout, token, setUser } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState(null);

  // Fetch the user's profile photo with authentication
  useEffect(() => {
    if (!user || !user.profile_photo || !token) {
      setAvatarUrl(null);
      return;
    }
    let url = null;
    fetch(`${API_BASE}/users/me/photo`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => {
        if (!res.ok) throw new Error('No photo');
        return res.blob();
      })
      .then(blob => {
        url = URL.createObjectURL(blob);
        setAvatarUrl(url);
      })
      .catch(() => setAvatarUrl(null));

    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [user, token]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Toggle theme
  const toggleTheme = async () => {
    const newTheme = user?.theme === 'dark' ? 'light' : 'dark';
    try {
      await fetch(`${API_BASE}/users/me`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ theme: newTheme }),
      });
      // Update user context with new theme
      setUser({ ...user, theme: newTheme });
    } catch (err) {
      console.error('Failed to save theme', err);
    }
  };

  const isActive = (path) => location.pathname === path;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-[var(--sidebar-bg)] text-white flex flex-col transition-all duration-300`}>
        <div className="p-4 flex items-center justify-between border-b border-white/10">
          {sidebarOpen && <span className="text-lg font-bold">ITSM Portal</span>}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white/70 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarLink to="/" icon={icons.dashboard} label={t('common.dashboard')} open={sidebarOpen} active={isActive('/')} />
          {user?.role === 'employee' && (
            <SidebarLink to="/create-ticket" icon={icons.ticket} label={t('common.newTicket')} open={sidebarOpen} active={isActive('/create-ticket')} />
          )}
          <SidebarLink to="/catalog" icon={icons.catalog} label={t('common.serviceCatalog')} open={sidebarOpen} active={isActive('/catalog')} />
          <SidebarLink to="/kb" icon={icons.kb} label={t('common.knowledgeBase')} open={sidebarOpen} active={isActive('/kb')} />
          <SidebarLink to="/assets" icon={icons.assets} label={t('common.assets')} open={sidebarOpen} active={isActive('/assets')} />
          <SidebarLink to="/changes" icon={icons.changes} label={t('common.changes')} open={sidebarOpen} active={isActive('/changes')} />
          {(user?.role === 'agent' || user?.role === 'admin') && (
            <>
              <SidebarLink to="/canned-responses" icon={icons.canned} label={t('common.cannedResponses')} open={sidebarOpen} active={isActive('/canned-responses')} />
              <SidebarLink to="/reports" icon={icons.reports} label={t('common.reports')} open={sidebarOpen} active={isActive('/reports')} />
            </>
          )}
          {user?.role === 'admin' && (
            <SidebarLink to="/admin/users" icon={icons.users} label={t('common.users')} open={sidebarOpen} active={isActive('/admin/users')} />
          )}
          <SidebarLink to="/settings" icon={icons.settings} label={t('common.settings')} open={sidebarOpen} active={isActive('/settings')} />
        </nav>
        <div className="p-3 border-t border-white/10">
          <button onClick={handleLogout} className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-[var(--sidebar-text)] hover:bg-white/10 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {sidebarOpen && t('common.logout')}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="bg-[var(--card-bg)] shadow-sm border-b border-[var(--border-color)] px-6 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-[var(--text-primary)] truncate">
            {getPageTitle(location.pathname, t)}
          </h1>

          {/* Global search */}
          <div className="flex-1 flex justify-center">
            <GlobalSearch token={token} />
          </div>

          <div className="flex items-center gap-4">
            {/* Theme toggle button */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              title="Toggle theme"
            >
              {user?.theme === 'dark' ? (
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>

            <span className="text-sm text-[var(--text-secondary)]">{user?.email}</span>
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-medium text-sm overflow-hidden">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                user?.email?.charAt(0).toUpperCase()
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 bg-[var(--body-bg)]">
          <Breadcrumb />
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ to, icon, label, open, active }) {
  return (
    <Link to={to} className={`sidebar-link ${active ? 'active' : ''}`} title={!open ? label : ''}>
      {icon}
      {open && <span>{label}</span>}
    </Link>
  );
}

function getPageTitle(pathname, t) {
  if (pathname === '/') return t('common.dashboard');
  if (pathname.startsWith('/tickets/')) return t('ticket.title');
  if (pathname === '/create-ticket') return t('common.newTicket');
  if (pathname.startsWith('/kb')) return t('common.knowledgeBase');
  if (pathname.startsWith('/assets')) return t('common.assets');
  if (pathname.startsWith('/changes')) return t('common.changes');
  if (pathname.startsWith('/canned-responses')) return t('common.cannedResponses');
  if (pathname.startsWith('/reports')) return t('common.reports');
  if (pathname.startsWith('/admin/users')) return t('common.users');
  if (pathname === '/settings') return t('common.settings');
  if (pathname === '/catalog') return t('common.serviceCatalog');
  return '';
}