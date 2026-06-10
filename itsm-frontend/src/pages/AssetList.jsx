import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../utils/apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import { API } from '../api';

const LIMIT = 20;

export default function AssetList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [assets, setAssets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchAssets = (searchTerm = '', p = 1) => {
    const params = new URLSearchParams({ skip: (p - 1) * LIMIT, limit: LIMIT });
    if (searchTerm) params.append('search', searchTerm);
    fetch(`${API}/assets/?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setAssets(data.items ?? []); setTotal(data.total ?? 0); })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setPage(1);
    if (search.length === 1) return;
    const timer = setTimeout(() => fetchAssets(search, 1), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [token, search]);

  const handlePageChange = (p) => { setPage(p); fetchAssets(search, p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const isExpiringSoon = (expiryDateStr) => {
    if (!expiryDateStr) return false;
    const diff = Math.ceil((new Date(expiryDateStr) - new Date()) / (1000 * 60 * 60 * 24));
    return diff <= 30 && diff > 0;
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('asset.title')}</h2>
          {(user?.role === 'agent' || user?.role === 'admin') && (
            <Link to="/assets/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition">
              {t('asset.newAsset')}
            </Link>
          )}
        </div>

        <div className="mb-6 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder={t('asset.searchPlaceholder')} value={search}
                 onChange={e => setSearch(e.target.value)}
                 className="w-full pl-10 pr-8 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {search && (
            <button onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              ✕
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : assets.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('asset.noAssets')}</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.name')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('asset.type')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('asset.serial')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('asset.status')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('asset.assignedTo')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('asset.expiryDate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {assets.map(a => {
                  const expiring = isExpiringSoon(a.expiry_date);
                  return (
                    <tr key={a.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${expiring ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <Link to={`/assets/${a.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">{a.name}</Link>
                        {expiring && <span className="ml-2 text-xs text-yellow-700 dark:text-yellow-300 bg-yellow-200 dark:bg-yellow-800 px-1.5 py-0.5 rounded-full">{t('asset.expiringSoon')}</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{t(`asset.${a.type}`)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{a.serial_number || '—'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{t(`asset.${a.status}`)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{a.assigned_to_name || t('common.none')}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">{a.expiry_date ? new Date(a.expiry_date).toLocaleDateString() : '—'}</td>
                    </tr>
                  );
                })}
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
