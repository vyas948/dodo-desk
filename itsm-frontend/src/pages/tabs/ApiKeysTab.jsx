import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';
import { useTranslation } from '../../i18n/I18nContext';

const cardClass = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4';
const labelClass = 'block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1';
const inputClass = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const btnClass = 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtnClass = 'px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50';
const dangerBtnClass = 'px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition';

const STR = {
  en: {
    title: 'API', desc: 'Let your own tools create tickets, read them, update them and add comments. Create a key, then follow the documentation.',
    upgrade: 'API access is available on the Business plan and above.',
    docs: 'Open API documentation', base: 'Base URL', newKey: 'New API key', name: 'Name', namePh: 'e.g. Monitoring tool',
    access: 'Access', read: 'Read only', rw: 'Read and write', expiry: 'Expires', never: 'Never', d30: 'In 30 days', d90: 'In 90 days', d365: 'In 1 year',
    create: 'Create key', created: 'Key created.', copyNow: 'Copy this key now. For your security it will not be shown again.', copy: 'Copy', copied: 'Copied.', done: 'I have saved it',
    keys: 'Your keys', none: 'No keys yet.', prefix: 'Starts with', lastUsed: 'Last used', never2: 'never', revoke: 'Revoke', revokeConfirm: 'Revoke this key? Anything using it stops working immediately.',
    revoked: 'Key revoked.', st: { active: 'Active', revoked: 'Revoked', expired: 'Expired' },
    note: 'A key acts as you: it sees only your company\'s data, and every change it makes is recorded in the audit log. Keep keys secret. Limit: 120 requests per minute per key.',
    example: 'Quick test', loading: 'Loading…',
  },
  fr: {
    title: 'API', desc: 'Permettez à vos propres outils de créer, lire et modifier des tickets et d\'ajouter des commentaires. Créez une clé, puis suivez la documentation.',
    upgrade: 'L\'accès à l\'API est disponible à partir du forfait Business.',
    docs: 'Ouvrir la documentation de l\'API', base: 'URL de base', newKey: 'Nouvelle clé API', name: 'Nom', namePh: 'ex. Outil de supervision',
    access: 'Accès', read: 'Lecture seule', rw: 'Lecture et écriture', expiry: 'Expire', never: 'Jamais', d30: 'Dans 30 jours', d90: 'Dans 90 jours', d365: 'Dans 1 an',
    create: 'Créer la clé', created: 'Clé créée.', copyNow: 'Copiez cette clé maintenant. Pour votre sécurité, elle ne sera plus affichée.', copy: 'Copier', copied: 'Copié.', done: 'Je l\'ai enregistrée',
    keys: 'Vos clés', none: 'Aucune clé pour l\'instant.', prefix: 'Commence par', lastUsed: 'Dernière utilisation', never2: 'jamais', revoke: 'Révoquer', revokeConfirm: 'Révoquer cette clé ? Tout ce qui l\'utilise cessera de fonctionner immédiatement.',
    revoked: 'Clé révoquée.', st: { active: 'Active', revoked: 'Révoquée', expired: 'Expirée' },
    note: 'Une clé agit comme vous : elle ne voit que les données de votre entreprise, et chaque modification est enregistrée dans le journal d\'audit. Gardez les clés secrètes. Limite : 120 requêtes par minute et par clé.',
    example: 'Test rapide', loading: 'Chargement…',
  },
};

const fmt = (iso) => (iso ? new Date(iso + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function ApiKeysTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { language } = useTranslation();
  const s = STR[language] || STR.en;

  const [data, setData] = useState(null);
  const [form, setForm] = useState({ name: '', scopes: 'read', expires_days: '0' });
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => apiFetch('/admin/api-keys', token).then(setData).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, [token]);

  const copy = (text) => { try { navigator.clipboard.writeText(text); toast.success(s.copied); } catch { /* ignore */ } };

  const create = async () => {
    setBusy(true);
    try {
      const r = await apiFetch('/admin/api-keys', token, { method: 'POST', body: JSON.stringify({ name: form.name, scopes: form.scopes, expires_days: parseInt(form.expires_days, 10) || 0 }) });
      setFresh(r.key); setForm({ name: '', scopes: 'read', expires_days: '0' }); toast.success(s.created); await load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const revoke = async (k) => {
    if (!window.confirm(s.revokeConfirm)) return;
    try { await apiFetch(`/admin/api-keys/${k.id}`, token, { method: 'DELETE' }); toast.success(s.revoked); await load(); }
    catch (e) { toast.error(e.message); }
  };

  if (!data) return <div className={cardClass}><p className="text-sm text-gray-400">{s.loading}</p></div>;

  const curl = `curl ${data.base_url}/tickets?limit=5 \\\n  -H "Authorization: Bearer ddk_YOUR_KEY"`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">🔑 {s.title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 max-w-2xl">{s.desc}</p>
        </div>
        <a className={btnClass} href={data.docs_url} target="_blank" rel="noreferrer">{s.docs} ↗</a>
      </div>

      {!data.plan_allowed && <div className={cardClass}><p className="text-sm text-amber-600 dark:text-amber-400">{s.upgrade}</p></div>}

      {data.plan_allowed && (
        <>
          <div className={cardClass}>
            <p className="text-sm text-gray-600 dark:text-gray-300"><span className="text-gray-400">{s.base}: </span><code className="text-indigo-600 break-all">{data.base_url}</code></p>
            <p className="text-xs text-gray-500">{s.note}</p>
          </div>

          {fresh && (
            <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-5 space-y-3">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">⚠️ {s.copyNow}</p>
              <code className="block text-xs bg-white dark:bg-gray-800 rounded-lg px-3 py-2 break-all">{fresh}</code>
              <div className="flex gap-2">
                <button className={btnClass} onClick={() => copy(fresh)}>{s.copy}</button>
                <button className={secondaryBtnClass} onClick={() => setFresh(null)}>{s.done}</button>
              </div>
            </div>
          )}

          <div className={cardClass}>
            <h4 className="font-semibold text-gray-800 dark:text-white">{s.newKey}</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div><label className={labelClass}>{s.name}</label><input className={inputClass} value={form.name} placeholder={s.namePh} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className={labelClass}>{s.access}</label>
                <select className={inputClass} value={form.scopes} onChange={e => setForm({ ...form, scopes: e.target.value })}>
                  <option value="read">{s.read}</option><option value="read_write">{s.rw}</option></select></div>
              <div><label className={labelClass}>{s.expiry}</label>
                <select className={inputClass} value={form.expires_days} onChange={e => setForm({ ...form, expires_days: e.target.value })}>
                  <option value="0">{s.never}</option><option value="30">{s.d30}</option><option value="90">{s.d90}</option><option value="365">{s.d365}</option></select></div>
            </div>
            <div className="flex justify-end"><button className={btnClass} disabled={busy || !form.name.trim()} onClick={create}>{s.create}</button></div>
          </div>

          <div className={cardClass}>
            <h4 className="font-semibold text-gray-800 dark:text-white">{s.keys}</h4>
            {data.keys.length === 0 && <p className="text-sm text-gray-400">{s.none}</p>}
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.keys.map(k => (
                <li key={k.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{k.name}
                      <span className={`ml-2 text-xs rounded-full px-2 py-0.5 ${k.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-700'}`}>{s.st[k.status] || k.status}</span>
                      <span className="ml-2 text-xs text-gray-400">{k.scopes === 'read_write' ? s.rw : s.read}</span></p>
                    <p className="text-xs text-gray-400">{s.prefix} <code>{k.prefix}…</code> · {s.lastUsed}: {k.last_used_at ? fmt(k.last_used_at) : s.never2}{k.expires_at ? ` · ${s.expiry}: ${fmt(k.expires_at)}` : ''}</p>
                  </div>
                  {k.status === 'active' && <button className={dangerBtnClass} onClick={() => revoke(k)}>{s.revoke}</button>}
                </li>
              ))}
            </ul>
          </div>

          <div className={cardClass}>
            <div className="flex items-center justify-between"><h4 className="font-semibold text-gray-800 dark:text-white">{s.example}</h4>
              <button className={secondaryBtnClass} onClick={() => copy(curl)}>{s.copy}</button></div>
            <pre className="text-xs bg-gray-50 dark:bg-gray-900/40 rounded-lg p-3 overflow-x-auto">{curl}</pre>
          </div>
        </>
      )}
    </div>
  );
}
