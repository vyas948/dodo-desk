import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import { useUsers } from '../hooks/useUsers';
import Layout from '../components/Layout';
import { API } from '../api';

export default function AssetDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { users } = useUsers(token);
  const navigate = useNavigate();
  const [asset, setAsset] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: '', type: 'hardware', serial_number: '', status: 'available', assigned_to_id: '',
    purchase_date: '', license_key: '', vendor: '', expiry_date: '', notes: '',
    location: '', purchase_cost: '', warranty_expiry: '', contract_number: '',
    quantity: 1, seats_total: '', maintenance_date: '', tag_number: '',
  });
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token || !id) return;
    fetch(`${API}/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setAsset(data);
        setForm({
          name: data.name, type: data.type, serial_number: data.serial_number || '', status: data.status,
          assigned_to_id: data.assigned_to_id?.toString() || '', purchase_date: data.purchase_date ? data.purchase_date.slice(0,10) : '',
          license_key: data.license_key || '', vendor: data.vendor || '', expiry_date: data.expiry_date || '', notes: data.notes || '',
          location: data.location || '', purchase_cost: data.purchase_cost || '',
          warranty_expiry: data.warranty_expiry || '', contract_number: data.contract_number || '',
          quantity: data.quantity || 1, seats_total: data.seats_total || '',
          maintenance_date: data.maintenance_date ? data.maintenance_date.slice(0,16) : '',
          tag_number: data.tag_number || '',
        });
      });
    // Fetch users for assignment dropdown
    fetch(`${API}/users/`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setUsers(Array.isArray(data) ? data : (data.items ?? [])))
      .catch(() => {});
  }, [id, token]);  const fetchHistory = () => {
    setLoadingHistory(true);
    fetch(`${API}/assets/${id}/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  };

  useEffect(() => { if (token && id) fetchHistory(); }, [id, token]);

  const handleDelete = async () => {
    if (!confirm(t('asset.deleteConfirmation'))) return;
    await fetch(`${API}/assets/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    navigate('/assets');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/assets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null })
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Failed to save'); }
      toast.success('Asset updated successfully.');
      setEditing(false);
      const updated = await fetch(`${API}/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      setAsset(await updated.json());
      fetchHistory();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!asset) return <Layout><div className="p-10 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div></Layout>;

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const selectClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const btnPrimary = "bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition";
  const btnDanger = "bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition";
  const btnSecondary = "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition";

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <Link to="/assets" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 mb-4 transition">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Assets
        </Link>
        <div className={cardClass}>
          {!editing ? (
            <>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4" style={{color: "var(--text-primary)"}}>{asset.name}</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.type')}</dt><dd className="text-gray-900 dark:text-white">{t(`asset.${asset.type}`)}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.serial')}</dt><dd className="text-gray-900 dark:text-white">{asset.serial_number || '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.status')}</dt><dd className="text-gray-900 dark:text-white">{t(`asset.${asset.status}`)}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.assignedTo')}</dt><dd className="text-gray-900 dark:text-white">{asset.assigned_to_name || t('common.none')}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.purchaseDate')}</dt><dd className="text-gray-900 dark:text-white">{asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString() : '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.licenseKey')}</dt><dd className="text-gray-900 dark:text-white">{asset.license_key || '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.vendor')}</dt><dd className="text-gray-900 dark:text-white">{asset.vendor || '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.expiryDate')}</dt><dd className="text-gray-900 dark:text-white">{asset.expiry_date ? new Date(asset.expiry_date).toLocaleDateString() : '—'}</dd></div>
                {asset.location && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Location</dt><dd className="text-gray-900 dark:text-white">{asset.location}</dd></div>}
                {asset.tag_number && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Asset Tag</dt><dd className="text-gray-900 dark:text-white font-mono">{asset.tag_number}</dd></div>}
                {asset.contract_number && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Contract / PO</dt><dd className="text-gray-900 dark:text-white">{asset.contract_number}</dd></div>}
                {asset.purchase_cost && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Purchase Cost</dt><dd className="text-gray-900 dark:text-white">${asset.purchase_cost}</dd></div>}
                {asset.warranty_expiry && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Warranty Expiry</dt><dd className={`${new Date(asset.warranty_expiry) < new Date() ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>{new Date(asset.warranty_expiry).toLocaleDateString()}</dd></div>}
                {asset.seats_total && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Seats</dt><dd className="text-gray-900 dark:text-white">{asset.seats_used || 0} / {asset.seats_total} used</dd></div>}
                {asset.maintenance_date && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Next Maintenance</dt><dd className={`${new Date(asset.maintenance_date) < new Date() ? 'text-amber-500 font-medium' : 'text-gray-900 dark:text-white'}`}>{new Date(asset.maintenance_date).toLocaleString()}</dd></div>}
                {asset.ticket_count > 0 && <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">Linked Tickets</dt><dd className="text-red-500 font-medium">{asset.ticket_count} incidents</dd></div>}
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('common.notes')}</dt><dd className="text-gray-900 dark:text-white">{asset.notes || '—'}</dd></div>
              </dl>
              {(user?.role === 'agent' || (user?.role === 'admin' || user?.role === 'super_admin')) && (
                <div className="mt-6 flex gap-2">
                  <button onClick={() => setEditing(true)} className={btnPrimary}>{t('common.edit')}</button>
                  <button onClick={handleDelete} className={btnDanger}>{t('common.delete')}</button>
                </div>
              )}
            </>
          ) : (
            <>
              <h3 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">{t('asset.editAsset')}</h3>
              <div className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.name')}</label><input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.type')}</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className={selectClass}>
                  <option value="hardware">{t('asset.hardware')}</option>
                  <option value="software">{t('asset.software')}</option>
                  <option value="network">🌐 Network</option>
                  <option value="mobile">📱 Mobile</option>
                  <option value="peripheral">🖨️ Peripheral</option>
                  <option value="saas">☁️ SaaS</option>
                  <option value="cloud">🔷 Cloud</option>
                  <option value="other">📋 Other</option>
                </select></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.serial')}</label><input type="text" value={form.serial_number} onChange={e => setForm({...form, serial_number: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.status')}</label><select value={form.status} onChange={e => setForm({...form, status: e.target.value})} className={selectClass}><option value="available">{t('asset.available')}</option><option value="assigned">{t('asset.assigned')}</option><option value="maintenance">{t('asset.maintenance')}</option><option value="retired">{t('asset.retired')}</option></select></div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.assignedTo')}</label>
                  <select value={form.assigned_to_id} onChange={e => setForm({...form, assigned_to_id: e.target.value})} className={selectClass}>
                    <option value="">{t('common.none')}</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                    ))}
                  </select>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.purchaseDate')}</label><input type="date" value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.licenseKey')}</label><input type="text" value={form.license_key} onChange={e => setForm({...form, license_key: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.vendor')}</label><input type="text" value={form.vendor} onChange={e => setForm({...form, vendor: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.expiryDate')}</label><input type="date" value={form.expiry_date} onChange={e => setForm({...form, expiry_date: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label><input type="text" value={form.location} onChange={e => setForm({...form, location: e.target.value})} className={inputClass} placeholder="e.g. Room 101, Building A" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Asset Tag / Barcode</label><input type="text" value={form.tag_number} onChange={e => setForm({...form, tag_number: e.target.value})} className={inputClass} placeholder="e.g. TAG-001" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contract / PO Number</label><input type="text" value={form.contract_number} onChange={e => setForm({...form, contract_number: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purchase Cost ($)</label><input type="number" value={form.purchase_cost} onChange={e => setForm({...form, purchase_cost: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Warranty Expiry</label><input type="date" value={form.warranty_expiry} onChange={e => setForm({...form, warranty_expiry: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label><input type="number" value={form.quantity} min={1} onChange={e => setForm({...form, quantity: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Total Seats (software)</label><input type="number" value={form.seats_total} onChange={e => setForm({...form, seats_total: e.target.value})} className={inputClass} placeholder="Leave blank if N/A" /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Next Maintenance Date</label><input type="datetime-local" value={form.maintenance_date} onChange={e => setForm({...form, maintenance_date: e.target.value})} className={inputClass} /></div>
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.notes')}</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className={inputClass} rows={3} /></div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSave} disabled={saving} className={btnPrimary + " disabled:opacity-50"}>
                  {saving ? 'Saving...' : t('common.save')}
                </button>
                <button onClick={() => setEditing(false)} className={btnSecondary}>{t('common.cancel')}</button>
              </div>
            </>
          )}
        </div>

        {/* ── Asset Lifecycle History ── */}
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4">📋 Asset Lifecycle History</h3>
          {loadingHistory ? (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No history yet. Purchases, assignments, status, and location changes will appear here.</p>
          ) : (
            <ol className="relative border-l border-gray-200 dark:border-gray-700 space-y-4 pl-4">
              {history.map(h => {
                const DOT_COLOR = {
                  purchased: 'bg-emerald-400 dark:bg-emerald-600',
                  assigned: 'bg-indigo-400 dark:bg-indigo-600',
                  unassigned: 'bg-gray-400 dark:bg-gray-600',
                  status_changed: 'bg-amber-400 dark:bg-amber-600',
                  location_changed: 'bg-blue-400 dark:bg-blue-600',
                }[h.action] || 'bg-indigo-400 dark:bg-indigo-600';
                const ICON = {
                  purchased: '🛒', assigned: '👤', unassigned: '🚫',
                  status_changed: '🔄', location_changed: '📍',
                }[h.action] || '•';
                return (
                  <li key={h.id} className="ml-2">
                    <span className={`absolute -left-1.5 w-3 h-3 rounded-full ${DOT_COLOR} border-2 border-white dark:border-gray-800`}></span>
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {h.action === 'purchased' && (
                            <>{ICON} Asset purchased{h.note && <span className="font-normal text-gray-500 dark:text-gray-400"> — {h.note.replace('Asset created', '').replace(/^ —/, '').trim() || 'added to inventory'}</span>}</>
                          )}
                          {h.action === 'assigned' && (
                            <>{ICON} Assigned to <span className="font-semibold text-indigo-600 dark:text-indigo-400">{h.to_user || 'Unknown'}</span>
                            {h.from_user && <> (was: {h.from_user})</>}</>
                          )}
                          {h.action === 'unassigned' && (
                            <>{ICON} Unassigned from <span className="font-semibold text-gray-600 dark:text-gray-400">{h.from_user || 'Unknown'}</span></>
                          )}
                          {h.action === 'status_changed' && (
                            <>{ICON} Status changed: <span className="font-semibold">{h.note}</span></>
                          )}
                          {h.action === 'location_changed' && (
                            <>{ICON} Location changed: <span className="font-semibold">{h.note}</span></>
                          )}
                        </p>
                        {h.changed_by && <p className="text-xs text-gray-400 mt-0.5">by {h.changed_by}</p>}
                      </div>
                      <span className="text-xs text-gray-400 ml-4 flex-shrink-0">
                        {new Date(h.changed_at).toLocaleString()}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </Layout>
  );
}