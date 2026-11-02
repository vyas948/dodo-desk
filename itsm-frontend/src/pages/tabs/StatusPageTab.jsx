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
    title: 'Status page', desc: 'A public page where your customers can see whether your services are working, and read updates during an incident.',
    upgrade: 'The status page is available on the Business plan and above.',
    enabled: 'Page is live', disabled: 'Page is off', pageTitle: 'Page title', pageDesc: 'Short description', save: 'Save', saved: 'Saved.',
    link: 'Public link', copy: 'Copy', copied: 'Link copied.', open: 'Open',
    overall: 'Overall status',
    components: 'Services', compName: 'Service name', compDesc: 'Description (optional)', addComp: 'Add service', noComps: 'No services yet. Add the services you want customers to see.',
    incidents: 'Incidents and maintenance', newInc: 'Post an incident', incTitle: 'Title', incBody: 'What is happening?', impact: 'Impact', status: 'Status', post: 'Post',
    noInc: 'No incidents.', addUpdate: 'Post an update', update: 'Update', del: 'Delete', delConfirm: 'Delete this? This cannot be undone.', loading: 'Loading…', cancel: 'Cancel',
    st: { operational: 'Operational', degraded: 'Degraded performance', partial_outage: 'Partial outage', major_outage: 'Major outage', maintenance: 'Under maintenance' },
    ist: { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved' },
    imp: { minor: 'Minor', major: 'Major', critical: 'Critical', maintenance: 'Maintenance' },
  },
  fr: {
    title: 'Page d\'état', desc: 'Une page publique où vos clients voient si vos services fonctionnent et lisent les mises à jour pendant un incident.',
    upgrade: 'La page d\'état est disponible à partir du forfait Business.',
    enabled: 'La page est en ligne', disabled: 'La page est désactivée', pageTitle: 'Titre de la page', pageDesc: 'Courte description', save: 'Enregistrer', saved: 'Enregistré.',
    link: 'Lien public', copy: 'Copier', copied: 'Lien copié.', open: 'Ouvrir',
    overall: 'État général',
    components: 'Services', compName: 'Nom du service', compDesc: 'Description (facultatif)', addComp: 'Ajouter un service', noComps: 'Aucun service. Ajoutez ceux que vos clients doivent voir.',
    incidents: 'Incidents et maintenance', newInc: 'Publier un incident', incTitle: 'Titre', incBody: 'Que se passe-t-il ?', impact: 'Impact', status: 'Statut', post: 'Publier',
    noInc: 'Aucun incident.', addUpdate: 'Publier une mise à jour', update: 'Mise à jour', del: 'Supprimer', delConfirm: 'Supprimer ? Action irréversible.', loading: 'Chargement…', cancel: 'Annuler',
    st: { operational: 'Opérationnel', degraded: 'Performances dégradées', partial_outage: 'Panne partielle', major_outage: 'Panne majeure', maintenance: 'En maintenance' },
    ist: { investigating: 'Analyse en cours', identified: 'Cause identifiée', monitoring: 'Surveillance', resolved: 'Résolu' },
    imp: { minor: 'Mineur', major: 'Majeur', critical: 'Critique', maintenance: 'Maintenance' },
  },
};

const DOT = { operational: 'bg-green-500', degraded: 'bg-yellow-500', partial_outage: 'bg-orange-500', major_outage: 'bg-red-500', maintenance: 'bg-blue-500' };
const fmt = (iso) => (iso ? new Date(iso + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function StatusPageTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { language } = useTranslation();
  const s = STR[language] || STR.en;

  const [data, setData] = useState(null);
  const [form, setForm] = useState({ enabled: false, title: '', description: '' });
  const [comp, setComp] = useState({ name: '', description: '' });
  const [inc, setInc] = useState({ open: false, title: '', body: '', impact: 'minor', status: 'investigating' });
  const [upd, setUpd] = useState({ id: null, status: 'investigating', body: '' });
  const [busy, setBusy] = useState(false);

  const apply = (d) => { setData(d); setForm({ enabled: !!d.enabled, title: d.title || '', description: d.description || '' }); };
  useEffect(() => { apiFetch('/admin/status-page', token).then(apply).catch(e => toast.error(e.message)); }, [token]);

  const call = async (path, method, body, okMsg) => {
    setBusy(true);
    try {
      const d = await apiFetch(path, token, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (d && d.components) apply(d); else apply(await apiFetch('/admin/status-page', token));
      if (okMsg) toast.success(okMsg);
      return true;
    } catch (e) { toast.error(e.message); return false; } finally { setBusy(false); }
  };

  if (!data) return <div className={cardClass}><p className="text-sm text-gray-400">{s.loading}</p></div>;
  if (data.plan_allowed === false) return <div className={cardClass}><h3 className="text-lg font-semibold text-gray-800 dark:text-white">🟢 {s.title}</h3><p className="text-sm text-gray-500">{s.upgrade}</p></div>;

  const confirmDel = (path) => { if (window.confirm(s.delConfirm)) call(path, 'DELETE'); };
  const copyLink = () => { try { navigator.clipboard.writeText(data.public_url); toast.success(s.copied); } catch { /* ignore */ } };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">🟢 {s.title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{s.desc}</p>
      </div>

      <div className={cardClass}>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />
          {form.enabled ? s.enabled : s.disabled}
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className={labelClass}>{s.pageTitle}</label><input className={inputClass} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
          <div><label className={labelClass}>{s.pageDesc}</label><input className={inputClass} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        </div>
        <div className="flex justify-end"><button className={btnClass} disabled={busy} onClick={() => call('/admin/status-page', 'PUT', form, s.saved)}>{s.save}</button></div>
        {data.public_url && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm min-w-0"><span className="text-gray-500">{s.link}: </span><span className="text-indigo-600 break-all">{data.public_url}</span></div>
            <div className="flex gap-2">
              <button className={secondaryBtnClass} onClick={copyLink}>{s.copy}</button>
              <a className={secondaryBtnClass} href={data.public_url} target="_blank" rel="noreferrer">{s.open}</a>
            </div>
          </div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2">
          <span>{s.overall}:</span><span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[data.overall] || 'bg-gray-400'}`} /><span className="font-medium">{s.st[data.overall] || data.overall}</span>
        </p>
      </div>

      <div className={cardClass}>
        <h4 className="font-semibold text-gray-800 dark:text-white">{s.components}</h4>
        {data.components.length === 0 && <p className="text-sm text-gray-400">{s.noComps}</p>}
        <ul className="space-y-2">
          {data.components.map(c => (
            <li key={c.id} className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${DOT[c.status] || 'bg-gray-400'}`} />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{c.name}</span>
                {c.description && <span className="text-xs text-gray-400 truncate">{c.description}</span>}
              </div>
              <div className="flex gap-2">
                <select className={`${inputClass} !w-auto`} value={c.status} disabled={busy}
                  onChange={e => call(`/admin/status-page/components/${c.id}`, 'PATCH', { status: e.target.value })}>
                  {Object.keys(s.st).map(k => <option key={k} value={k}>{s.st[k]}</option>)}
                </select>
                <button className={dangerBtnClass} onClick={() => confirmDel(`/admin/status-page/components/${c.id}`)}>{s.del}</button>
              </div>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
          <div><label className={labelClass}>{s.compName}</label><input className={inputClass} value={comp.name} onChange={e => setComp({ ...comp, name: e.target.value })} /></div>
          <div><label className={labelClass}>{s.compDesc}</label><input className={inputClass} value={comp.description} onChange={e => setComp({ ...comp, description: e.target.value })} /></div>
          <button className={btnClass} disabled={busy || !comp.name.trim()}
            onClick={async () => { if (await call('/admin/status-page/components', 'POST', { name: comp.name.trim(), description: comp.description.trim() })) setComp({ name: '', description: '' }); }}>+ {s.addComp}</button>
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-gray-800 dark:text-white">{s.incidents}</h4>
          {!inc.open && <button className={btnClass} onClick={() => setInc({ ...inc, open: true })}>+ {s.newInc}</button>}
        </div>

        {inc.open && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-600 p-4 space-y-3">
            <div><label className={labelClass}>{s.incTitle}</label><input className={inputClass} value={inc.title} onChange={e => setInc({ ...inc, title: e.target.value })} /></div>
            <div><label className={labelClass}>{s.incBody}</label><textarea rows={3} className={inputClass} value={inc.body} onChange={e => setInc({ ...inc, body: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelClass}>{s.impact}</label>
                <select className={inputClass} value={inc.impact} onChange={e => setInc({ ...inc, impact: e.target.value })}>{Object.keys(s.imp).map(k => <option key={k} value={k}>{s.imp[k]}</option>)}</select></div>
              <div><label className={labelClass}>{s.status}</label>
                <select className={inputClass} value={inc.status} onChange={e => setInc({ ...inc, status: e.target.value })}>{Object.keys(s.ist).map(k => <option key={k} value={k}>{s.ist[k]}</option>)}</select></div>
            </div>
            <div className="flex gap-2 justify-end">
              <button className={secondaryBtnClass} onClick={() => setInc({ open: false, title: '', body: '', impact: 'minor', status: 'investigating' })}>{s.cancel}</button>
              <button className={btnClass} disabled={busy || !inc.title.trim()}
                onClick={async () => { const { open, ...payload } = inc; if (await call('/admin/status-page/incidents', 'POST', payload)) setInc({ open: false, title: '', body: '', impact: 'minor', status: 'investigating' }); }}>{s.post}</button>
            </div>
          </div>
        )}

        {data.incidents.length === 0 && !inc.open && <p className="text-sm text-gray-400">{s.noInc}</p>}
        {data.incidents.map(i => (
          <div key={i.id} className="rounded-lg border border-gray-100 dark:border-gray-700 p-4 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <p className="font-medium text-gray-800 dark:text-gray-100">{i.title}</p>
                <p className="text-xs text-gray-400">{s.imp[i.impact] || i.impact} · {s.ist[i.status] || i.status} · {fmt(i.created_at)}</p>
              </div>
              <button className={dangerBtnClass} onClick={() => confirmDel(`/admin/status-page/incidents/${i.id}`)}>{s.del}</button>
            </div>
            <ul className="space-y-1">
              {(i.updates || []).map((u, idx) => (
                <li key={u.id ?? idx} className="text-sm text-gray-600 dark:text-gray-300">
                  <span className="font-medium">{s.ist[u.status] || u.status}</span> <span className="text-xs text-gray-400">{fmt(u.created_at)}</span>
                  {u.body && <div>{u.body}</div>}
                </li>
              ))}
            </ul>
            {i.status !== 'resolved' && (upd.id === i.id ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <div><label className={labelClass}>{s.status}</label>
                  <select className={inputClass} value={upd.status} onChange={e => setUpd({ ...upd, status: e.target.value })}>{Object.keys(s.ist).map(k => <option key={k} value={k}>{s.ist[k]}</option>)}</select></div>
                <div className="md:col-span-2"><label className={labelClass}>{s.update}</label><input className={inputClass} value={upd.body} onChange={e => setUpd({ ...upd, body: e.target.value })} /></div>
                <div className="flex gap-2">
                  <button className={btnClass} disabled={busy}
                    onClick={async () => { if (await call(`/admin/status-page/incidents/${i.id}/updates`, 'POST', { status: upd.status, body: upd.body })) setUpd({ id: null, status: 'investigating', body: '' }); }}>{s.post}</button>
                  <button className={secondaryBtnClass} onClick={() => setUpd({ id: null, status: 'investigating', body: '' })}>{s.cancel}</button>
                </div>
              </div>
            ) : (
              <button className={secondaryBtnClass} onClick={() => setUpd({ id: i.id, status: i.status, body: '' })}>+ {s.addUpdate}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
