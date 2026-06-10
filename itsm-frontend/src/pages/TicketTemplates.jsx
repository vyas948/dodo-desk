import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../utils/apiFetch';
import Layout from '../components/Layout';

const EMPTY_FORM = {
  name: '', description: '', ticket_title: '', ticket_description: '',
  ticket_type: 'service_request', category: '', priority: 'medium',
};

export default function TicketTemplates() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchTemplates = async () => {
    try {
      const data = await apiFetch('/ticket-templates/', token);
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTemplates(); }, [token]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/ticket-templates/${editingId}`, token, { method: 'PUT', body: JSON.stringify(form) });
        toast.success('Template updated.');
      } else {
        await apiFetch('/ticket-templates/', token, { method: 'POST', body: JSON.stringify(form) });
        toast.success('Template created.');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      fetchTemplates();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleEdit = (tpl) => {
    setForm({
      name: tpl.name, description: tpl.description || '',
      ticket_title: tpl.ticket_title, ticket_description: tpl.ticket_description,
      ticket_type: tpl.ticket_type, category: tpl.category || '', priority: tpl.priority,
    });
    setEditingId(tpl.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this template?')) return;
    try {
      await apiFetch(`/ticket-templates/${id}`, token, { method: 'DELETE' });
      toast.success('Template deleted.');
      fetchTemplates();
    } catch (err) { toast.error(err.message); }
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm";
  const selectClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  const TYPE_LABELS = { incident: '🚨 Incident', service_request: '📋 Service Request' };
  const PRIORITY_COLORS = {
    low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color: 'var(--text-primary)'}}>Ticket Templates</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Pre-filled templates that employees can use when creating tickets.</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }} className={btnPrimary}>
            + New Template
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className={`${cardClass} mb-6`}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
              {editingId ? 'Edit Template' : 'Create Template'}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template Name <span className="text-red-500">*</span></label>
                  <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="e.g. New Employee Onboarding" className={inputClass} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template Description</label>
                  <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description shown to employees" className={inputClass} />
                </div>
              </div>

              <hr className="border-gray-200 dark:border-gray-700" />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Pre-filled Ticket Content</p>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ticket Title <span className="text-red-500">*</span></label>
                <input type="text" value={form.ticket_title} onChange={e => setForm({...form, ticket_title: e.target.value})} required placeholder="e.g. New employee setup request for [Name]" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ticket Description <span className="text-red-500">*</span></label>
                <textarea rows={5} value={form.ticket_description} onChange={e => setForm({...form, ticket_description: e.target.value})} required
                          placeholder="Pre-fill the description with instructions or a checklist..."
                          className={inputClass} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
                  <select value={form.ticket_type} onChange={e => setForm({...form, ticket_type: e.target.value})} className={selectClass}>
                    <option value="incident">Incident</option>
                    <option value="service_request">Service Request</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Priority</label>
                  <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className={selectClass}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category</label>
                  <input type="text" value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="e.g. HR, IT, Hardware" className={inputClass} />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : editingId ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Template list */}
        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : templates.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-500 dark:text-gray-400">No templates yet. Create one to help employees submit tickets faster.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {templates.map(tpl => (
              <div key={tpl.id} className={`${cardClass} flex flex-col gap-3`}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-white">{tpl.name}</h3>
                    {tpl.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{tpl.description}</p>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0 ml-2">
                    <button onClick={() => handleEdit(tpl)} className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm">Edit</button>
                    <span className="text-gray-300 dark:text-gray-600">·</span>
                    <button onClick={() => handleDelete(tpl.id)} className="text-red-500 dark:text-red-400 hover:underline text-sm">Delete</button>
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-sm">
                  <p className="font-medium text-gray-700 dark:text-gray-300 truncate">{tpl.ticket_title}</p>
                  <p className="text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{tpl.ticket_description}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                    {TYPE_LABELS[tpl.ticket_type]}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${PRIORITY_COLORS[tpl.priority]}`}>
                    {tpl.priority}
                  </span>
                  {tpl.category && (
                    <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300">
                      {tpl.category}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
