import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../utils/apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import { API } from '../api';

const LIMIT = 20;

export default function CannedResponses() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [responses, setResponses] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ title: '', content: '', category: '' });
  const [error, setError] = useState('');

  const fetchResponses = (p = 1, q = '') => {
    setLoading(true);
    const params = new URLSearchParams({ skip: (p - 1) * LIMIT, limit: LIMIT });
    if (q && q.length >= 2) params.append('search', q);
    fetch(`${API}/canned-responses/?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setResponses(data.items ?? []); setTotal(data.total ?? 0); })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (search.length === 1) return;
    const timer = setTimeout(() => {
      setPage(1);
      fetchResponses(1, search);
    }, search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [token, search]);

  const handlePageChange = (p) => { setPage(p); fetchResponses(p, search); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await fetch(`${API}/canned-responses/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      setShowCreate(false);
      setForm({ title: '', content: '', category: '' });
      fetchResponses(page, search);
    } catch (err) { toast.error(err.message); }
  };

  const handleUpdate = async (id) => {
    await fetch(`${API}/canned-responses/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(form),
    });
    setEditingId(null);
    fetchResponses(page, search);
  };

  const handleDelete = async (id) => {
    if (!confirm(t('common.confirmDelete'))) return;
    await fetch(`${API}/canned-responses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    fetchResponses(page, search);
  };

  const startEdit = (r) => { setEditingId(r.id); setForm({ title: r.title, content: r.content, category: r.category || '' }); };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('common.cannedResponses')}</h2>
          <button onClick={() => setShowCreate(true)} className={btnPrimary}>{t('common.new')}</button>
        </div>

        {(showCreate || editingId) && (
          <div className={`${cardClass} mb-6`}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{editingId ? t('common.edit') : t('common.create')}</h3>
            <form onSubmit={(e) => { e.preventDefault(); editingId ? handleUpdate(editingId) : handleCreate(e); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.title')}</label>
                <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.category')}</label>
                <input type="text" value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.content')}</label>
                <textarea rows={5} value={form.content} onChange={e => setForm({...form, content: e.target.value})} required className={inputClass} />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" className={btnPrimary}>{editingId ? t('common.update') : t('common.create')}</button>
                <button type="button" onClick={() => { setShowCreate(false); setEditingId(null); setForm({ title: '', content: '', category: '' }); }} className={btnSecondary}>{t('common.cancel')}</button>
              </div>
            </form>
          </div>
        )}
        <div className="mb-6 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder="Search canned responses..." value={search}
                 onChange={e => { setSearch(e.target.value); setPage(1); }}
                 className="w-full pl-10 pr-8 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          {search && (
            <button onClick={() => { setSearch(''); setPage(1); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
          )}
        </div>


        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.title')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.category')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.content')}</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {responses.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300">{r.title}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{r.category || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 truncate max-w-xs">{r.content.substring(0, 80)}</td>
                    <td className="px-6 py-4 text-sm space-x-2">
                      <button onClick={() => startEdit(r)} className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('common.edit')}</button>
                      <button onClick={() => handleDelete(r.id)} className="text-red-600 dark:text-red-400 hover:underline">{t('common.delete')}</button>
                    </td>
                  </tr>
                ))}
                {responses.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-10 text-gray-500 dark:text-gray-400">{t('common.noData')}</td></tr>
                )}
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
