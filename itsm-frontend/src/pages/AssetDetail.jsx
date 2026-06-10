import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../utils/apiFetch';
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
    purchase_date: '', license_key: '', vendor: '', expiry_date: '', notes: ''
  });

  useEffect(() => {
    fetch(`${API}/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
        setAsset(data);
        setForm({
          name: data.name, type: data.type, serial_number: data.serial_number || '', status: data.status,
          assigned_to_id: data.assigned_to_id?.toString() || '', purchase_date: data.purchase_date ? data.purchase_date.slice(0,10) : '',
          license_key: data.license_key || '', vendor: data.vendor || '', expiry_date: data.expiry_date || '', notes: data.notes || ''
        });
      });
  }, [id, token]);

  const handleDelete = async () => {
    if (!confirm(t('asset.deleteConfirmation'))) return;
    await fetch(`${API}/assets/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    navigate('/assets');
  };

  const handleSave = async () => {
    await fetch(`${API}/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...form, assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null })
    });
    setEditing(false);
    const res = await fetch(`${API}/assets/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    setAsset(await res.json());
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
        <div className={cardClass}>
          {!editing ? (
            <>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">{asset.name}</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.type')}</dt><dd className="text-gray-900 dark:text-white">{t(`asset.${asset.type}`)}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.serial')}</dt><dd className="text-gray-900 dark:text-white">{asset.serial_number || '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.status')}</dt><dd className="text-gray-900 dark:text-white">{t(`asset.${asset.status}`)}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.assignedTo')}</dt><dd className="text-gray-900 dark:text-white">{asset.assigned_to_name || t('common.none')}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.purchaseDate')}</dt><dd className="text-gray-900 dark:text-white">{asset.purchase_date ? new Date(asset.purchase_date).toLocaleDateString() : '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.licenseKey')}</dt><dd className="text-gray-900 dark:text-white">{asset.license_key || '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.vendor')}</dt><dd className="text-gray-900 dark:text-white">{asset.vendor || '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('asset.expiryDate')}</dt><dd className="text-gray-900 dark:text-white">{asset.expiry_date ? new Date(asset.expiry_date).toLocaleDateString() : '—'}</dd></div>
                <div className="flex justify-between"><dt className="font-medium text-gray-500 dark:text-gray-400">{t('common.notes')}</dt><dd className="text-gray-900 dark:text-white">{asset.notes || '—'}</dd></div>
              </dl>
              {(user?.role === 'agent' || user?.role === 'admin') && (
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
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('asset.type')}</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className={selectClass}><option value="hardware">{t('asset.hardware')}</option><option value="software">{t('asset.software')}</option></select></div>
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
                <div><label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.notes')}</label><textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className={inputClass} rows={3} /></div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSave} className={btnPrimary}>{t('common.save')}</button>
                <button onClick={() => setEditing(false)} className={btnSecondary}>{t('common.cancel')}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
}