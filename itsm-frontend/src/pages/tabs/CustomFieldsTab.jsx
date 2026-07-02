import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

const FIELD_TYPES = [
  { value: 'text',     label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];
const APPLIES_TO = [
  { value: 'all',             label: 'All Tickets' },
  { value: 'incident',        label: 'Incidents only' },
  { value: 'service_request', label: 'Service Requests only' },
  { value: 'change',          label: 'Changes only' },
  { value: 'asset',           label: '💻 Assets' },
  { value: 'kb_article',      label: '📋 Knowledge Base Articles' },
];

export default function CustomFieldsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [fields, setFields]   = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm]       = useState({ name:'', field_type:'text', options:[], is_required:false, applies_to:'all' });
  const [newOption, setNewOption] = useState('');

  const fetchFields = async () => {
    try { setFields(await apiFetch('/admin/custom-fields', token)); } catch(e) { toast.error(e.message); }
  };
  useEffect(() => { fetchFields(); }, [token]);

  const openNew  = () => { setForm({ name:'', field_type:'text', options:[], is_required:false, applies_to:'all' }); setEditing({}); };
  const openEdit = (f) => { setForm({ name:f.name, field_type:f.field_type, options:f.options||[], is_required:f.is_required, applies_to:f.applies_to||'all' }); setEditing(f); };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Field name is required');
    try {
      if (editing?.id) await apiFetch(`/admin/custom-fields/${editing.id}`, token, { method:'PUT', body:JSON.stringify(form) });
      else await apiFetch('/admin/custom-fields', token, { method:'POST', body:JSON.stringify(form) });
      toast.success('Custom field saved');
      setEditing(null);
      fetchFields();
    } catch(e) { toast.error(e.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this field? Existing ticket data for this field will be lost.')) return;
    try { await apiFetch(`/admin/custom-fields/${id}`, token, { method:'DELETE' }); fetchFields(); } catch(e) { toast.error(e.message); }
  };

  const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">🗂️ Custom Ticket Fields</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Add extra fields to tickets for your team's specific needs</p>
        </div>
        <button onClick={openNew} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">+ Add Field</button>
      </div>

      {editing !== null && (
        <div className={card}>
          <h4 className="font-semibold text-gray-800 dark:text-white mb-4">{editing.id ? 'Edit Field' : 'New Custom Field'}</h4>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className={lbl}>Field Name *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className={inp} placeholder="e.g. Customer PO Number" /></div>
              <div><label className={lbl}>Field Type</label>
                <select value={form.field_type} onChange={e=>setForm({...form,field_type:e.target.value})} className={inp}>
                  {FIELD_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {form.field_type === 'dropdown' && (
              <div>
                <label className={lbl}>Options</label>
                <div className="flex gap-2 mb-2">
                  <input value={newOption} onChange={e=>setNewOption(e.target.value)}
                         onKeyDown={e=>{ if(e.key==='Enter'&&newOption.trim()){ setForm(f=>({...f,options:[...f.options,newOption.trim()]})); setNewOption(''); }}}
                         placeholder="Type option and press Enter" className={inp+" flex-1"} />
                  <button onClick={()=>{ if(newOption.trim()){ setForm(f=>({...f,options:[...f.options,newOption.trim()]})); setNewOption(''); }}}
                          className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm">Add</button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {form.options.map((o,i)=>(
                    <span key={i} className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded text-xs">
                      {o}
                      <button onClick={()=>setForm(f=>({...f,options:f.options.filter((_,idx)=>idx!==i)}))} className="text-red-400 hover:text-red-600">✕</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><label className={lbl}>Applies To</label>
                <select value={form.applies_to} onChange={e=>setForm({...form,applies_to:e.target.value})} className={inp}>
                  {APPLIES_TO.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 mt-5">
                <input type="checkbox" id="required" checked={form.is_required} onChange={e=>setForm({...form,is_required:e.target.checked})} className="rounded" />
                <label htmlFor="required" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">Required field</label>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition">Save Field</button>
            <button onClick={()=>setEditing(null)} className="bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 transition">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {fields.length === 0 && !editing && (
          <div className={card+" text-center py-8"}>
            <p className="text-gray-400 text-sm">No custom fields yet. Add fields to capture information specific to your team.</p>
          </div>
        )}
        {fields.map(f => (
          <div key={f.id} className={card+" flex items-center justify-between"}>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-medium text-gray-800 dark:text-white">{f.name}</span>
                {f.is_required && <span className="text-xs text-red-500 font-medium">Required</span>}
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded">{f.field_type}</span>
                <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 px-2 py-0.5 rounded">{APPLIES_TO.find(a=>a.value===f.applies_to)?.label || f.applies_to}</span>
              </div>
              <p className="text-xs text-gray-400 font-mono">key: {f.field_key}</p>
              {f.options?.length > 0 && <p className="text-xs text-gray-400 mt-0.5">Options: {f.options.join(', ')}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={()=>openEdit(f)} className="text-xs text-indigo-500 border border-indigo-200 dark:border-indigo-700 px-3 py-1 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30">Edit</button>
              <button onClick={()=>handleDelete(f.id)} className="text-xs text-red-500 border border-red-200 dark:border-red-800 px-3 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
