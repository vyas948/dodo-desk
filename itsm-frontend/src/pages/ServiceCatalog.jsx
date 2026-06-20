import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';
import { TICKET_CATEGORIES } from './CreateTicket';

const DEPARTMENTS = ['Management','HR','IT','Finance','Operations','Sales & Marketing','Legal','Other Department'];
const EMPTY_TASK = { title: '', description: '', category: 'Onboarding', priority: 'medium', assign_to_role: '', assign_to_id: '' };
const EMPTY_FORM = {
  name: '', description: '', category: '', estimated_cost: '', delivery_time_days: '',
  approval_required: true, ticket_title: '', ticket_description: '',
  ticket_type: 'service_request', priority: 'medium',
  is_onboarding: false, onboarding_tasks: [], is_featured: false,
};

export default function ServiceCatalog() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [agentList, setAgentList] = useState([]);
  const [workflows, setWorkflows] = useState([]);

  // Onboarding modal state
  const [onboardingItem, setOnboardingItem] = useState(null);
  const [onboardingForm, setOnboardingForm] = useState({ employee_name: '', employee_email: '', start_date: '', manager_name: '', department: '' });
  const [onboarding, setOnboarding] = useState(false);

  const isAgentOrAdmin = user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin');

  const fetchItems = async () => {
    try {
      const data = await apiFetch('/catalog/', token);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchItems();
    if (isAgentOrAdmin) {
      apiFetch('/users/', token)
        .then(data => setAgentList(Array.isArray(data) ? data.filter(u => u.role === 'agent' || u.role === 'admin') : []))
        .catch(() => {});
      apiFetch('/approval-workflows/', token)
        .then(data => setWorkflows(Array.isArray(data) ? data : []))
        .catch(() => {});
    }
  }, [token]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        delivery_time_days: form.delivery_time_days ? parseInt(form.delivery_time_days) : null,
      };
      if (editingId) {
        await apiFetch(`/catalog/${editingId}`, token, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('Catalog item updated.');
      } else {
        await apiFetch('/catalog/', token, { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Catalog item created.');
      }
      setShowForm(false); setEditingId(null); setForm(EMPTY_FORM);
      fetchItems();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleEdit = (item) => {
    setForm({
      name: item.name, description: item.description || '',
      category: item.category || '', estimated_cost: item.estimated_cost || '',
      delivery_time_days: item.delivery_time_days || '',
      approval_required: item.approval_required,
      ticket_title: item.ticket_title || '', ticket_description: item.ticket_description || '',
      ticket_type: item.ticket_type || 'service_request', priority: item.priority || 'medium',
      is_onboarding: item.is_onboarding || false,
      onboarding_tasks: item.onboarding_tasks || [],
      is_featured: item.is_featured || false,
    });
    setEditingId(item.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this catalog item?')) return;
    try {
      await apiFetch(`/catalog/${id}`, token, { method: 'DELETE' });
      toast.success('Item deleted.');
      fetchItems();
    } catch (err) { toast.error(err.message); }
  };

  const handleRequest = (item) => {
    if (item.is_onboarding) {
      setOnboardingItem(item);
      setOnboardingForm({ employee_name: '', employee_email: '', start_date: '', manager_name: '', department: '' });
    } else {
      navigate(`/create-ticket?catalog_item=${item.id}`);
    }
  };

  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    setOnboarding(true);
    try {
      const res = await apiFetch(`/catalog/${onboardingItem.id}/onboard`, token, {
        method: 'POST',
        body: JSON.stringify(onboardingForm),
      });
      toast.success(`✅ ${res.created} onboarding tickets created for ${onboardingForm.employee_name}!`);
      setOnboardingItem(null);
    } catch (err) { toast.error(err.message); }
    finally { setOnboarding(false); }
  };

  const addTask = () => setForm({ ...form, onboarding_tasks: [...form.onboarding_tasks, { ...EMPTY_TASK }] });
  const removeTask = (i) => setForm({ ...form, onboarding_tasks: form.onboarding_tasks.filter((_, idx) => idx !== i) });
  const updateTask = (i, field, value) => {
    const tasks = [...form.onboarding_tasks];
    tasks[i] = { ...tasks[i], [field]: value };
    setForm({ ...form, onboarding_tasks: tasks });
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm";
  const labelClass = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  const PRIORITY_COLORS = {
    low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
    medium: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
    high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
    critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white" style={{color:'var(--text-primary)'}}>
              {t('catalog.title')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {isAgentOrAdmin ? 'Manage service catalog items and onboarding workflows.' : 'Browse available services and submit a request.'}
            </p>
          </div>
          {isAgentOrAdmin && (
            <button onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_FORM); }} className={btnPrimary}>
              + {t('catalog.newItem') || 'New Item'}
            </button>
          )}
        </div>

        {/* Management form */}
        {isAgentOrAdmin && showForm && (
          <div className={`${cardClass} mb-6`}>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">
              {editingId ? 'Edit Catalog Item' : 'New Catalog Item'}
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Service Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className={labelClass}>Service Name *</label>
                  <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required placeholder="e.g. Employee Onboarding" className={inputClass} />
                </div>
                <div className="col-span-2">
                  <label className={labelClass}>Description</label>
                  <input type="text" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Brief description shown to employees" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Category</label>
                  <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} className={inputClass}>
                    <option value="">— Select Category —</option>
                    {TICKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {form.approval_required && form.category && (() => {
                    const matched = workflows.find(wf => wf.is_active && (wf.ticket_type === 'service_request') && (!wf.category || wf.category === form.category));
                    return matched ? (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1.5">
                        ✅ Linked approval workflow: <strong>{matched.name}</strong> ({matched.steps?.length || 0} step{matched.steps?.length === 1 ? '' : 's'})
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                        ⚠ No approval workflow found for category "{form.category}". Requests will skip approval unless a workflow is created in the Workflows page with this category (or no category set).
                      </p>
                    );
                  })()}
                </div>
                <div>
                  <label className={labelClass}>Default Priority</label>
                  <select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} className={inputClass}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Estimated Cost ($)</label>
                  <input type="number" value={form.estimated_cost} onChange={e => setForm({...form, estimated_cost: e.target.value})} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Delivery Time (days)</label>
                  <input type="number" value={form.delivery_time_days} onChange={e => setForm({...form, delivery_time_days: e.target.value})} className={inputClass} />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="approval" checked={form.approval_required}
                         onChange={e => setForm({...form, approval_required: e.target.checked})}
                         className="w-4 h-4 rounded text-indigo-600" />
                  <label htmlFor="approval" className="text-sm text-gray-700 dark:text-gray-300">Requires approval</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="onboarding" checked={form.is_onboarding}
                         onChange={e => setForm({...form, is_onboarding: e.target.checked, onboarding_tasks: e.target.checked && form.onboarding_tasks.length === 0 ? [{ ...EMPTY_TASK }] : form.onboarding_tasks})}
                         className="w-4 h-4 rounded text-indigo-600" />
                  <label htmlFor="onboarding" className="text-sm text-gray-700 dark:text-gray-300">🎉 This is an onboarding item (creates multiple tickets)</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="featured" checked={form.is_featured}
                         onChange={e => setForm({...form, is_featured: e.target.checked})}
                         className="w-4 h-4 rounded text-indigo-600" />
                  <label htmlFor="featured" className="text-sm text-gray-700 dark:text-gray-300">⭐ Show under Quick Start</label>
                </div>
              </div>

              {/* Onboarding tasks */}
              {form.is_onboarding ? (
                <div>
                  <hr className="border-gray-200 dark:border-gray-700 my-2" />
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Onboarding Tasks</p>
                    <button type="button" onClick={addTask} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">+ Add Task</button>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                    Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{employee_name}'}</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{start_date}'}</code>, <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'{department}'}</code> as placeholders.
                  </p>
                  <div className="space-y-3">
                    {form.onboarding_tasks.map((task, i) => (
                      <div key={i} className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Task {i + 1}</span>
                          {form.onboarding_tasks.length > 1 && (
                            <button type="button" onClick={() => removeTask(i)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <label className={labelClass}>Task Title *</label>
                            <input type="text" value={task.title} onChange={e => updateTask(i, 'title', e.target.value)}
                                   placeholder="e.g. Set up laptop for {employee_name}" className={inputClass} />
                          </div>
                          <div className="col-span-2">
                            <label className={labelClass}>Description</label>
                            <textarea rows={2} value={task.description} onChange={e => updateTask(i, 'description', e.target.value)}
                                      placeholder="Instructions for this task..." className={inputClass} />
                          </div>
                          <div>
                            <label className={labelClass}>Category</label>
                            <input type="text" value={task.category} onChange={e => updateTask(i, 'category', e.target.value)}
                                   placeholder="e.g. IT, HR" className={inputClass} />
                          </div>
                          <div>
                            <label className={labelClass}>Priority</label>
                            <select value={task.priority} onChange={e => updateTask(i, 'priority', e.target.value)} className={inputClass}>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                              <option value="critical">Critical</option>
                            </select>
                          </div>
                          <div>
                            <label className={labelClass}>Assign to Specific Agent</label>
                            <select value={task.assign_to_id} onChange={e => updateTask(i, 'assign_to_id', e.target.value)} className={inputClass}>
                              <option value="">— or use role below —</option>
                              {['admin','agent'].map(role => {
                                const group = agentList.filter(a => a.role === role);
                                if (!group.length) return null;
                                return <optgroup key={role} label={role === 'admin' ? 'Admins' : 'Agents'}>
                                  {group.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                                </optgroup>;
                              })}
                            </select>
                          </div>
                          <div>
                            <label className={labelClass}>Or Assign to Role</label>
                            <select value={task.assign_to_role} onChange={e => updateTask(i, 'assign_to_role', e.target.value)} className={inputClass}>
                              <option value="">— select role —</option>
                              <option value="admin">Admin</option>
                              <option value="agent">Agent</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <hr className="border-gray-200 dark:border-gray-700 my-2" />
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Pre-filled Ticket Content</p>
                  <div className="space-y-3">
                    <div>
                      <label className={labelClass}>Ticket Title *</label>
                      <input type="text" value={form.ticket_title} onChange={e => setForm({...form, ticket_title: e.target.value})} required placeholder="e.g. New laptop request" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Ticket Description *</label>
                      <textarea rows={4} value={form.ticket_description} onChange={e => setForm({...form, ticket_description: e.target.value})} required className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>Ticket Type</label>
                      <select value={form.ticket_type} onChange={e => setForm({...form, ticket_type: e.target.value})} className={inputClass}>
                        <option value="service_request">Service Request</option>
                        <option value="incident">Incident</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Saving...' : editingId ? 'Update' : 'Create'}</button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); }} className={btnSecondary}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Quick Start — Featured items */}
        {!loading && items.some(i => i.is_featured) && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
              ⭐ Quick Start
            </h2>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {items.filter(i => i.is_featured).map(item => (
                <div key={`featured-${item.id}`} className={`${cardClass} border-2 border-indigo-200 dark:border-indigo-700 flex flex-col justify-between hover:shadow-md transition`}>
                  <div>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-gray-800 dark:text-gray-100">{item.name}</h3>
                      {item.category && <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full">{item.category}</span>}
                    </div>
                    {item.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{item.description}</p>}
                  </div>
                  <button onClick={() => handleRequest(item)} className={`${btnPrimary} w-full mt-2`}>
                    Request
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Catalog grid */}
        {loading ? (
          <p className="text-gray-400 dark:text-gray-500">{t('common.loading')}</p>
        ) : items.length === 0 ? (
          <div className={`${cardClass} text-center py-12`}>
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-500 dark:text-gray-400">{t('catalog.noItems')}</p>
          </div>
        ) : (
          <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(item => (
              <div key={item.id} className={`${cardClass} flex flex-col justify-between hover:shadow-md transition`}>
                <div>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {item.is_onboarding && <span title="Onboarding workflow" className="text-lg">🎉</span>}
                      <h3 className="font-semibold text-indigo-600 dark:text-indigo-400">{item.name}</h3>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-2 flex-shrink-0 ${PRIORITY_COLORS[item.priority]}`}>
                      {item.priority}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{item.description || ''}</p>
                  {item.is_onboarding && (
                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-2">
                      📋 {item.onboarding_tasks?.length || 0} onboarding tasks
                    </p>
                  )}
                  <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1">
                    {item.category && <span className="inline-block bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full mr-2">{item.category}</span>}
                    {item.estimated_cost && <span>{t('catalog.cost')}: ${item.estimated_cost}</span>}
                    {item.estimated_cost && item.delivery_time_days && <span className="mx-1">·</span>}
                    {item.delivery_time_days && <span>{t('catalog.delivery')}: {item.delivery_time_days} {t('catalog.days')}</span>}
                  </div>
                  {item.approval_required && <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">⏳ Requires approval</p>}
                </div>
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                  <button onClick={() => handleRequest(item)}
                          className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-700 transition">
                    {item.is_onboarding ? '🎉 Start Onboarding →' : 'Request →'}
                  </button>
                  {isAgentOrAdmin && (
                    <div className="flex gap-3 text-sm">
                      <button onClick={() => handleEdit(item)} title="Edit" className="text-indigo-500 hover:text-indigo-700 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.1 2.1 0 113 2.932L7.5 19.785 3 21l1.215-4.5L16.862 4.487z" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(item.id)} title="Delete" className="text-red-400 hover:text-red-600 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Onboarding modal */}
        {onboardingItem && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6">
              <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-1">🎉 {onboardingItem.name}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Fill in the new joiner's details. {onboardingItem.onboarding_tasks?.length} tasks will be created automatically.
              </p>
              <form onSubmit={handleOnboardingSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className={labelClass}>Employee Full Name *</label>
                    <input type="text" required value={onboardingForm.employee_name}
                           onChange={e => setOnboardingForm({...onboardingForm, employee_name: e.target.value})}
                           placeholder="e.g. Jane Smith" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Employee Email</label>
                    <input type="email" value={onboardingForm.employee_email}
                           onChange={e => setOnboardingForm({...onboardingForm, employee_email: e.target.value})}
                           placeholder="jane@company.com" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Start Date</label>
                    <input type="date" value={onboardingForm.start_date}
                           onChange={e => setOnboardingForm({...onboardingForm, start_date: e.target.value})}
                           className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Manager</label>
                    <input type="text" value={onboardingForm.manager_name}
                           onChange={e => setOnboardingForm({...onboardingForm, manager_name: e.target.value})}
                           placeholder="Manager's name" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Department</label>
                    <select value={onboardingForm.department}
                            onChange={e => setOnboardingForm({...onboardingForm, department: e.target.value})}
                            className={inputClass}>
                      <option value="">— Select —</option>
                      {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 text-xs text-indigo-700 dark:text-indigo-300">
                  <strong>Tasks to be created:</strong>
                  <ul className="mt-1 space-y-0.5">
                    {onboardingItem.onboarding_tasks?.map((t, i) => (
                      <li key={i}>• {t.title.replace('{employee_name}', onboardingForm.employee_name || '[Name]')}</li>
                    ))}
                  </ul>
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" disabled={onboarding} className={btnPrimary}>
                    {onboarding ? 'Creating tickets...' : `🎉 Start Onboarding (${onboardingItem.onboarding_tasks?.length} tasks)`}
                  </button>
                  <button type="button" onClick={() => setOnboardingItem(null)} className={btnSecondary}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
