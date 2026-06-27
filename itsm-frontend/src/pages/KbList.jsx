import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';
import { API } from '../api';

const LIMIT = 20;

export default function KbList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [articles, setArticles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  const fetchArticles = (searchTerm = '', p = 1, status = statusFilter) => {
    const params = new URLSearchParams({ skip: (p - 1) * LIMIT, limit: LIMIT });
    if (searchTerm) params.append('search', searchTerm);
    if (status) params.append('status', status);
    fetch(`${API}/kb/articles/?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setArticles(data.items ?? []); setTotal(data.total ?? 0); })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchArticles('', 1, statusFilter); }, [token, statusFilter]);

  const handleSearch = (e) => { e.preventDefault(); setPage(1); fetchArticles(search, 1); };
  const handlePageChange = (p) => { setPage(p); fetchArticles(search, p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('kb.title')}</h2>
          {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && (
            <Link to="/kb/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition">
              {t('kb.newArticle')}
            </Link>
          )}
        </div>

        <form onSubmit={handleSearch} className="mb-6 flex gap-2">
          <input type="text" placeholder={t('kb.searchPlaceholder')} value={search}
                 onChange={e => setSearch(e.target.value)}
                 className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button type="submit" className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition">
            {t('common.search')}
          </button>
        </form>

        {/* Status filter — agents/admins only */}
        {isAgentOrAdmin && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {[['', 'All'], ['published', '✅ Published'], ['draft', '📝 Drafts']].map(([val, label]) => (
              <button key={val} onClick={() => { setStatusFilter(val); setPage(1); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${statusFilter === val ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : articles.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('kb.noArticles')}</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {articles.map(article => (
                <Link to={`/kb/${article.id}`} key={article.id}
                      className="block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-indigo-600 dark:text-indigo-400">{article.title}</h3>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isAgentOrAdmin && article.status === 'draft' && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-medium">Draft</span>
                      )}
                      {article.version > 1 && (
                        <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">v{article.version}</span>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    {article.category || t('common.general')} · {new Date(article.updated_at || article.created_at).toLocaleDateString()}
                    {article.view_count > 0 && ` · 👁️ ${article.view_count}`}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{article.content.substring(0, 120)}...</p>
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <Pagination total={total} page={page} limit={LIMIT} onPageChange={handlePageChange} />
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
