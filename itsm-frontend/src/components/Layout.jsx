import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useBranding } from '../contexts/BrandingContext';
import { apiFetch } from '../apiFetch';
import NotificationBell from './NotificationBell';
import { API } from '../api';

const icons = {
  dashboard: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h7" /></svg>,
  ticket: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  kb: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
  assets: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>,
  changes: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  reports: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
  users: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
  canned: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>,
  settings: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  catalog: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>,
  logout: <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>,
};

export default function Layout({ children }) {
  const { user, logout, token, setUser } = useAuth();
  const { t } = useTranslation();
  const branding = useBranding();
  const navigate = useNavigate();
  const location = useLocation();

  // Desktop: sidebar collapsed/expanded. Mobile: sidebar hidden/shown as drawer
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);

  // Close mobile sidebar on navigation
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Close mobile sidebar on outside click via overlay
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e) => {
      if (e.target.id === 'sidebar-overlay') setMobileOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [mobileOpen]);

  useEffect(() => {
    if (!user || !user.profile_photo || !token) { setAvatarUrl(null); return; }
    let url = null;
    fetch(`${API}/users/me/photo`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => { if (!res.ok) throw new Error('No photo'); return res.blob(); })
      .then(blob => { url = URL.createObjectURL(blob); setAvatarUrl(url); })
      .catch(() => setAvatarUrl(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [user, token]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const toggleTheme = async () => {
    const newTheme = user?.theme === 'dark' ? 'light' : 'dark';
    try {
      await apiFetch('/users/me', token, { method: 'PUT', body: JSON.stringify({ theme: newTheme }) });
      setUser({ ...user, theme: newTheme });
    } catch (err) { console.error('Failed to save theme', err); }
  };

  const isActive = (path) => location.pathname === path;
  const sidebarBg = branding.primary_color || 'var(--sidebar-bg)';
  const accentColor = branding.accent_color || '#4f46e5';

  const SidebarContent = () => (
    <>
      {/* Logo + toggle */}
      <div className="p-4 flex items-center justify-between border-b border-white/10">
        {sidebarOpen && (
          <div className="flex items-center gap-2 min-w-0">
            {branding.logo_url && (
              <img src={branding.logo_url.startsWith('http') ? branding.logo_url : `${API}${branding.logo_url}`} alt="Logo" className="w-7 h-7 rounded object-contain flex-shrink-0" onError={e => { e.target.style.display = 'none'; }} />
            )}
            <div className="min-w-0">
              <span className="text-sm font-bold text-white truncate block">{branding.company_name}</span>
              {branding.company_tagline && <span className="text-xs text-white/50 truncate block">{branding.company_tagline}</span>}
            </div>
          </div>
        )}
        {/* Hide collapse button on mobile — use overlay to close */}
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
                className="text-white/70 hover:text-white flex-shrink-0 hidden md:block">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto p-3 space-y-1">
        <SidebarLink to="/" icon={icons.dashboard} label={t('common.dashboard')} open={sidebarOpen} active={isActive('/')} accent={accentColor} />
        <SidebarLink to="/create-ticket" icon={icons.ticket} label={t('common.newTicket')} open={sidebarOpen} active={isActive('/create-ticket')} accent={accentColor} />
        <SidebarLink to="/catalog" icon={icons.catalog} label={t('common.serviceCatalog')} open={sidebarOpen} active={isActive('/catalog')} accent={accentColor} />
        <SidebarLink to="/kb" icon={icons.kb} label={t('common.knowledgeBase')} open={sidebarOpen} active={isActive('/kb')} accent={accentColor} />
        <SidebarLink to="/assets" icon={icons.assets} label={t('common.assets')} open={sidebarOpen} active={isActive('/assets')} accent={accentColor} />
        <SidebarLink to="/changes" icon={icons.changes} label={t('common.changes')} open={sidebarOpen} active={isActive('/changes')} accent={accentColor} />
        {(user?.role === 'agent' || user?.role === 'admin') && (
          <>
            <SidebarLink to="/workflows" icon={icons.canned} label="Workflows" open={sidebarOpen} active={isActive('/workflows')} accent={accentColor} />
            <SidebarLink to="/canned-responses" icon={icons.canned} label={t('common.cannedResponses')} open={sidebarOpen} active={isActive('/canned-responses')} accent={accentColor} />
            <SidebarLink to="/reports" icon={icons.reports} label={t('common.reports')} open={sidebarOpen} active={isActive('/reports')} accent={accentColor} />
          </>
        )}
        {user?.role === 'admin' && (
          <SidebarLink to="/admin/users" icon={icons.users} label={t('common.users')} open={sidebarOpen} active={isActive('/admin/users')} accent={accentColor} />
        )}
        <SidebarLink to="/settings" icon={icons.settings} label={t('common.settings')} open={sidebarOpen} active={isActive('/settings')} accent={accentColor} />
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-white/10">
        <button onClick={handleLogout}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 hover:text-white transition">
          {icons.logout}
          {sidebarOpen && t('common.logout')}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Mobile overlay */}
      {mobileOpen && (
        <div id="sidebar-overlay"
             className="fixed inset-0 bg-black/50 z-30 md:hidden" />
      )}

      {/* Sidebar — desktop: always visible, mobile: drawer */}
      <aside
        className={`
          fixed md:relative z-40 h-full flex flex-col transition-all duration-300
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          ${sidebarOpen ? 'w-64' : 'md:w-20 w-64'}
        `}
        style={{ backgroundColor: sidebarBg }}
      >
        <SidebarContent />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header */}
        <header className="bg-[var(--card-bg)] shadow-sm border-b border-[var(--border-color)] px-4 md:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Mobile hamburger */}
            <button onClick={() => setMobileOpen(true)}
                    className="md:hidden p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h1 className="text-base md:text-lg font-semibold text-[var(--text-primary)] truncate">
              {getPageTitle(location.pathname, t)}
            </h1>
          </div>

          <div className="flex items-center gap-2 md:gap-4 flex-shrink-0">
            <NotificationBell />
            {/* Theme toggle */}
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition" title="Toggle theme">
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
            {/* Avatar — hide email on mobile */}
            <span className="hidden sm:block text-sm text-[var(--text-secondary)]">{user?.email}</span>
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-medium text-sm overflow-hidden flex-shrink-0">
              {avatarUrl ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" /> : user?.email?.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 bg-[var(--body-bg)]">
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ to, icon, label, open, active, accent }) {
  return (
    <Link to={to}
          className="sidebar-link"
          style={active ? { backgroundColor: accent || '#4f46e5', color: '#fff' } : {}}>
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
  if (pathname.startsWith('/admin/tenants')) return 'Tenants';
  if (pathname === '/settings') return t('common.settings');
  if (pathname === '/catalog') return t('common.serviceCatalog');
  return '';
}
