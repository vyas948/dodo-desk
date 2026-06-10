import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const EMPTY_STEP = { name: '', approver_id: '', approver_role: '' };
const EMPTY_FORM = { name: '', category: '', ticket_type: 'service_request', steps: [{ ...EMPTY_STEP }] };

export default function ApprovalWorkflows() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    try {
      const [wf, users] = await Promise.all([
        apiFetch('/approval-workflows/', token),
        apiFetch('/users/', token),
      ]);
      setWorkflows(Array.isArray(wf) ? wf : []);
      setAgents(Array.isArray(users) ? users.filter(u => u.role === 'agent' || u.role === 'admin') : []);
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
    if (form.steps.some(s => !s.name)) { toast.error('Each step needs a name.'); return; }
    if (form.steps.some(s => !s.approver_id && !s.approver_role)) {
      toast.error('Each step needs an approver (specific person or role).'); return;
    }
    setSaving(true);
    try {
      await apiFetch('/approval-workflows/', token, { method: 'POST', body: JSON.stringify(form) });
      toast.success('Workflow created.');
      setShowForm(false);
      setForm(EMPTY_FORM);
      fetchAll();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
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
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color:'var(--text-primary)'}}>Approval Workflows</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Define multi-level approval chains for service requests.</p>
          </div>
          <button onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }} className={btnPrimary}>New Workflow</button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className={`${cardClass} mb-6`}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">New Approval Workflow</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1">
                  <label className={labelClass}>Workflow Name *</label>
                  <input type="text" required value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                         placeholder="e.g. Hardware Request Approval" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Category (optional)</label>
                  <input type="text" value={form.category} onChange={e => setForm({...form, category: e.target.value})}
                         placeholder="e.g. Hardware, Software, HR" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Applies To</label>
                  <select value={form.ticket_type} onChange={e => setForm({...form, ticket_type: e.target.value})} className={inputClass}>
                    <option value="service_request">Service Requests</option>
                    <option value="incident">Incidents</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Approval Steps</label>
                  <button type="button" onClick={addStep}
                          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ Add Step</button>
                </div>
                <div className="space-y-3">
                  {form.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-1">
                        {i + 1}
                      </div>
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className={labelClass}>Step Name *</label>
                          <input type="text" value={step.name}
                                 onChange={e => updateStep(i, 'name', e.target.value)}
                                 placeholder="e.g. Line Manager" className={inputClass} />
                        </div>
                        <div>
                          <label className={labelClass}>Specific Approver</label>
                          <select value={step.approver_id} onChange={e => updateStep(i, 'approver_id', e.target.value)} className={inputClass}>
                            <option value="">— select person —</option>
                            {['admin', 'agent'].map(role => {
                              const group = agents.filter(a => a.role === role);
                              if (!group.length) return null;
                              return (
                                <optgroup key={role} label={role === 'admin' ? 'Admins' : 'Agents'}>
                                  {group.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                                </optgroup>
                              );
                            })}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Or Any User With Role</label>
                          <select value={step.approver_role} onChange={e => updateStep(i, 'approver_role', e.target.value)} className={inputClass}>
                            <option value="">— select role —</option>
                            <option value="admin">Admin</option>
                            <option value="agent">Agent</option>
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
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : 'Create Workflow'}</button>
                <button type="button" onClick={() => setShowForm(false)} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Workflow list */}
        {loading ? (
          <p className="text-center text-gray-400 dark:text-gray-500 py-10">Loading...</p>
        ) : workflows.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">✅</p>
            <p className="text-gray-500 dark:text-gray-400">No workflows yet. Create one to enable multi-level approvals.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {workflows.map(wf => (
              <div key={wf.id} className={cardClass}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-white">{wf.name}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {wf.ticket_type === 'service_request' ? 'Service Requests' : 'Incidents'}
                      {wf.category && ` · Category: ${wf.category}`}
                    </p>
                  </div>
                  <button onClick={() => handleDelete(wf.id)} className="text-red-500 hover:underline text-sm">Delete</button>
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
