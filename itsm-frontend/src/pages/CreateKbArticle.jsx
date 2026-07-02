import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import MDEditor from '@uiw/react-md-editor';
import { TICKET_CATEGORIES } from './CreateTicket';
import CustomFieldsRenderer from '../components/CustomFieldsRenderer';

export default function CreateKbArticle() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', content: '', category: '' });
  const [submitting, setSubmitting] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [customFields, setCustomFields] = useState([]);
  const [customFieldValues, setCustomFieldValues] = useState({});

  useEffect(() => {
    apiFetch('/admin/custom-fields?applies_to=kb_article', token)
      .then(d => setCustomFields(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.category) { setCategoryError('Please select a category'); toast.error('Category is required'); return; }
    if (!form.content?.trim()) { toast.error('Please add some content to the article.'); return; }
    setSubmitting(true);
    try {
      await apiFetch('/kb/articles/', token, {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          custom_fields_data: Object.keys(customFieldValues).length ? customFieldValues : null,
        }),
      });
      toast.success(t('kb.articleCreated') || 'Article created.');
      navigate('/kb');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const btnPrimary = "bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium disabled:opacity-50";
  const btnSecondary = "text-gray-600 dark:text-gray-300 hover:underline py-2";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className={cardClass}>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4" style={{color: "var(--text-primary)"}}>{t('kb.createArticle')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kb.articleTitle')}</label>
              <input type="text" value={form.title} onChange={e => setForm({...form, title: e.target.value})} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('kb.articleCategory')} <span className="text-red-500">*</span></label>
              <select value={form.category}
                      onChange={e => { setForm({...form, category: e.target.value}); setCategoryError(''); }}
                      required
                      className={`${inputClass} ${categoryError ? 'border-red-400 dark:border-red-500' : ''}`}>
                <option value="">— Select Category —</option>
                {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {categoryError && <p className="text-red-500 text-xs mt-1">{categoryError}</p>}
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
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Supports Markdown — **bold**, *italic*, # headings, - lists, `code`, etc.</p>
            </div>

            {customFields.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Additional Fields</p>
                <CustomFieldsRenderer
                  fields={customFields}
                  values={customFieldValues}
                  onChange={(key, val) => setCustomFieldValues(prev => ({...prev, [key]: val}))}
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={submitting} className={btnPrimary}>
                {submitting ? t('common.loading') : t('common.create')}
              </button>
              <button type="button" onClick={() => navigate('/kb')} className={btnSecondary}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
