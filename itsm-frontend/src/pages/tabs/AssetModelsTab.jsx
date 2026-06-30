import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

const TYPES = [
  { value: 'hardware',   label: '💻 Hardware' },
  { value: 'software',   label: '📦 Software' },
  { value: 'network',    label: '🌐 Network' },
  { value: 'mobile',     label: '📱 Mobile' },
  { value: 'peripheral', label: '🖨️ Peripheral' },
  { value: 'saas',       label: '☁️ SaaS' },
  { value: 'cloud',      label: '🔷 Cloud' },
  { value: 'other',      label: '📋 Other' },
];

export default function AssetModelsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [activeType, setActiveType] = useState('hardware');
  const [options, setOptions]       = useState([]);
  const [newLabel, setNewLabel]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [adding, setAdding]         = useState(false);

  const fetchOptions = (type = activeType) => {
    setLoading(true);
    apiFetch(`/asset-model-options/?asset_type=${type}`, token)
      .then(opts => setOptions(opts || []))
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchOptions(activeType); }, [activeType, token]);

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    setAdding(true);
    try {
      await apiFetch('/asset-model-options/', token, {
        method: 'POST',
        body: JSON.stringify({ asset_type: activeType, label: newLabel.trim(), sort_order: options.length }),
      });
      setNewLabel('');
      fetchOptions();
      toast.success('Model added');
    } catch (e) { toast.error(e.message); }
    finally { setAdding(false); }
  };

  const handleDelete = async (id) => {
    try {
      await apiFetch(`/asset-model-options/${id}`, token, { method: 'DELETE' });
      setOptions(opts => opts.filter(o => o.id !== id));
    } catch (e) { toast.error(e.message); }
  };

  const inp  = "flex-1 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const card = "bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">💻 Asset Models</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Manage the Model/Manufacturer dropdown shown when creating an asset, per asset type.
        </p>
      </div>

      {/* Type tabs */}
      <div className="flex gap-1 flex-wrap">
        {TYPES.map(t => (
          <button key={t.value} onClick={() => setActiveType(t.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${activeType===t.value ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-800 dark:text-white mb-3">
          {TYPES.find(t => t.value === activeType)?.label} models
          <span className="ml-2 text-xs font-normal text-gray-400">({options.length})</span>
        </h4>

        {/* Add new */}
        <div className="flex gap-2 mb-4">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && handleAdd()}
                 placeholder="e.g. Dell Latitude 5430" className={inp} />
          <button onClick={handleAdd} disabled={adding || !newLabel.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
            {adding ? 'Adding...' : '+ Add'}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-6">Loading...</p>
        ) : options.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No models yet for this type — add one above.</p>
        ) : (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {options.map(o => (
              <div key={o.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-lg group">
                <span className="text-sm text-gray-700 dark:text-gray-300">{o.label}</span>
                <button onClick={() => handleDelete(o.id)}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition text-sm">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        These options appear in the Model dropdown when creating or editing an asset of the selected type.
        Agents can still type a custom model manually if it's not in this list.
      </p>
    </div>
  );
}
