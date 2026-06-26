import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { API } from '../api';

export const TICKET_CATEGORIES = [
  'Hardware', 'Software', 'Network', 'Account', 'Email',
  'Security', 'Printer', 'Mobile Device', 'Cloud Services',
  'Telephony', 'Other'
];

export default function CreateTicket() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultType = searchParams.get('type') === 'service_request' ? 'service_request' : 'incident';
  const catalogItemId = searchParams.get('catalog_item');

  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [userList, setUserList] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('medium');
  const [ticketType, setTicketType] = useState(defaultType);
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState('');

  // Fetch catalog items for template picker
  useEffect(() => {
    apiFetch('/catalog/', token)
      .then(data => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
    // Fetch all users for "on behalf of" dropdown (agents/admins only)
    if (user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) {
      apiFetch('/users/', token)
        .then(data => setUserList(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [token]);

  // Apply selected catalog item as template
  const applyTemplate = (templateId) => {
    setSelectedTemplate(templateId);
    if (!templateId) return;
    const tpl = templates.find(t => t.id === parseInt(templateId));
    if (tpl) {
      setTitle(tpl.ticket_title || tpl.name);
      setDescription(tpl.ticket_description || tpl.description || '');
      setCategory(tpl.category || '');
      setPriority(tpl.priority || 'medium');
      setTicketType(tpl.ticket_type || 'service_request');
    }
  };

  useEffect(() => {
    if (!catalogItemId) return;
    fetch(`${API}/catalog/${catalogItemId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        if (data && data.name) {
          setTitle(data.name);
          setDescription(data.description || '');
          setCategory(data.category || '');
          setTicketType('service_request');
        }
      })
      .catch(console.error);
  }, [catalogItemId, token]);

  const handleFileChange = (e) => { const newFiles = Array.from(e.target.files); setFiles(prev => [...prev, ...newFiles]); e.target.value = null; };
  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e) => { e.preventDefault(); setDragOver(false); setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]); };
  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!category) {
      toast.error('Please select a category.');
      return;
    }
    setSubmitting(true);
    try {
      const body = { title, description, priority, ticket_type: ticketType, category, tags };
      if (onBehalfOf) body.on_behalf_of_id = parseInt(onBehalfOf);
      const res = await fetch(`${API}/tickets/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Failed'); }
      const ticket = await res.json();

      let failedFiles = [];
      if (files.length > 0) {
        for (const file of files) {
          const formData = new FormData();
          formData.append('file', file);
          const uploadRes = await fetch(`${API}/tickets/${ticket.id}/attachments`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData,
          });
          if (!uploadRes.ok) {
            const errorData = await uploadRes.json();
            failedFiles.push(`${file.name}: ${errorData.detail || 'Upload failed'}`);
          }
        }
      }
      if (failedFiles.length > 0) {
        toast.error('Some files failed to upload: ' + failedFiles.join(', '));
        setSubmitting(false);
        return;
      }
      navigate('/');
    } catch (err) { toast.error(err.message || 'Failed to create ticket.'); setSubmitting(false); }
  };

  const inputClass = "w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm";
  const selectClass = "w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm";
  const cardClass = "bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('common.newTicket')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('ticket.incidentExplanation')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <form onSubmit={handleSubmit}>
              <div className={`${cardClass} space-y-6`}>
                {/* Service Catalog picker */}
                {templates.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      📋 Quick start from Service Catalog
                    </label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {templates.map(tpl => (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => applyTemplate(tpl.id)}
                          className={`text-left px-4 py-3 rounded-lg border-2 transition text-sm ${
                            selectedTemplate === tpl.id
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                              : 'border-gray-200 dark:border-gray-600 hover:border-indigo-300 dark:hover:border-indigo-600 bg-white dark:bg-gray-700'
                          }`}
                        >
                          <p className="font-medium text-gray-800 dark:text-white">{tpl.name}</p>
                          {tpl.description && <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 truncate">{tpl.description}</p>}
                          {tpl.estimated_cost && <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-1">${tpl.estimated_cost}{tpl.delivery_time_days ? ` · ${tpl.delivery_time_days} days` : ''}</p>}
                        </button>
                      ))}
                    </div>
                    {selectedTemplate && (
                      <button type="button" onClick={() => { setSelectedTemplate(''); setTitle(''); setDescription(''); setCategory(''); setPriority('medium'); }}
                              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 mt-2">
                        ✕ Clear selection
                      </button>
                    )}
                    <hr className="border-gray-200 dark:border-gray-700 mt-4" />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('ticket.type')}</label>
                  <div className="flex rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
                    <button type="button" onClick={() => setTicketType('incident')}
                            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${ticketType === 'incident' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                      🚨 {t('ticket.incidentTab')}
                    </button>
                    <button type="button" onClick={() => setTicketType('service_request')}
                            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${ticketType === 'service_request' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                      📋 {t('ticket.serviceRequestTab')}
                    </button>
                  </div>
                </div>

                {/* On behalf of — agents/admins only */}
                {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && (
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                    <label className="block text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">
                      👤 {t('ticket.logOnBehalfOf') || 'Log on behalf of'}
                    </label>
                    <select value={onBehalfOf} onChange={e => setOnBehalfOf(e.target.value)}
                            className={inputClass}>
                      <option value="">{t('ticket.myself') || 'Myself'} ({user?.full_name})</option>
                      {['admin', 'agent', 'employee'].map(role => {
                        const group = userList.filter(u => u.id !== user?.id && u.role === role);
                        if (!group.length) return null;
                        return (
                          <optgroup key={role} label={role.charAt(0).toUpperCase() + role.slice(1) + 's'}>
                            {group.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
                          </optgroup>
                        );
                      })}
                    </select>
                    <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">{t('ticket.onBehalfHint') || 'Select a user to log this ticket on their behalf.'}</p>
                  </div>
                )}

                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ticket.title')} <span className="text-red-500">*</span></label><input type="text" value={title} onChange={e => setTitle(e.target.value)} required className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ticket.description')} <span className="text-red-500">*</span></label><textarea value={description} onChange={e => setDescription(e.target.value)} required rows={6} className={`${inputClass} resize-none`} /></div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ticket.category')} <span className="text-red-500">*</span></label>
                    <select value={category} onChange={e => setCategory(e.target.value)} required className={inputClass}>
                      <option value="">— Select Category —</option>
                      {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('ticket.priority')}</label><select value={priority} onChange={e => setPriority(e.target.value)} className={selectClass}><option value="low">{t('ticket.low')}</option><option value="medium">{t('ticket.medium')}</option><option value="high">{t('ticket.high')}</option><option value="critical">{t('ticket.critical')}</option></select></div>
                </div>

                {/* Tags */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tags <span className="text-gray-400 font-normal">(optional)</span></label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
                        #{tag}
                        <button type="button" onClick={() => setTags(tags.filter(t => t !== tag))} className="hover:text-red-500 ml-0.5">✕</button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                          e.preventDefault();
                          const newTag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
                          if (newTag && !tags.includes(newTag)) setTags([...tags, newTag]);
                          setTagInput('');
                        }
                      }}
                      placeholder="Type a tag and press Enter..."
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button type="button" onClick={() => {
                      const newTag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '');
                      if (newTag && !tags.includes(newTag)) setTags([...tags, newTag]);
                      setTagInput('');
                    }} className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition">Add</button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Press Enter or comma to add a tag</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('ticket.attachments')}</label>
                  <div className={`border-2 border-dashed rounded-xl p-6 text-center transition ${dragOver ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/30' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'}`}
                       onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
                    <svg className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                      <label className="relative cursor-pointer rounded-md font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-500">
                        <span>{t('ticket.uploadFiles')}</span>
                        <input type="file" multiple onChange={handleFileChange} accept=".txt,.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.zip,.pptx" className="sr-only" />
                      </label> {t('ticket.dragDrop')}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('ticket.fileTypes')}</p>
                  </div>
                  {files.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {files.map((f, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-2">
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                            <span className="text-sm text-gray-700 dark:text-gray-300">{f.name}</span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">({formatFileSize(f.size)})</span>
                          </div>
                          <button type="button" onClick={() => removeFile(idx)} className="text-red-400 hover:text-red-600 dark:hover:text-red-300 transition"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                      ))}
                    </div>
                  )}

                </div>

                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-gray-700">
                  <Link to="/" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">← {t('common.cancel')}</Link>
                  <button type="submit" disabled={submitting} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:opacity-50 transition">
                    {submitting ? t('ticket.uploading') : t('ticket.submitTicket')}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="space-y-6">
            <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-indigo-800 dark:text-indigo-300 mb-2">💡 {t('ticket.beforeSubmit')}</h3>
              <p className="text-sm text-indigo-700 dark:text-indigo-400">{t('ticket.checkKB')} <Link to="/kb" className="underline font-medium">{t('common.knowledgeBase')}</Link>.</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4">
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t('ticket.goodToKnow')}</h3>
              <ul className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <li className="flex gap-2"><span className="text-green-500 mt-0.5">✓</span><span>{t('ticket.incidentExplanation')}</span></li>
                <li className="flex gap-2"><span className="text-green-500 mt-0.5">✓</span><span>{t('ticket.serviceRequestExplanation')}</span></li>
                <li className="flex gap-2"><span className="text-green-500 mt-0.5">✓</span><span>{t('ticket.attachScreenshots')}</span></li>
                <li className="flex gap-2"><span className="text-green-500 mt-0.5">✓</span><span>{t('ticket.criticalWarning')}</span></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}