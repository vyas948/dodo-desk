import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';

const LIMIT = 20;
const ASSET_TYPES = ['hardware','software','network','mobile','peripheral','saas','cloud','other'];
const ASSET_STATUSES = ['available','assigned','maintenance','retired','disposed','lost','stolen'];
const TYPE_ICONS = { hardware:'💻', software:'📦', network:'🌐', mobile:'📱', peripheral:'🖨️', saas:'☁️', cloud:'🔷', other:'📋' };

export default function AssetList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const isAdmin = ['admin','super_admin'].includes(user?.role);
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);
  const fileRef = useRef();

  const [assets, setAssets]         = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [search, setSearch]         = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading]       = useState(true);
  const [insights, setInsights]     = useState(null);
  const [showInsights, setShowInsights] = useState(false);

  // Bulk selection
  const [selected, setSelected]     = useState(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [applyingBulk, setApplyingBulk] = useState(false);

  // CSV Import
  const [importing, setImporting]   = useState(false);

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: (page-1)*LIMIT, limit: LIMIT });
      if (search) params.append('search', search);
      if (typeFilter) params.append('asset_type', typeFilter);
      if (statusFilter) params.append('status', statusFilter);
      const data = await apiFetch(`/assets/?${params}`, token);
      setAssets(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const fetchInsights = async () => {
    try { setInsights(await apiFetch('/assets/insights/summary', token)); } catch {}
  };

  useEffect(() => { fetchAssets(); }, [token, page, search, typeFilter, statusFilter]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return;
    setApplyingBulk(true);
    try {
      const res = await apiFetch('/assets/bulk-action', token, {
        method: 'POST',
        body: JSON.stringify({ asset_ids: [...selected], action: bulkAction })
      });
      toast.success(`Updated ${res.updated} assets`);
      setSelected(new Set());
      setBulkAction('');
      fetchAssets();
    } catch(e) { toast.error(e.message); }
    finally { setApplyingBulk(false); }
  };

  const handleCSVImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',');
        return Object.fromEntries(headers.map((h, i) => [h, (vals[i] || '').trim()]));
      });
      const res = await apiFetch('/assets/bulk-import', token, {
        method: 'POST', body: JSON.stringify({ rows })
      });
      toast.success(`Imported ${res.created} assets${res.errors?.length ? ` (${res.errors.length} errors)` : ''}`);
      if (res.errors?.length) console.warn('Import errors:', res.errors);
      fetchAssets();
    } catch(e) { toast.error(e.message); }
    finally { setImporting(false); e.target.value = ''; }
  };

  const exportCSV = () => {
    const headers = ['ID','Name','Type','Status','Serial Number','Vendor','Location','Assigned To','Expiry Date','Tag Number'];
    const rows = assets.map(a => [a.id, a.name, a.type, a.status, a.serial_number||'', a.vendor||'', a.location||'', a.assigned_to_name||'', a.expiry_date||'', a.tag_number||'']);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'assets.csv'; a.click();
  };

  const statusColor = (s) => ({
    available: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
    assigned: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
    maintenance: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    retired: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    disposed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    lost: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    stolen: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  }[s] || 'bg-gray-100 text-gray-600');

  const isExpiringSoon = (d) => {
    if (!d) return false;
    const days = (new Date(d) - new Date()) / (1000*60*60*24);
    return days >= 0 && days <= 30;
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{t('common.assets')}</h2>
          <div className="flex gap-2 flex-wrap">
            {isAgentOrAdmin && (
              <button onClick={() => { setShowInsights(!showInsights); if (!insights) fetchInsights(); }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${showInsights ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}>
                📊 Insights
              </button>
            )}
            {isAdmin && (
              <>
                <button onClick={() => fileRef.current?.click()} disabled={importing}
                        className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition">
                  {importing ? 'Importing...' : '📥 Import CSV'}
                </button>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
                <button onClick={exportCSV} className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition">
                  📤 Export CSV
                </button>
                <Link to="/assets/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
                  + {t('asset.new')}
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Insights Panel */}
        {showInsights && insights && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 mb-6">
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">📊 Asset Insights</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="text-center p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                <p className="text-2xl font-bold text-indigo-600">{insights.total}</p>
                <p className="text-xs text-gray-500">Total assets</p>
              </div>
              <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-2xl font-bold text-red-600">{insights.expiring_30_days}</p>
                <p className="text-xs text-gray-500">Expiring in 30 days</p>
              </div>
              <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                <p className="text-2xl font-bold text-amber-600">{insights.maintenance_due}</p>
                <p className="text-xs text-gray-500">Maintenance due</p>
              </div>
              <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                <p className="text-2xl font-bold text-green-600">${insights.total_purchase_cost?.toLocaleString()}</p>
                <p className="text-xs text-gray-500">Total cost</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">By Type</p>
                {Object.entries(insights.by_type||{}).map(([t,c]) => (
                  <div key={t} className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-600 dark:text-gray-300">{TYPE_ICONS[t]||'📦'} {t}</span>
                    <span className="text-xs font-medium text-gray-800 dark:text-white">{c}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">By Status</p>
                {Object.entries(insights.by_status||{}).map(([s,c]) => (
                  <div key={s} className="flex items-center justify-between mb-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusColor(s)}`}>{s}</span>
                    <span className="text-xs font-medium text-gray-800 dark:text-white">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Search + Filters */}
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                   placeholder="Search by name, serial, vendor, tag..." className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All types</option>
            {ASSET_TYPES.map(t => <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                  className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <option value="">All statuses</option>
            {ASSET_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Bulk actions bar */}
        {selected.size > 0 && isAdmin && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-lg">
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selected.size} selected</span>
            <select value={bulkAction} onChange={e => setBulkAction(e.target.value)}
                    className="border border-indigo-300 dark:border-indigo-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300">
              <option value="">Select action...</option>
              <option value="retire">Retire</option>
              <option value="maintenance">Set to Maintenance</option>
              <option value="available">Mark Available</option>
            </select>
            <button onClick={handleBulkAction} disabled={!bulkAction || applyingBulk}
                    className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 transition">
              {applyingBulk ? 'Applying...' : 'Apply'}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Clear</button>
          </div>
        )}

        {/* Asset table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>
        ) : assets.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-12 text-center">
            <p className="text-4xl mb-4">📦</p>
            <p className="text-gray-500 dark:text-gray-400">{t('asset.noAssets')}</p>
            {isAdmin && <Link to="/assets/new" className="mt-4 inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Add first asset</Link>}
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    {isAdmin && <th className="px-4 py-3 w-8"><input type="checkbox" onChange={e => e.target.checked ? setSelected(new Set(assets.map(a=>a.id))) : setSelected(new Set())} /></th>}
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Asset</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Assigned To</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Location</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expiry</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tickets</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {assets.map(asset => (
                    <tr key={asset.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition ${selected.has(asset.id) ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                      {isAdmin && (
                        <td className="px-4 py-3">
                          <input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleSelect(asset.id)} />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <Link to={`/assets/${asset.id}`} className="flex items-center gap-2 group">
                          <span className="text-lg">{TYPE_ICONS[asset.type] || '📦'}</span>
                          <div>
                            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 group-hover:underline">{asset.name}</p>
                            <p className="text-xs text-gray-400">{asset.serial_number || asset.tag_number || ''}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-600 dark:text-gray-300 capitalize">{asset.type}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(asset.status)}`}>
                          {asset.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {asset.assigned_to_name || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {asset.location || '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {asset.expiry_date ? (
                          <span className={isExpiringSoon(asset.expiry_date) ? 'text-red-500 font-medium' : 'text-gray-600 dark:text-gray-300'}>
                            {isExpiringSoon(asset.expiry_date) && '⚠️ '}{new Date(asset.expiry_date).toLocaleDateString()}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 text-center">
                        {asset.ticket_count > 0 ? (
                          <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded-full">{asset.ticket_count}</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700 px-4">
              <Pagination total={total} page={page} limit={LIMIT} onPageChange={p => setPage(p)} />
            </div>
          </div>
        )}

        {/* CSV import template hint */}
        {isAdmin && (
          <p className="text-xs text-gray-400 mt-3 text-center">
            CSV import format: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">name, type, serial_number, vendor, location, status, purchase_cost, tag_number, notes</code>
          </p>
        )}
      </div>
    </Layout>
  );
}
