import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { useTranslation } from '../i18n/I18nContext';
import { TICKET_CATEGORIES } from './CreateTicket';

const EMPTY_STEP = { name: '', approver_id: '', approver_role: '' };
const EMPTY_FORM = { name: '', category: '', ticket_type: 'service_request', steps: [{ ...EMPTY_STEP }] };

export default function ApprovalWorkflows() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchAll = async () => {
    try {
      const [wf, users] = await Promise.all([
        apiFetch('/approval-workflows/', token),
        apiFetch('/users/', token),
      ]);
      setWorkflows(Array.isArray(wf) ? wf : []);
      setAgents(Array.isArray(users) ? users : []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, [token]);

  const addStep = () => setForm({ ...form, steps: [...form.steps, { ...EMPTY_STEP }] });
  const removeStep = (i) => setForm({ ...form, steps: form.steps.filter((_, idx) => idx !== i) });
  const updateStep = (i, field, value) => {
    const steps = [...form.steps];
    steps[i] = { ...steps[i], [field]: value };
    // Clear the other approver field when one is set
    if (field === 'approver_id' && value) steps[i].approver_role = '';
    if (field === 'approver_role' && value) steps[i].approver_id = '';
    setForm({ ...form, steps });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.category) { toast.error('Please select a category.'); return; }
    if (form.steps.some(s => !s.name)) { toast.error('Each step needs a name.'); return; }
    if (form.steps.some(s => !s.approver_id && !s.approver_role)) {
      toast.error('Each step needs an approver (specific person or role).'); return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await apiFetch(`/approval-workflows/${editingId}`, token, { method: 'PUT', body: JSON.stringify(form) });
        toast.success('Workflow updated.');
      } else {
        await apiFetch('/approval-workflows/', token, { method: 'POST', body: JSON.stringify(form) });
        toast.success('Workflow created.');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      fetchAll();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleEdit = (wf) => {
    setForm({
      name: wf.name,
      category: wf.category || '',
      ticket_type: wf.ticket_type || 'service_request',
      steps: wf.steps.map(s => ({
        name: s.name,
        approver_id: s.approver_id ? String(s.approver_id) : '',
        approver_role: s.approver_role || '',
      })),
    });
    setEditingId(wf.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this workflow?')) return;
    try {
      await apiFetch(`/approval-workflows/${id}`, token, { method: 'DELETE' });
      toast.success('Workflow deleted.');
      fetchAll();
    } catch (err) { toast.error(err.message); }
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";
  const labelClass = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color:'var(--text-primary)'}}>{t('workflow.title') || 'Approval Workflows'}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('workflow.subtitle') || 'Define multi-level approval chains for service requests.'}</p>
          </div>
          <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }} className={btnPrimary}>+ {t('workflow.newWorkflow') || 'New Workflow'}</button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className={`${cardClass} mb-6`}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">{editingId ? (t('workflow.editWorkflow') || 'Edit Approval Workflow') : (t('workflow.newWorkflowTitle') || 'New Approval Workflow')}</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className={labelClass}>{t('workflow.name') || 'Workflow Name'} *</label>
                  <input type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                         placeholder="e.g. Hardware Request Approval" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>{t('common.category') || 'Category'} <span className="text-red-500">*</span></label>
                  <select value={form.category} required onChange={e => setForm({...form, category: e.target.value})} className={inputClass}>
                    <option value="">— {t('common.select') || 'Select'} —</option>
                    {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    {form.category && !TICKET_CATEGORIES.includes(form.category) && (
                      <option value={form.category}>{form.category}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{t('workflow.appliesTo') || 'Applies To'}</label>
                  <select value={form.ticket_type} onChange={e => setForm({...form, ticket_type: e.target.value})} className={inputClass}>
                    <option value="service_request">{t('ticket.serviceRequest') || 'Service Requests'}</option>
                    <option value="incident">{t('ticket.incident') || 'Incidents'}</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('workflow.approvalSteps') || 'Approval Steps'}</label>
                  <button type="button" onClick={addStep}
                          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ {t('workflow.addStep') || 'Add Step'}</button>
                </div>
                <div className="space-y-3">
                  {form.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-1">
                        {i + 1}
                      </div>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className={labelClass}>{t('workflow.stepName') || 'Step Name'} *</label>
                          <input type="text" value={step.name}
                                 onChange={e => updateStep(i, 'name', e.target.value)}
                                 placeholder="e.g. Line Manager" className={inputClass} />
                        </div>
                        <div>
                          <label className={labelClass}>{t('workflow.specificApprover') || 'Specific Approver'}</label>
                          <select value={step.approver_id} onChange={e => updateStep(i, 'approver_id', e.target.value)} className={inputClass}>
                            <option value="">— {t('workflow.selectPerson') || 'select person'} —</option>
                            {['super_admin', 'admin', 'agent', 'employee'].map(role => {
                              const group = agents.filter(a => a.role === role);
                              if (!group.length) return null;
                              const roleLabel = role === 'super_admin' ? 'Super Admins' : role === 'admin' ? 'Admins' : role === 'agent' ? 'Agents' : 'Employees';
                              return (
                                <optgroup key={role} label={roleLabel}>
                                  {group.map(a => <option key={a.id} value={a.id}>{a.full_name}{a.job_title ? ` — ${a.job_title}` : ''}</option>)}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>{t('workflow.anyUserWithRole') || 'Or Any User With Role'}</label>
                          <select value={step.approver_role} onChange={e => updateStep(i, 'approver_role', e.target.value)} className={inputClass}>
                            <option value="">— {t('workflow.selectRole') || 'select role'} —</option>
                            <option value="admin">{t('common.admin') || 'Admin'}</option>
                            <option value="agent">{t('common.agent') || 'Agent'}</option>
                          </select>
                        </div>
                      </div>
                      {form.steps.length > 1 && (
                        <button type="button" onClick={() => removeStep(i)}
                                className="text-red-400 hover:text-red-600 mt-1 flex-shrink-0">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? (t('common.loading') || 'Saving...') : editingId ? (t('workflow.updateWorkflow') || 'Update Workflow') : (t('workflow.createWorkflow') || 'Create Workflow')}</button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }} className={btnSecondary}>{t('common.cancel') || 'Cancel'}</button>
              </div>
            </form>
          </div>
        )}

        {/* Live search */}
        {!loading && workflows.length > 0 && (
          <div className="relative mb-4">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder={t('common.search') + ' workflows...'}
              className="w-full pl-10 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✕</button>
            )}
          </div>
        )}

        {/* Workflow list */}
        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">{t('common.loading')}</p>
        ) : workflows.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">✅</p>
            <p className="text-gray-500 dark:text-gray-400">{t('workflow.noWorkflows')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {workflows
              .filter(wf => !searchTerm ||
                wf.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                wf.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                wf.ticket_type?.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map(wf => (
              <div key={wf.id} className={cardClass}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-white">{wf.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {wf.ticket_type === 'service_request' ? 'Service Requests' : 'Incidents'}
                      {wf.category && ` · Category: ${wf.category}`}
                    </p>
                  </div>
                  <div className="flex gap-3 items-center">
                    <button onClick={() => handleEdit(wf)} title="Edit workflow" className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 transition">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.932L7.5 19.785 3 21l1.215-4.5L16.862 4.487z" />
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(wf.id)} title="Delete workflow" className="text-red-400 hover:text-red-600 transition">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Steps timeline */}
                <div className="flex items-center gap-2 flex-wrap">
                  {wf.steps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg px-3 py-2">
                        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">{step.step_order}</span>
                        <div>
                          <p className="text-xs font-medium text-gray-800 dark:text-white">{step.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {step.approver_name || (step.approver_role ? `Any ${step.approver_role}` : '—')}
                          </p>
                        </div>
                      </div>
                      {i < wf.steps.length - 1 && (
                        <span className="text-gray-400">→</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
