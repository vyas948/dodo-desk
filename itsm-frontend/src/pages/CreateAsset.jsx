import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import { useUsers } from '../hooks/useUsers';
import Layout from '../components/Layout';

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

export default function CreateAsset() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { users } = useUsers(token);
  const navigate = useNavigate();
  const isAdmin = ['admin','super_admin'].includes(user?.role);

  const [form, setForm] = useState({
    name: '', type: 'hardware', model: '', serial_number: '', status: 'available', assigned_to_id: '',
    purchase_date: '', license_key: '', vendor: '', expiry_date: '', notes: ''
  });
  const [modelOptions, setModelOptions] = useState([]);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch model options whenever the selected type changes
  useEffect(() => {
    apiFetch(`/asset-model-options/?asset_type=${form.type}`, token)
      .then(opts => { setModelOptions(opts || []); setUseCustomModel(false); setForm(f => ({...f, model: ''})); })
      .catch(() => setModelOptions([]));
  }, [form.type, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        model: form.model || null,
        serial_number: form.serial_number || null,
        status: form.status,
        assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null,
        purchase_date: form.purchase_date || null,
        license_key: form.license_key || null,
        vendor: form.vendor || null,
        expiry_date: form.expiry_date || null,
        notes: form.notes || null,
      };
      await apiFetch('/assets/', token, { method: 'POST', body: JSON.stringify(payload) });
      toast.success('Asset created successfully.');
      navigate('/assets');
    } catch (err) {
      toast.error(err.message || 'Failed to create asset.');
    } finally {
      setSubmitting(false);
    }
  };

  const cardClass    = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass   = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const selectClass  = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const labelClass   = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const btnPrimary   = "bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium disabled:opacity-50";
  const btnSecondary = "text-gray-600 dark:text-gray-300 hover:underline py-2";

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <div className={cardClass}>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4" style={{color: "var(--text-primary)"}}>{t('asset.createAsset')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelClass}>{t('common.name')}</label>
              <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required className={inputClass} placeholder="e.g. Marketing laptop #4" />
            </div>

            <div>
              <label className={labelClass}>{t('asset.type')}</label>
              <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className={selectClass}>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            {/* Model — admin-managed dropdown, scoped to selected type */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={labelClass + " mb-0"}>Model / Manufacturer</label>
                {isAdmin && (
                  <Link to="/settings?tab=assetmodels" className="text-xs text-indigo-500 hover:underline">+ Manage list</Link>
                )}
              </div>
              {!useCustomModel ? (
                <>
                  <select value={form.model} onChange={e => {
                            if (e.target.value === '__custom__') { setUseCustomModel(true); setForm(f => ({...f, model: ''})); }
                            else setForm(f => ({...f, model: e.target.value}));
                          }} className={selectClass}>
                    <option value="">— Select model —</option>
                    {modelOptions.map(o => <option key={o.id} value={o.label}>{o.label}</option>)}
                    <option value="__custom__">✏️ Other / type manually...</option>
                  </select>
                  {modelOptions.length === 0 && (
                    <p className="text-xs text-gray-400 mt-1">No models configured for this type yet{isAdmin ? ' — add some via Settings' : ''}.</p>
                  )}
                </>
              ) : (
                <div className="flex gap-2">
                  <input type="text" value={form.model} onChange={e => setForm({...form, model: e.target.value})}
                         placeholder="Type model name..." className={inputClass} autoFocus />
                  <button type="button" onClick={() => { setUseCustomModel(false); setForm(f => ({...f, model: ''})); }}
                          className="text-xs text-gray-400 hover:text-gray-600 px-2 flex-shrink-0">Use list</button>
                </div>
              )}
            </div>

            <div>
              <label className={labelClass}>{t('asset.serial')}</label>
              <input type="text" value={form.serial_number} onChange={e => setForm({...form, serial_number: e.target.value})} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>{t('asset.status')}</label>
              <select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className={selectClass}>
                <option value="available">{t('asset.available')}</option>
                <option value="assigned">{t('asset.assigned')}</option>
                <option value="maintenance">{t('asset.maintenance')}</option>
                <option value="retired">{t('asset.retired')}</option>
              </select>
            </div>

            <div>
              <label className={labelClass}>{t('asset.assignedTo')}</label>
              <select value={form.assigned_to_id} onChange={e => setForm({...form, assigned_to_id: e.target.value})} className={selectClass}>
                <option value="">{t('common.none')}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
              </select>
            </div>

            <div><label className={labelClass}>{t('asset.purchaseDate')}</label><input type="date" value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})} className={inputClass} /></div>
            <div><label className={labelClass}>{t('asset.licenseKey')}</label><input type="text" value={form.license_key} onChange={e => setForm({...form, license_key: e.target.value})} className={inputClass} /></div>
            <div><label className={labelClass}>{t('asset.vendor')}</label><input type="text" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})} className={inputClass} /></div>
            <div><label className={labelClass}>{t('asset.expiryDate')}</label><input type="date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} className={inputClass} /></div>
            <div><label className={labelClass}>{t('common.notes')}</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className={inputClass} rows={3} /></div>

            <div className="flex gap-3">
              <button type="submit" disabled={submitting} className={btnPrimary}>{submitting ? 'Creating...' : t('common.create')}</button>
              <button type="button" onClick={() => navigate('/assets')} className={btnSecondary}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
