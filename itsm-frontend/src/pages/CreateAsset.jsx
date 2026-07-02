import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import { useUsers } from '../hooks/useUsers';
import Layout from '../components/Layout';
import CustomFieldsRenderer from '../components/CustomFieldsRenderer';

const TYPES = [
  { value: 'hardware',   label: '💻 Laptop/Desktop' },
  { value: 'software',   label: '📦 Software' },
  { value: 'network',    label: '🌐 Network' },
  { value: 'mobile',     label: '📱 Mobile' },
  { value: 'peripheral', label: '🖨️ Peripheral' },
  { value: 'saas',       label: '☁️ SaaS' },
  { value: 'cloud',      label: '🔷 Cloud' },
  { value: 'other',      label: '📋 Other' },
];

// Types that get a physical "Warranty Expiry" date (matches Freshservice's per-type field pattern)
const WARRANTY_TYPES = ['hardware', 'network', 'mobile', 'peripheral'];
// Types that get a "License Expiry" date instead
const LICENSE_TYPES  = ['software', 'saas', 'cloud'];

export default function CreateAsset() {
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { users } = useUsers(token);
  const navigate = useNavigate();
  const isAdmin = ['admin','super_admin'].includes(user?.role);

  const [form, setForm] = useState({
    name: '', type: 'hardware', model: '', serial_number: '', tag_number: '',
    status: 'available', assigned_to_id: '', location: '',
    purchase_date: '', purchase_cost: '', license_key: '', vendor: '',
    expiry_date: '', warranty_expiry: '', notes: ''
  });
  const [modelOptions, setModelOptions] = useState([]);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [customFields, setCustomFields] = useState([]);
  const [customFieldValues, setCustomFieldValues] = useState({});

  useEffect(() => {
    apiFetch('/admin/custom-fields?applies_to=asset', token)
      .then(d => setCustomFields(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [token]);

  const isWarrantyType = WARRANTY_TYPES.includes(form.type);
  const isLicenseType  = LICENSE_TYPES.includes(form.type);

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
        tag_number: form.tag_number || null,
        status: form.status,
        assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null,
        location: form.location || null,
        purchase_date: form.purchase_date || null,
        purchase_cost: form.purchase_cost ? parseFloat(form.purchase_cost) : null,
        license_key: form.license_key || null,
        vendor: form.vendor || null,
        expiry_date: isLicenseType && form.expiry_date ? form.expiry_date : null,
        warranty_expiry: isWarrantyType && form.warranty_expiry ? form.warranty_expiry : null,
        notes: form.notes || null,
        custom_fields_data: Object.keys(customFieldValues).length ? customFieldValues : null,
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
  const sectionLabel = "text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mt-2 mb-1";
  const btnPrimary   = "bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium disabled:opacity-50";
  const btnSecondary = "text-gray-600 dark:text-gray-300 hover:underline py-2";

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <div className={cardClass}>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4" style={{color: "var(--text-primary)"}}>{t('asset.createAsset')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">

            <p className={sectionLabel}>Identification</p>
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>{t('asset.serial')}</label>
                <input type="text" value={form.serial_number} onChange={e => setForm({...form, serial_number: e.target.value})} className={inputClass} placeholder="SN-12345" />
              </div>
              <div>
                <label className={labelClass}>Asset Tag</label>
                <input type="text" value={form.tag_number} onChange={e => setForm({...form, tag_number: e.target.value})} className={inputClass} placeholder="e.g. IT-0042" />
              </div>
            </div>

            <p className={sectionLabel}>Status & Assignment</p>
            <div className="grid grid-cols-2 gap-3">
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
                <label className={labelClass}>Location</label>
                <input type="text" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className={inputClass} placeholder="e.g. London HQ, Room 3" />
              </div>
            </div>

            <div>
              <label className={labelClass}>{t('asset.assignedTo')}</label>
              <select value={form.assigned_to_id} onChange={e => setForm({...form, assigned_to_id: e.target.value})} className={selectClass}>
                <option value="">{t('common.none')}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
              </select>
            </div>

            <p className={sectionLabel}>Procurement</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{t('asset.purchaseDate')}</label><input type="date" value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})} className={inputClass} /></div>
              <div><label className={labelClass}>Purchase Cost</label><input type="number" step="0.01" value={form.purchase_cost} onChange={e => setForm({...form, purchase_cost: e.target.value})} className={inputClass} placeholder="0.00" /></div>
            </div>
            <div><label className={labelClass}>{t('asset.vendor')}</label><input type="text" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})} className={inputClass} placeholder="e.g. Dell, CDW, Amazon Business" /></div>

            {/* Date field changes meaning based on asset type — matches Freshservice's dynamic-fields-per-type pattern */}
            {isWarrantyType && (
              <div>
                <label className={labelClass}>End of Warranty Date</label>
                <input type="date" value={form.warranty_expiry} onChange={e => setForm({...form, warranty_expiry: e.target.value})} className={inputClass} />
                <p className="text-xs text-gray-400 mt-1">When manufacturer/vendor warranty coverage ends.</p>
              </div>
            )}
            {isLicenseType && (
              <>
                <div><label className={labelClass}>{t('asset.licenseKey')}</label><input type="text" value={form.license_key} onChange={e => setForm({...form, license_key: e.target.value})} className={inputClass} /></div>
                <div>
                  <label className={labelClass}>License Expiry Date</label>
                  <input type="date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} className={inputClass} />
                  <p className="text-xs text-gray-400 mt-1">When the subscription or license needs renewal.</p>
                </div>
              </>
            )}

            <div><label className={labelClass}>{t('common.notes')}</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className={inputClass} rows={3} /></div>

            {customFields.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Additional Fields</p>
                <CustomFieldsRenderer
                  fields={customFields}
                  values={customFieldValues}
                  onChange={(key, val) => setCustomFieldValues(prev => ({...prev, [key]: val}))}
                />
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={submitting} className={btnPrimary}>{submitting ? 'Creating...' : t('common.create')}</button>
              <button type="button" onClick={() => navigate('/assets')} className={btnSecondary}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
