import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

const CATEGORIES = ['Hardware','Software','Network','Account','Email','Security','Printer','Mobile Device','Cloud Services','Telephony','Other'];

export default function TicketTemplatesTab() {
  const { t } = useTranslation();
  const { token } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({ name:'', ticket_type:'incident', title:'', description:'', category:'', priority:'medium', tags:[] });

  const TICKET_TYPES = [
    { value: 'incident',        label: t('createTicket.incidentName') || 'Incident' },
    { value: 'service_request', label: t('createTicket.serviceName') || 'Service Request' },
    { value: 'change',          label: t('change.changeChangeShort') || 'Change' },
  ];
  const PRIORITIES = [
    { value: 'low',      label: t('settings.priorityLow') },
    { value: 'medium',   label: t('settings.priorityMedium') },
    { value: 'high',     label: t('settings.priorityHigh') },
    { value: 'critical', label: t('settings.priorityCritical') },
  ];

  const fetch_all = async () => {
    try { setTemplates(await apiFetch('/ticket-templates/', token)); } catch(e) { toast.error(e.message); }
  };
  useEffect(() => { fetch_all(); }, [token]);

  const openNew  = () => { setForm({ name:'', ticket_type:'incident', title:'', description:'', category:'', priority:'medium', tags:[] }); setEditing({}); };
  const openEdit = (tmpl) => { setForm({ name:tmpl.name, ticket_type:tmpl.ticket_type, title:tmpl.title||'', description:tmpl.description||'', category:tmpl.category||'', priority:tmpl.priority||'medium', tags:tmpl.tags||[] }); setEditing(tmpl); };

  const handleSave = async () => {
    try {
      if (editing?.id) await apiFetch(`/ticket-templates/${editing.id}`, token, { method:'PUT', body:JSON.stringify(form) });
      else await apiFetch('/ticket-templates/', token, { method:'POST', body:JSON.stringify(form) });
      toast.success(t('settings.templateSaved'));
      setEditing(null);
      fetch_all();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm(t('settings.deleteTemplateConfirm'))) return;
    try { await apiFetch(`/ticket-templates/${id}`, token, { method:'DELETE' }); fetch_all(); } catch(e) { toast.error(e.message); }
  };

  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const inp  = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl  = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

  return (
    <div>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{t('settings.templatesTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.templatesDesc')}</p>
          </div>
          <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">{t('settings.newTemplate')}</button>
        </div>

        {editing !== null ? (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{editing.id ? t('settings.editTemplate') : t('settings.newTemplateForm')}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>{t('settings.templateName')}</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className={inp} placeholder={t('settings.templateNamePlaceholder')} /></div>
                <div><label className={lbl}>{t('settings.ticketType')}</label>
                  <select value={form.ticket_type} onChange={e=>setForm({...form,ticket_type:e.target.value})} className={inp}>
                    {TICKET_TYPES.map(tt=><option key={tt.value} value={tt.value}>{tt.label}</option>)}
                  </select>
                </div>
              </div>
              <div><label className={lbl}>{t('settings.prefilledTitle')}</label><input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className={inp} placeholder={t('settings.prefilledTitlePlaceholder')} /></div>
              <div><label className={lbl}>{t('settings.prefilledDesc')}</label><textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} rows={3} className={inp} placeholder={t('settings.prefilledDescPlaceholder')} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className={lbl}>{t('settings.categoryLabel')}</label>
                  <select value={form.category} onChange={e=>setForm({...form,category:e.target.value})} className={inp}>
                    <option value="">{t('settings.selectCategory')}</option>
                    {CATEGORIES.map(c=><option key={c} value={c}>{t(`createTicket.categories.${c.split(' ').join('')}`) || c}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>{t('settings.priorityLabel')}</label>
                  <select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})} className={inp}>
                    {PRIORITIES.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">{t('settings.saveTemplate')}</button>
              <button onClick={() => setEditing(null)} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">{t('settings.cancelBtn')}</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {templates.length === 0 && (
              <div className={card + " text-center py-10"}>
                <p className="text-gray-400 text-sm">{t('settings.noTemplates')}</p>
              </div>
            )}
            {templates.map(tmpl => (
              <div key={tmpl.id} className={card + " flex items-start justify-between"}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-800 dark:text-white">📋 {tmpl.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${tmpl.ticket_type==='incident'?'bg-red-100 text-red-700':tmpl.ticket_type==='service_request'?'bg-blue-100 text-blue-700':'bg-purple-100 text-purple-700'}`}>
                      {TICKET_TYPES.find(tt=>tt.value===tmpl.ticket_type)?.label || tmpl.ticket_type}
                    </span>
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">
                      {PRIORITIES.find(p=>p.value===tmpl.priority)?.label || tmpl.priority}
                    </span>
                  </div>
                  {tmpl.title && <p className="text-xs text-gray-600 dark:text-gray-300">{t('settings.titleLabel')} "{tmpl.title}"</p>}
                  {tmpl.category && <p className="text-xs text-gray-400">{t('settings.categoryShort')} {t(`createTicket.categories.${tmpl.category.split(' ').join('')}`) || tmpl.category}</p>}
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => openEdit(tmpl)} className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 px-3 py-1 rounded-lg">{t('settings.editBtn')}</button>
                  <button onClick={() => handleDelete(tmpl.id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-800 px-3 py-1 rounded-lg">{t('settings.deleteBtn')}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
