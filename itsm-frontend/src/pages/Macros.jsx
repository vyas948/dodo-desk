import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const ACTION_TYPES = [
  { value: 'set_status',   label: 'Set Status' },
  { value: 'set_priority', label: 'Set Priority' },
  { value: 'set_category', label: 'Set Category' },
  { value: 'assign_to',    label: 'Assign To Agent' },
  { value: 'add_tag',      label: 'Add Tag' },
  { value: 'add_comment',  label: 'Add Comment' },
];
const STATUS_OPTS   = ['open','in_progress','pending_user','pending_vendor','resolved','closed'];
const PRIORITY_OPTS = ['low','medium','high','critical'];

export default function Macros() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [macros, setMacros]   = useState([]);
  const [agents, setAgents]   = useState([]);
  const [editing, setEditing] = useState(null); // null | {} | existing macro
  const [form, setForm]       = useState({ name: '', description: '', is_shared: true, actions: [] });

  const fetch_all = async () => {
    try {
      const [m, u] = await Promise.all([
        apiFetch('/macros/', token),
        apiFetch('/users/?role=agent', token),
      ]);
      setMacros(Array.isArray(m) ? m : []);
      setAgents(Array.isArray(u) ? u : (u.items ?? []));
    } catch(e) { toast.error(e.message); }
  };

  useEffect(() => { fetch_all(); }, [token]);

  const openNew = () => { setForm({ name: '', description: '', is_shared: true, actions: [] }); setEditing({}); };
  const openEdit = (m) => { setForm({ name: m.name, description: m.description||'', is_shared: m.is_shared, actions: m.actions||[] }); setEditing(m); };

  const addAction = () => setForm(f => ({ ...f, actions: [...f.actions, { type: 'set_status', value: 'open', is_internal: false }] }));
  const removeAction = (i) => setForm(f => ({ ...f, actions: f.actions.filter((_,idx) => idx !== i) }));
  const updateAction = (i, key, val) => setForm(f => ({
    ...f, actions: f.actions.map((a, idx) => idx === i ? { ...a, [key]: val } : a)
  }));

  const handleSave = async () => {
    try {
      if (editing?.id) await apiFetch(`/macros/${editing.id}`, token, { method: 'PUT', body: JSON.stringify(form) });
      else await apiFetch('/macros/', token, { method: 'POST', body: JSON.stringify(form) });
      toast.success('Macro saved');
      setEditing(null);
      fetch_all();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this macro?')) return;
    try { await apiFetch(`/macros/${id}`, token, { method: 'DELETE' }); fetch_all(); } catch(e) { toast.error(e.message); }
  };

  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";
  const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">⚡ Macros</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">One-click multi-action sequences applied to tickets</p>
          </div>
          <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">+ New Macro</button>
        </div>

        {editing !== null ? (
          <div className={card}>
            <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{editing.id ? 'Edit Macro' : 'New Macro'}</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name *</label>
                  <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} className={inp} placeholder="e.g. Close and tag resolved" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                  <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} className={inp} placeholder="Optional description" />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.is_shared} onChange={e => setForm({...form, is_shared: e.target.checked})} className="rounded" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Share with all agents</span>
              </label>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Actions (run in order)</label>
                  <button onClick={addAction} className="text-xs text-indigo-500 hover:text-indigo-700">+ Add action</button>
                </div>
                {form.actions.length === 0 && <p className="text-xs text-gray-400 italic">No actions yet — add at least one</p>}
                {form.actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <select value={action.type} onChange={e => updateAction(i, 'type', e.target.value)}
                            className={inp + " w-44"}>
                      {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                    {action.type === 'set_status' && (
                      <select value={action.value} onChange={e => updateAction(i, 'value', e.target.value)} className={inp + " flex-1"}>
                        {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {action.type === 'set_priority' && (
                      <select value={action.value} onChange={e => updateAction(i, 'value', e.target.value)} className={inp + " flex-1"}>
                        {PRIORITY_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {action.type === 'assign_to' && (
                      <select value={action.value} onChange={e => updateAction(i, 'value', e.target.value)} className={inp + " flex-1"}>
                        <option value="">Select agent</option>
                        {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                      </select>
                    )}
                    {['add_tag','set_category','add_comment'].includes(action.type) && (
                      <input value={action.value} onChange={e => updateAction(i, 'value', e.target.value)}
                             className={inp + " flex-1"} placeholder={action.type === 'add_comment' ? 'Comment text...' : 'Value'} />
                    )}
                    {action.type === 'add_comment' && (
                      <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <input type="checkbox" checked={action.is_internal||false} onChange={e => updateAction(i, 'is_internal', e.target.checked)} />
                        Internal
                      </label>
                    )}
                    <button onClick={() => removeAction(i)} className="text-red-400 hover:text-red-600 flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Save Macro</button>
              <button onClick={() => setEditing(null)} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {macros.length === 0 && (
              <div className={card + " text-center py-10"}>
                <p className="text-gray-400 text-sm">No macros yet. Create one to speed up repetitive ticket actions.</p>
              </div>
            )}
            {macros.map(m => (
              <div key={m.id} className={card + " flex items-start justify-between"}>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-800 dark:text-white">⚡ {m.name}</span>
                    {m.is_shared ? <span className="text-xs bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 px-2 py-0.5 rounded-full">Shared</span>
                                  : <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Personal</span>}
                    <span className="text-xs text-gray-400">Used {m.run_count} times</span>
                  </div>
                  {m.description && <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{m.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {(m.actions||[]).map((a,i) => (
                      <span key={i} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded">
                        {ACTION_TYPES.find(t => t.value === a.type)?.label || a.type}: {String(a.value).slice(0,20)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 ml-4 flex-shrink-0">
                  <button onClick={() => openEdit(m)} className="text-xs text-indigo-500 hover:text-indigo-700 border border-indigo-200 dark:border-indigo-700 px-3 py-1 rounded-lg">Edit</button>
                  <button onClick={() => handleDelete(m.id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 dark:border-red-800 px-3 py-1 rounded-lg">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
