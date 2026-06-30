import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import Layout from '../components/Layout';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const STATUS_CLASSES = {
  available:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  assigned:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  maintenance: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  retired:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  disposed:    'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  lost:        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  stolen:      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function AssetList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const [assets, setAssets]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter]     = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  const fetchAssets = (q = search, type = typeFilter, status = statusFilter) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: 100 });
    if (q)      params.append('search', q);
    if (type)   params.append('type', type);
    if (status) params.append('status', status);
    fetch(`${API}/assets/?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => {
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return res.json();
      })
      .then(data => {
        // Handle both array response and paginated {items, total} response
        if (Array.isArray(data)) {
          setAssets(data);
          setTotal(data.length);
        } else {
          setAssets(data.items ?? []);
          setTotal(data.total ?? 0);
        }
      })
      .catch(err => console.error('Assets fetch error:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAssets(); }, [token]);

  const isExpiringSoon = (dateStr) => {
    if (!dateStr) return false;
    const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
    return diff <= 30 && diff > 0;
  };

  const isExpired = (dateStr) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
            {t('asset.title')}
            {total > 0 && <span className="ml-2 text-sm font-normal text-gray-400">({total})</span>}
          </h2>
          {isAgentOrAdmin && (
            <Link to="/assets/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
              + {t('asset.newAsset')}
            </Link>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input type="text" placeholder={t('asset.searchPlaceholder')} value={search}
                   onChange={e => { setSearch(e.target.value); fetchAssets(e.target.value, typeFilter, statusFilter); }}
                   className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); fetchAssets(search, e.target.value, statusFilter); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All types</option>
            {['hardware','software','network','mobile','peripheral','saas','cloud','other'].map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); fetchAssets(search, typeFilter, e.target.value); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All statuses</option>
            {['available','assigned','maintenance','retired','disposed','lost','stolen'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>
            ))}
          </select>
          {(search || typeFilter || statusFilter) && (
            <button onClick={() => { setSearch(''); setTypeFilter(''); setStatusFilter(''); fetchAssets('','',''); }}
                    className="text-sm text-red-500 hover:text-red-700 px-2">× Clear</button>
          )}
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-10">{t('common.loading')}</p>
        ) : assets.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-10 text-center">
            <p className="text-4xl mb-3">💻</p>
            <p className="text-gray-400">{t('asset.noAssets')}</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {[t('common.name'), t('asset.type'), 'Model', t('asset.serial'), t('asset.status'), t('asset.assignedTo'), t('asset.expiryDate')].map(h => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {assets.map(a => {
                    const expiring = isExpiringSoon(a.expiry_date);
                    const expired  = isExpired(a.expiry_date);
                    return (
                      <tr key={a.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition ${expiring ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''} ${expired ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                        <td className="px-6 py-4">
                          <Link to={`/assets/${a.id}`} className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium text-sm">{a.name}</Link>
                          {expired  && <span className="ml-2 text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded-full">Expired</span>}
                          {expiring && !expired && <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-1.5 py-0.5 rounded-full">{t('asset.expiringSoon')}</span>}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 capitalize">{a.type || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{a.model || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300 font-mono">{a.serial_number || '—'}</td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_CLASSES[a.status] || 'bg-gray-100 text-gray-500'}`}>
                            {a.status || '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{a.assigned_to_name || '—'}</td>
                        <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                          {a.expiry_date ? new Date(a.expiry_date).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
