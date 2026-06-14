import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import MDEditor from '@uiw/react-md-editor';

export default function KbArticle() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', category: '' });

  const fetchArticle = async () => {
    try {
      const data = await apiFetch(`/kb/articles/${id}`, token);
      setArticle(data);
      setForm({ title: data.title, content: data.content, category: data.category || '' });
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => { fetchArticle(); }, [id, token]);

  const handleDelete = async () => {
    if (!confirm(t('kb.deleteConfirmation'))) return;
    try {
      await apiFetch(`/kb/articles/${id}`, token, { method: 'DELETE' });
      navigate('/kb');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSave = async () => {
    try {
      await apiFetch(`/kb/articles/${id}`, token, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      toast.success('Article updated.');
      setEditing(false);
      fetchArticle();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (!article) return <Layout><div className="p-10 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div></Layout>;

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition";
  const btnDanger = "bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className={cardClass}>
          {!editing ? (
            <>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-1" style={{color: "var(--text-primary)"}}>{article.title}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                {article.category || t('common.general')} · {t('common.by')} {article.author_name} · {t('common.updated')} {new Date(article.updated_at || article.created_at).toLocaleDateString()}
              </p>

              {/* Render markdown content */}
              <div data-color-mode="light" className="mb-6">
                <MDEditor.Markdown
                  source={article.content}
                  style={{ background: 'transparent', color: 'inherit' }}
                />
              </div>

              {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && (
                <div className="flex gap-2 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <button onClick={() => setEditing(true)} className={btnPrimary}>{t('common.edit')}</button>
                  <button onClick={handleDelete} className={btnDanger}>{t('common.delete')}</button>
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">{t('kb.editArticle')}</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kb.articleTitle')}</label>
                  <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kb.articleCategory')}</label>
                  <input type="text" value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('kb.articleContent')}</label>
                  <div data-color-mode="light">
                    <MDEditor
                      value={form.content}
                      onChange={val => setForm({...form, content: val || ''})}
                      height={400}
                      preview="live"
                    />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSave} className={btnPrimary}>{t('common.save')}</button>
                <button onClick={() => { setEditing(false); setForm({ title: article.title, content: article.content, category: article.category || '' }); }} className={btnSecondary}>{t('common.cancel')}</button>
              </div>
            </>
          )}

          <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm text-gray-600 dark:text-gray-300">
            {t('kb.helpText')} <Link to="/create-ticket" className="text-indigo-600 dark:text-indigo-400 hover:underline">{t('kb.submitTicket')}</Link>.
          </div>
        </div>
      </div>
    </Layout>
  );
}
