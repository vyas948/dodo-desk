import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from './i18n/I18nContext';

export default function Breadcrumb() {
  const location = useLocation();
  const { t } = useTranslation();

  function getCrumbs(pathname) {
    if (pathname === '/') return null;

    const D  = { label: t('breadcrumb.dashboard'),       to: '/' };
    const KB = { label: t('breadcrumb.knowledgeBase'),   to: '/kb' };
    const AS = { label: t('breadcrumb.assets'),          to: '/assets' };
    const CH = { label: t('breadcrumb.changeRequests'),  to: '/changes' };
    const ST = { label: t('breadcrumb.settings'),        to: '/settings' };
    const US = { label: t('breadcrumb.users'),           to: '/admin/users' };

    const staticMap = {
      '/create-ticket':    [D, { label: t('breadcrumb.newTicket') }],
      '/kb':               [D, { label: t('breadcrumb.knowledgeBase') }],
      '/kb/new':           [D, KB, { label: t('breadcrumb.newArticle') }],
      '/assets':           [D, { label: t('breadcrumb.assets') }],
      '/assets/new':       [D, AS, { label: t('breadcrumb.newAsset') }],
      '/changes':          [D, { label: t('breadcrumb.changeRequests') }],
      '/changes/new':      [D, CH, { label: t('breadcrumb.newChange') }],
      '/catalog':          [D, { label: t('breadcrumb.serviceCatalog') }],
      '/reports':          [D, { label: t('breadcrumb.reports') }],
      '/canned-responses': [D, { label: t('breadcrumb.cannedResponses') }],
      '/settings':         [D, { label: t('breadcrumb.settings') }],
      '/admin/users':      [D, ST, { label: t('breadcrumb.users') }],
      '/audit-log':        [D, { label: t('auditLog.title') || 'Audit Log' }],
    };

    if (staticMap[pathname]) return staticMap[pathname];

    const ticketMatch = pathname.match(/^\/tickets\/(\d+)/);
    if (ticketMatch) {
      const id = ticketMatch[1];
      return [D, { label: `INC${id.padStart(6, '0')}` }];
    }

    const kbMatch = pathname.match(/^\/kb\/(\d+)/);
    if (kbMatch) return [D, KB, { label: t('breadcrumb.article') }];

    const assetMatch = pathname.match(/^\/assets\/(\d+)/);
    if (assetMatch) return [D, AS, { label: `${t('breadcrumb.asset')} #${assetMatch[1]}` }];

    const changeMatch = pathname.match(/^\/changes\/(\d+)/);
    if (changeMatch) return [D, CH, { label: `CHG #${changeMatch[1]}` }];

    const editUserMatch = pathname.match(/^\/admin\/users\/.+\/edit/);
    if (editUserMatch) return [D, US, { label: t('breadcrumb.editUser') }];

    return null;
  }

  const crumbs = getCrumbs(location.pathname);
  if (!crumbs) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 mb-4 flex-wrap">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            {isLast || !crumb.to ? (
              <span className={isLast ? 'text-gray-600 dark:text-gray-300 font-medium' : ''}>
                {crumb.label}
              </span>
            ) : (
              <Link to={crumb.to} className="hover:text-indigo-500 dark:hover:text-indigo-400 transition">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
