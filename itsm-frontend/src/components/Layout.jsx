import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useBranding } from '../contexts/BrandingContext';

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
  auditlog: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  macros: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  groups: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  workflows: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  catalog: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
};

export default function Layout({ children }) {
  const { user, logout, token, setUser } = useAuth();
  const branding = useBranding();
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
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/users/me/photo`, {
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
      await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/users/me`, {
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
          {sidebarOpen ? (
            <div className="flex items-center gap-2.5 min-w-0">
              {branding.logo_url ? (
                <img src={branding.logo_url} alt={branding.company_name || 'Logo'}
                     className="h-8 w-8 rounded-lg object-cover flex-shrink-0 bg-white/10" />
              ) : (
                <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 font-bold text-sm">
                  {(branding.company_name || 'DD').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-base font-bold truncate leading-tight">{branding.company_name || 'DodoDesk'}</p>
                {branding.company_tagline && (
                  <p className="text-[10px] text-white/50 truncate leading-tight">{branding.company_tagline}</p>
                )}
              </div>
            </div>
          ) : (
            branding.logo_url ? (
              <img src={branding.logo_url} alt={branding.company_name || 'Logo'} className="h-8 w-8 rounded-lg object-cover bg-white/10" />
            ) : (
              <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center font-bold text-sm">
                {(branding.company_name || 'DD').charAt(0).toUpperCase()}
              </div>
            )
          )}
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white/70 hover:text-white">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <SidebarLink to="/" icon={icons.dashboard} label={t('common.dashboard')} open={sidebarOpen} active={isActive('/')} />
          <SidebarLink to="/create-ticket" icon={icons.ticket} label={t('common.newTicket')} open={sidebarOpen} active={isActive('/create-ticket')} />
          <SidebarLink to="/catalog" icon={icons.catalog} label={t('common.serviceCatalog')} open={sidebarOpen} active={isActive('/catalog')} />
          <SidebarLink to="/kb" icon={icons.kb} label={t('common.knowledgeBase')} open={sidebarOpen} active={isActive('/kb')} />
          <SidebarLink to="/assets" icon={icons.assets} label={t('common.assets')} open={sidebarOpen} active={isActive('/assets')} />
          <SidebarLink to="/changes" icon={icons.changes} label={t('common.changes')} open={sidebarOpen} active={isActive('/changes')} />
          {['agent','admin','super_admin'].includes(user?.role) && (
            <>
              <SidebarLink to="/canned-responses" icon={icons.canned} label={t('common.cannedResponses')} open={sidebarOpen} active={isActive('/canned-responses')} />
              <SidebarLink to="/reports" icon={icons.reports} label={t('common.reports')} open={sidebarOpen} active={isActive('/reports')} />
              <SidebarLink to="/audit-log" icon={icons.auditlog} label="Audit Log" open={sidebarOpen} active={isActive('/audit-log')} />
            </>
          )}
          {['admin','super_admin'].includes(user?.role) && (
            <>
              <SidebarLink to="/admin/users" icon={icons.users} label={t('common.users')} open={sidebarOpen} active={isActive('/admin/users')} />
            </>
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
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {getPageTitle(location.pathname, t)}
          </h1>
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

            <Link to="/settings" title="View profile"
                  className="flex items-center gap-2 px-1.5 py-1 -mx-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition group">
              <span className="text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">{user?.email}</span>
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-medium text-sm overflow-hidden ring-2 ring-transparent group-hover:ring-indigo-300 transition">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  user?.email?.charAt(0).toUpperCase()
                )}
              </div>
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 bg-[var(--body-bg)]">
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
  if (pathname.startsWith('/tickets/')) return 'Ticket Details';
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