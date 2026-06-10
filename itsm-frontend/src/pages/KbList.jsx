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

export default function KbList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [articles, setArticles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchArticles = (searchTerm = '', p = 1) => {
    const params = new URLSearchParams({ skip: (p - 1) * LIMIT, limit: LIMIT });
    if (searchTerm) params.append('search', searchTerm);
    fetch(`${API}/kb/articles/?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => { setArticles(data.items ?? []); setTotal(data.total ?? 0); })
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setPage(1);
    if (search.length === 1) return;
    const timer = setTimeout(() => fetchArticles(search, 1), search ? 400 : 0);
    return () => clearTimeout(timer);
  }, [token, search]);

  const handlePageChange = (p) => { setPage(p); fetchArticles(search, p); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: "var(--text-primary)"}}>{t('kb.title')}</h2>
          {(user?.role === 'agent' || user?.role === 'admin') && (
            <Link to="/kb/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition">
              {t('kb.newArticle')}
            </Link>
          )}
        </div>

        <div className="mb-6 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input type="text" placeholder={t('kb.searchPlaceholder')} value={search}
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
        ) : articles.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('kb.noArticles')}</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {articles.map(article => (
                <Link to={`/kb/${article.id}`} key={article.id}
                      className="block bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition">
                  <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-1">{article.title}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    {article.category || t('common.general')} · {new Date(article.updated_at || article.created_at).toLocaleDateString()}
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
