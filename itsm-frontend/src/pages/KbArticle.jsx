import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import MDEditor from '@uiw/react-md-editor';

const STATUS_STYLES = {
  published: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  draft:     'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

export default function KbArticle() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [article, setArticle] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', category: '', status: 'published', change_note: '' });
  const [saving, setSaving] = useState(false);

  // Version history
  const [versions, setVersions] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const isAgentOrAdmin = ['agent','admin','super_admin'].includes(user?.role);

  const fetchArticle = async () => {
    try {
      const data = await apiFetch(`/kb/articles/${id}`, token);
      setArticle(data);
      setForm({ title: data.title, content: data.content, category: data.category || '', status: data.status || 'published', change_note: '' });
    } catch (err) { toast.error(err.message); }
  };

  const fetchVersions = async () => {
    setLoadingVersions(true);
    try {
      const data = await apiFetch(`/kb/articles/${id}/versions`, token);
      setVersions(Array.isArray(data) ? data : []);
    } catch { setVersions([]); }
    finally { setLoadingVersions(false); }
  };

  useEffect(() => { fetchArticle(); }, [id, token]);

  const handleDelete = async () => {
    if (!confirm(t('kb.deleteConfirmation'))) return;
    try {
      await apiFetch(`/kb/articles/${id}`, token, { method: 'DELETE' });
      navigate('/kb');
    } catch (err) { toast.error(err.message); }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch(`/kb/articles/${id}`, token, { method: 'PUT', body: JSON.stringify(form) });
      toast.success(`Article updated — v${(article.version || 1) + 1}`);
      setEditing(false);
      fetchArticle();
      if (showVersions) fetchVersions();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleRestore = async (version) => {
    if (!confirm(`Restore to version ${version.version_number}? Current content will be saved as a new version.`)) return;
    setRestoring(true);
    try {
      await apiFetch(`/kb/articles/${id}/restore/${version.id}`, token, { method: 'POST' });
      toast.success(`Restored to v${version.version_number}`);
      setPreviewVersion(null);
      fetchArticle();
      fetchVersions();
    } catch (err) { toast.error(err.message); }
    finally { setRestoring(false); }
  };

  const toggleVersions = () => {
    if (!showVersions) fetchVersions();
    setShowVersions(v => !v);
    setPreviewVersion(null);
  };

  if (!article) return <Layout><div className="p-10 text-center text-gray-400">{t('common.loading')}</div></Layout>;

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition";
  const btnDanger  = "bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 transition";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  const displayArticle = previewVersion || article;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Link to="/kb" className="hover:text-indigo-500">Knowledge Base</Link>
          <span>/</span>
          <span className="text-gray-700 dark:text-gray-300 font-medium">{article.title}</span>
        </div>

        {/* Version preview banner */}
        {previewVersion && (
          <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg px-4 py-2.5">
            <span className="text-amber-700 dark:text-amber-300 text-sm font-medium">
              👁️ Previewing v{previewVersion.version_number} — {new Date(previewVersion.created_at).toLocaleString()}
            </span>
            <button onClick={() => handleRestore(previewVersion)} disabled={restoring}
                    className="ml-auto text-xs bg-amber-600 text-white px-3 py-1 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition">
              {restoring ? 'Restoring...' : '↩ Restore this version'}
            </button>
            <button onClick={() => setPreviewVersion(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕ Exit preview</button>
          </div>
        )}

        <div className={cardClass}>
          {!editing ? (
            <>
              {/* Article header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{displayArticle.title}</h2>
                    <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${STATUS_STYLES[article.status] || STATUS_STYLES.published}`}>
                      {article.status === 'draft' ? '📝 Draft' : '✅ Published'}
                    </span>
                    <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded">
                      v{previewVersion ? previewVersion.version_number : article.version || 1}
                    </span>
                    {article.view_count > 0 && (
                      <span className="text-xs text-gray-400">👁️ {article.view_count} views</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {displayArticle.category || t('common.general')} · {t('common.by')} {article.author_name} · {t('common.updated')} {new Date(article.updated_at || article.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {/* Content */}
              <div data-color-mode="light" className="mb-6 min-h-[120px]">
                <MDEditor.Markdown source={displayArticle.content} style={{ background: 'transparent', color: 'inherit' }} />
              </div>

              {/* Agent/admin actions */}
              {isAgentOrAdmin && !previewVersion && (
                <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <button onClick={() => setEditing(true)} className={btnPrimary}>{t('common.edit')}</button>
                  <button onClick={toggleVersions}
                          className={`text-sm px-4 py-2 rounded-lg border transition ${showVersions ? 'border-indigo-400 text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    🕐 Version History {versions.length > 0 ? `(${versions.length})` : ''}
                  </button>
                  <button onClick={handleDelete} className={btnDanger + " ml-auto"}>{t('common.delete')}</button>
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">{t('kb.editArticle')}</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kb.articleTitle')} *</label>
                    <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kb.articleCategory')}</label>
                    <input type="text" value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
                  <div className="flex gap-3">
                    {['draft','published'].map(s => (
                      <label key={s} className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition ${form.status === s ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
                        <input type="radio" value={s} checked={form.status === s} onChange={() => setForm({...form, status: s})} className="sr-only" />
                        <span className="text-sm font-medium capitalize text-gray-700 dark:text-gray-300">
                          {s === 'draft' ? '📝 Draft' : '✅ Published'}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Drafts are only visible to agents and admins</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('kb.articleContent')}</label>
                  <div data-color-mode="light">
                    <MDEditor value={form.content} onChange={val => setForm({...form, content: val || ''})} height={400} preview="live" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Change Note <span className="text-gray-400 font-normal">(optional)</span></label>
                  <input type="text" value={form.change_note} onChange={e => setForm({...form, change_note: e.target.value})}
                         placeholder="What did you change? e.g. Updated with new procedure" className={inputClass} />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSave} disabled={saving} className={btnPrimary + " disabled:opacity-50"}>
                  {saving ? 'Saving...' : `${t('common.save')} (creates v${(article.version || 1) + 1})`}
                </button>
                <button onClick={() => { setEditing(false); setForm({ title: article.title, content: article.content, category: article.category || '', status: article.status || 'published', change_note: '' }); }} className={btnSecondary}>{t('common.cancel')}</button>
              </div>
            </>
          )}
        </div>

        {/* Version History Panel */}
        {showVersions && (
          <div className={cardClass}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">🕐 Version History</h3>
            {loadingVersions ? (
              <p className="text-sm text-gray-400">{t('common.loading')}</p>
            ) : versions.length === 0 ? (
              <p className="text-sm text-gray-400 italic">No version history yet. Edit and save the article to create versions.</p>
            ) : (
              <div className="space-y-2">
                {versions.map((v, idx) => (
                  <div key={v.id} className={`flex items-start gap-4 p-3 rounded-lg border transition ${previewVersion?.id === v.id ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <div className="flex-shrink-0 text-center">
                      <span className="text-xs font-bold font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-2 py-0.5 rounded">v{v.version_number}</span>
                      {idx === 0 && <p className="text-xs text-green-500 mt-0.5">current</p>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{v.title}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-400">{new Date(v.created_at).toLocaleString()}</span>
                        <span className="text-xs text-gray-400">by {v.edited_by}</span>
                        {v.status && <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_STYLES[v.status] || ''}`}>{v.status}</span>}
                      </div>
                      {v.change_note && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic">"{v.change_note}"</p>}
                    </div>
                    {idx !== 0 && (
                      <div className="flex gap-2 flex-shrink-0">
                        <button onClick={() => setPreviewVersion(previewVersion?.id === v.id ? null : v)}
                                className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 px-2 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition">
                          {previewVersion?.id === v.id ? 'Exit' : 'Preview'}
                        </button>
                        <button onClick={() => handleRestore(v)} disabled={restoring}
                                className="text-xs text-amber-600 hover:text-amber-800 border border-amber-200 dark:border-amber-700 px-2 py-1 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition disabled:opacity-50">
                          Restore
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Help text */}
        {!editing && !previewVersion && (
          <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
            {t('kb.helpText')} <Link to="/create-ticket" className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('kb.submitTicket')}</Link>.
          </div>
        )}
      </div>
    </Layout>
  );
}
