import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import { API } from '../api';
import Layout from '../components/Layout';
import Pagination from '../components/Pagination';

const LIMIT = 20;

export default function KbList() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  const [articles, setArticles]         = useState([]);
  const [total, setTotal]               = useState(0);
  const [page, setPage]                 = useState(1);
  const [search, setSearch]             = useState('');
  const [loading, setLoading]           = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [tagFilter, setTagFilter]       = useState('');
  const [categories, setCategories]     = useState([]); // [{category, folders:[]}]
  const [insights, setInsights]         = useState(null);
  const [showInsights, setShowInsights] = useState(false);

  const fetchArticles = async (s = search, p = page, status = statusFilter, cat = categoryFilter, folder = folderFilter, tag = tagFilter) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: (p-1)*LIMIT, limit: LIMIT });
      if (s) params.append('search', s);
      if (status) params.append('status', status);
      if (cat) params.append('category', cat);
      if (folder) params.append('folder', folder);
      if (tag) params.append('tag', tag);
      const data = await apiFetch(`/kb/articles/?${params}`, token);
      setArticles(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch(e) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  const fetchCategories = async () => {
    try { setCategories(await apiFetch('/kb/categories', token)); } catch {}
  };

  const fetchInsights = async () => {
    try { setInsights(await apiFetch('/kb/insights', token)); } catch {}
  };

  useEffect(() => { fetchArticles('', 1); fetchCategories(); }, [token]);
  useEffect(() => {
    const timer = setTimeout(() => { setPage(1); fetchArticles(search, 1); }, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, statusFilter, categoryFilter, folderFilter, tagFilter]);

  const handlePageChange = (p) => { setPage(p); fetchArticles(search, p); };

  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700";

  // Compute reading time
  const readingTime = (content) => {
    const words = (content || '').split(/\s+/).length;
    const mins = Math.max(1, Math.round(words / 200));
    return `${mins} min read`;
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{t('common.knowledgeBase')}</h2>
          <div className="flex gap-2">
            {isAgentOrAdmin && (
              <button onClick={() => { setShowInsights(!showInsights); if (!insights) fetchInsights(); }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${showInsights ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-400'}`}>
                📊 Insights
              </button>
            )}
            {isAgentOrAdmin && (
              <Link to="/kb/new" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">
                + {t('kb.newArticle')}
              </Link>
            )}
          </div>
        </div>

        <div className="flex gap-6">
          {/* Left sidebar — category navigation */}
          <div className="w-52 flex-shrink-0 space-y-1">
            <button onClick={() => { setCategoryFilter(''); setFolderFilter(''); }}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${!categoryFilter ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              📚 {t('common.all') || 'All articles'}
            </button>
            {categories.map(({ category, folders }) => (
              <div key={category}>
                <button onClick={() => { setCategoryFilter(category); setFolderFilter(''); }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition ${categoryFilter===category && !folderFilter ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  📁 {category}
                </button>
                {categoryFilter === category && folders.map(folder => (
                  <button key={folder} onClick={() => setFolderFilter(folderFilter===folder ? '' : folder)}
                          className={`w-full text-left pl-7 pr-3 py-1.5 rounded-lg text-xs transition ${folderFilter===folder ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
                    └ {folder}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            {/* Insights panel */}
            {showInsights && insights && (
              <div className={card + " p-5 mb-6"}>
                <h3 className="font-semibold text-gray-800 dark:text-white mb-4">📊 KB Insights</h3>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="text-center p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
                    <p className="text-2xl font-bold text-indigo-600">{insights.total_articles}</p>
                    <p className="text-xs text-gray-500">Total articles</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">{insights.total_views}</p>
                    <p className="text-xs text-gray-500">Total views</p>
                  </div>
                  <div className="text-center p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                    <p className="text-2xl font-bold text-amber-600">{insights.needs_review?.length || 0}</p>
                    <p className="text-xs text-gray-500">Need review</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">🔥 Most viewed</p>
                    {insights.most_viewed?.map(a => (
                      <Link key={a.id} to={`/kb/${a.id}`} className="block text-xs text-indigo-600 hover:underline mb-1 truncate">
                        {a.title} <span className="text-gray-400">({a.view_count} views)</span>
                      </Link>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-2">👎 Least helpful</p>
                    {insights.least_helpful?.length === 0 && <p className="text-xs text-gray-400 italic">None yet</p>}
                    {insights.least_helpful?.map(a => (
                      <Link key={a.id} to={`/kb/${a.id}`} className="block text-xs text-red-500 hover:underline mb-1 truncate">
                        {a.title} <span className="text-gray-400">({a.not_helpful_count} 👎)</span>
                      </Link>
                    ))}
                  </div>
                </div>
                {insights.needs_review?.length > 0 && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1">⚠️ Articles due for review</p>
                    {insights.needs_review.map(a => (
                      <Link key={a.id} to={`/kb/${a.id}`} className="block text-xs text-amber-600 hover:underline mb-0.5">{a.title}</Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Search + filters */}
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <svg className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                       placeholder={t('common.searchArticles') || 'Search articles...'}
                       className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {isAgentOrAdmin && (
                <div className="flex gap-2">
                  {[['', 'All'], ['published', '✅ Published'], ['draft', '📝 Drafts']].map(([val, label]) => (
                    <button key={val} onClick={() => setStatusFilter(val)}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition ${statusFilter===val ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tag filter chips */}
            {tagFilter && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-500">Tag:</span>
                <span className="inline-flex items-center gap-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded-full text-xs font-medium">
                  #{tagFilter}
                  <button onClick={() => setTagFilter('')} className="hover:text-red-500">✕</button>
                </span>
              </div>
            )}

            {loading ? (
              <p className="text-center text-gray-400 py-10">{t('common.loading')}</p>
            ) : articles.length === 0 ? (
              <div className={card + " p-10 text-center"}>
                <p className="text-gray-400 text-sm">{t('kb.noArticles')}</p>
                {(search || categoryFilter || tagFilter) && (
                  <button onClick={() => { setSearch(''); setCategoryFilter(''); setFolderFilter(''); setTagFilter(''); }}
                          className="mt-2 text-indigo-500 hover:underline text-sm">Clear filters</button>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {articles.map(article => (
                    <Link to={`/kb/${article.id}`} key={article.id}
                          className={card + " block p-5 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-700 transition"}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">{article.title}</h3>
                            {isAgentOrAdmin && article.status === 'draft' && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 font-medium">Draft</span>
                            )}
                            {article.version > 1 && (
                              <span className="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">v{article.version}</span>
                            )}
                            {article.review_date && new Date(article.review_date) < new Date() && (
                              <span className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">⚠️ Review needed</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400 mb-2">
                            <span>{article.category || 'General'}{article.folder ? ` › ${article.folder}` : ''}</span>
                            <span>·</span>
                            <span>{new Date(article.updated_at || article.created_at).toLocaleDateString()}</span>
                            <span>·</span>
                            <span>{readingTime(article.content)}</span>
                            {article.view_count > 0 && <><span>·</span><span>👁️ {article.view_count}</span></>}
                            {(article.helpful_count > 0 || article.not_helpful_count > 0) && (
                              <><span>·</span><span>👍 {article.helpful_count} 👎 {article.not_helpful_count}</span></>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{article.content.replace(/[#*`]/g, '').substring(0, 150)}...</p>
                          {/* Tags */}
                          {article.tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {article.tags.map(tag => (
                                <button key={tag} type="button"
                                        onClick={e => { e.preventDefault(); setTagFilter(tag); }}
                                        className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-indigo-100 hover:text-indigo-600 transition">
                                  #{tag}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
                <div className="mt-4">
                  <Pagination total={total} page={page} limit={LIMIT} onPageChange={handlePageChange} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
