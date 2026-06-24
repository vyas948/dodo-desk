import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { formatId } from '../utils/ticketId';
import Pagination from '../components/Pagination';
import { API } from '../api';

const RISK_CLASSES = {
  low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};
const LIMIT = 20;

export default function ChangeList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [changes, setChanges] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchChanges = (p = 1, search = '') => {
    setLoading(true);
    const params = new URLSearchParams({ skip: (p - 1) * LIMIT, limit: LIMIT });
    if (search) params.append('search', search);
    fetch(`${API}/changes/?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setChanges(data.items ?? []); setTotal(data.total ?? 0); })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); fetchChanges(1, searchTerm); }, searchTerm ? 300 : 0);
    return () => clearTimeout(timer);
  }, [token, searchTerm]);

  // Page change
  useEffect(() => { fetchChanges(page, searchTerm); }, [page]);

  useEffect(() => { if (token) fetchChanges(1); }, [token]);

  const handlePageChange = (p) => { setPage(p); };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('change.title')}</h2>
          {(user?.role === 'employee' || user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && (
            <Link to="/changes/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition">
              {t('change.newChange')}
            </Link>
          )}
        </div>

        {/* Live search */}
        <div className="relative mb-6">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder={t('common.search') + ' ' + t('change.title') + '...'}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : changes.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('change.noChanges')}</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.title')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('change.riskLevel')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.status')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('change.plannedDate')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('ticket.requester')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {changes.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 text-sm font-medium">
                      <Link to={`/changes/${c.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{formatId(c.id, 'change')}</Link>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{c.title}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${RISK_CLASSES[c.risk_level] || 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                        {t(`change.${c.risk_level}`)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{t(`change.${c.status}`)}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{c.planned_date ? new Date(c.planned_date).toLocaleDateString() : '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{c.requester_name}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <div className="border-t border-gray-100 dark:border-gray-700 px-6">
              <Pagination total={total} page={page} limit={LIMIT} onPageChange={handlePageChange} />
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
