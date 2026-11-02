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
    title: 'On-call', desc: 'Set who is on call and when. When a critical ticket is created, the person on call now gets an in-app notification and an email.',
    newSchedule: 'New schedule', name: 'Name', namePh: 'e.g. Weekday support',
    rotation: 'Rotation', daily: 'Daily', weekly: 'Weekly', fortnightly: 'Every two weeks', custom: 'Custom (hours)', hours: 'Hours per turn',
    start: 'First rotation starts', people: 'People in the rotation (in order)', pick: 'Tick the people who take turns, then use the arrows to set the order.',
    create: 'Create schedule', save: 'Save changes', cancel: 'Cancel', edit: 'Edit', del: 'Delete', delConfirm: 'Delete this schedule and its overrides?',
    onCallNow: 'On call now', nobody: 'Nobody (check the start date and members)', until: 'until', inactive: 'Paused',
    pause: 'Pause', resume: 'Resume', overrides: 'Overrides (holidays and swaps)', noOverrides: 'No upcoming overrides.',
    addOverride: 'Add override', person: 'Person', from: 'From', to: 'To', add: 'Add',
    none: 'No schedules yet. Create one to start routing critical tickets to a person.', loading: 'Loading…',
    saved: 'Saved.', deleted: 'Deleted.', created: 'Schedule created.', pickOne: 'Choose at least one person.', needName: 'Give the schedule a name.',
    up: 'Move up', down: 'Move down', cadence: 'Every', hoursUnit: 'h',
  },
  fr: {
    title: 'Astreinte', desc: 'Définissez qui est d\'astreinte et quand. Lorsqu\'un ticket critique est créé, la personne d\'astreinte reçoit une notification dans l\'application et un e-mail.',
    newSchedule: 'Nouveau planning', name: 'Nom', namePh: 'ex. Support en semaine',
    rotation: 'Rotation', daily: 'Quotidienne', weekly: 'Hebdomadaire', fortnightly: 'Toutes les deux semaines', custom: 'Personnalisée (heures)', hours: 'Heures par tour',
    start: 'Début de la première rotation', people: 'Personnes dans la rotation (dans l\'ordre)', pick: 'Cochez les personnes qui se relaient, puis utilisez les flèches pour définir l\'ordre.',
    create: 'Créer le planning', save: 'Enregistrer', cancel: 'Annuler', edit: 'Modifier', del: 'Supprimer', delConfirm: 'Supprimer ce planning et ses remplacements ?',
    onCallNow: 'D\'astreinte maintenant', nobody: 'Personne (vérifiez la date de début et les membres)', until: 'jusqu\'au', inactive: 'En pause',
    pause: 'Mettre en pause', resume: 'Reprendre', overrides: 'Remplacements (congés et échanges)', noOverrides: 'Aucun remplacement à venir.',
    addOverride: 'Ajouter un remplacement', person: 'Personne', from: 'Du', to: 'Au', add: 'Ajouter',
    none: 'Aucun planning pour l\'instant. Créez-en un pour envoyer les tickets critiques à une personne.', loading: 'Chargement…',
    saved: 'Enregistré.', deleted: 'Supprimé.', created: 'Planning créé.', pickOne: 'Choisissez au moins une personne.', needName: 'Donnez un nom au planning.',
    up: 'Monter', down: 'Descendre', cadence: 'Toutes les', hoursUnit: 'h',
  },
};

const ROLES = ['agent', 'admin', 'super_admin', 'platform_admin'];
const toLocalInput = (d) => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fromServer = (iso) => (iso ? new Date(iso + 'Z') : null);          // server times are UTC without a suffix
const show = (iso) => { const d = fromServer(iso); return d ? d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''; };
const toServer = (local) => new Date(local).toISOString();                // local input -> UTC

export default function OnCallTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { language } = useTranslation();
  const s = STR[language] || STR.en;

  const [schedules, setSchedules] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);      // null | 'new' | schedule id
  const emptyForm = () => ({ name: '', cadence: '168', customHours: '24', start: toLocalInput(new Date()), members: [] });
  const [form, setForm] = useState(emptyForm());
  const [ovForm, setOvForm] = useState({ scheduleId: null, user_id: '', start: '', end: '' });

  const load = () =>
    apiFetch('/oncall/schedules', token).then(setSchedules).catch(e => toast.error(e.message)).finally(() => setLoading(false));

  useEffect(() => {
    load();
    apiFetch('/admin/users?skip=0&limit=500', token)
      .then(d => setAgents((d.items || []).filter(u => u.is_active && ROLES.includes(String(u.role)))))
      .catch(() => {});
  }, [token]);

  const nameOf = (id) => agents.find(a => a.id === id)?.full_name || `#${id}`;
  const hoursOf = () => (form.cadence === 'custom' ? parseInt(form.customHours, 10) || 0 : parseInt(form.cadence, 10));

  const openNew = () => { setForm(emptyForm()); setEditing('new'); };
  const openEdit = (sc) => {
    const preset = ['24', '168', '336'].includes(String(sc.rotation_hours)) ? String(sc.rotation_hours) : 'custom';
    setForm({ name: sc.name, cadence: preset, customHours: String(sc.rotation_hours), start: toLocalInput(fromServer(sc.start_at)), members: sc.members.map(m => m.id) });
    setEditing(sc.id);
  };
  const toggleMember = (id) => setForm(f => ({ ...f, members: f.members.includes(id) ? f.members.filter(x => x !== id) : [...f.members, id] }));
  const move = (id, dir) => setForm(f => {
    const i = f.members.indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= f.members.length) return f;
    const m = [...f.members]; [m[i], m[j]] = [m[j], m[i]]; return { ...f, members: m };
  });

  const submit = async () => {
    if (!form.name.trim()) { toast.error(s.needName); return; }
    if (form.members.length === 0) { toast.error(s.pickOne); return; }
    setSaving(true);
    try {
      const body = { name: form.name.trim(), rotation_hours: hoursOf(), start_at: toServer(form.start), member_ids: form.members };
      if (editing === 'new') {
        await apiFetch('/admin/oncall/schedules', token, { method: 'POST', body: JSON.stringify(body) });
        toast.success(s.created);
      } else {
        await apiFetch(`/admin/oncall/schedules/${editing}`, token, { method: 'PATCH', body: JSON.stringify(body) });
        toast.success(s.saved);
      }
      setEditing(null);
      await load();
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  const togglePause = async (sc) => {
    try {
      await apiFetch(`/admin/oncall/schedules/${sc.id}`, token, { method: 'PATCH', body: JSON.stringify({ is_active: !sc.is_active }) });
      await load();
    } catch (e) { toast.error(e.message); }
  };
  const remove = async (sc) => {
    if (!window.confirm(s.delConfirm)) return;
    try { await apiFetch(`/admin/oncall/schedules/${sc.id}`, token, { method: 'DELETE' }); toast.success(s.deleted); await load(); }
    catch (e) { toast.error(e.message); }
  };
  const addOverride = async () => {
    try {
      await apiFetch(`/admin/oncall/schedules/${ovForm.scheduleId}/overrides`, token, {
        method: 'POST', body: JSON.stringify({ user_id: parseInt(ovForm.user_id, 10), start_at: toServer(ovForm.start), end_at: toServer(ovForm.end) }),
      });
      setOvForm({ scheduleId: null, user_id: '', start: '', end: '' });
      toast.success(s.saved);
      await load();
    } catch (e) { toast.error(e.message); }
  };
  const removeOverride = async (id) => {
    try { await apiFetch(`/admin/oncall/overrides/${id}`, token, { method: 'DELETE' }); await load(); }
    catch (e) { toast.error(e.message); }
  };

  if (loading) return <div className={cardClass}><p className="text-sm text-gray-400">{s.loading}</p></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">📟 {s.title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{s.desc}</p>
        </div>
        {editing === null && <button className={btnClass} onClick={openNew}>+ {s.newSchedule}</button>}
      </div>

      {editing !== null && (
        <div className={cardClass}>
          <h4 className="font-semibold text-gray-800 dark:text-white">{editing === 'new' ? s.newSchedule : s.edit}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{s.name}</label>
              <input className={inputClass} value={form.name} placeholder={s.namePh} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className={labelClass}>{s.rotation}</label>
              <select className={inputClass} value={form.cadence} onChange={e => setForm({ ...form, cadence: e.target.value })}>
                <option value="24">{s.daily}</option>
                <option value="168">{s.weekly}</option>
                <option value="336">{s.fortnightly}</option>
                <option value="custom">{s.custom}</option>
              </select>
            </div>
            {form.cadence === 'custom' && (
              <div>
                <label className={labelClass}>{s.hours}</label>
                <input type="number" min="1" max="8760" className={inputClass} value={form.customHours} onChange={e => setForm({ ...form, customHours: e.target.value })} />
              </div>
            )}
            <div>
              <label className={labelClass}>{s.start}</label>
              <input type="datetime-local" className={inputClass} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
            </div>
          </div>
          <div>
            <label className={labelClass}>{s.people}</label>
            <p className="text-xs text-gray-400 mb-2">{s.pick}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {agents.map(a => {
                const idx = form.members.indexOf(a.id);
                return (
                  <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                      <input type="checkbox" checked={idx >= 0} onChange={() => toggleMember(a.id)} />
                      {idx >= 0 && <span className="text-xs font-semibold text-indigo-600">{idx + 1}.</span>}
                      {a.full_name}
                    </label>
                    {idx >= 0 && (
                      <span className="flex gap-1">
                        <button type="button" title={s.up} className="px-1.5 text-gray-500 hover:text-indigo-600 disabled:opacity-30" disabled={idx === 0} onClick={() => move(a.id, -1)}>↑</button>
                        <button type="button" title={s.down} className="px-1.5 text-gray-500 hover:text-indigo-600 disabled:opacity-30" disabled={idx === form.members.length - 1} onClick={() => move(a.id, 1)}>↓</button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button className={secondaryBtnClass} onClick={() => setEditing(null)}>{s.cancel}</button>
            <button className={btnClass} onClick={submit} disabled={saving}>{editing === 'new' ? s.create : s.save}</button>
          </div>
        </div>
      )}

      {schedules.length === 0 && editing === null && (
        <div className={cardClass}><p className="text-sm text-gray-500 dark:text-gray-400">{s.none}</p></div>
      )}

      {schedules.map(sc => (
        <div key={sc.id} className={cardClass}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h4 className="font-semibold text-gray-800 dark:text-white">
                {sc.name} {!sc.is_active && <span className="ml-2 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5">{s.inactive}</span>}
              </h4>
              <p className="text-xs text-gray-400">{s.cadence} {sc.rotation_hours}{s.hoursUnit} · {sc.members.map(m => m.name).join(' → ')}</p>
            </div>
            <div className="flex gap-2">
              <button className={secondaryBtnClass} onClick={() => openEdit(sc)}>{s.edit}</button>
              <button className={secondaryBtnClass} onClick={() => togglePause(sc)}>{sc.is_active ? s.pause : s.resume}</button>
              <button className={dangerBtnClass} onClick={() => remove(sc)}>{s.del}</button>
            </div>
          </div>

          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-indigo-600 dark:text-indigo-300">{s.onCallNow}</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">
              {sc.current ? <>{sc.current.name} <span className="font-normal text-gray-500">{s.until} {show(sc.current.until)}</span></> : <span className="font-normal text-gray-500">{s.nobody}</span>}
            </p>
          </div>

          <div>
            <p className={labelClass}>{s.overrides}</p>
            {sc.overrides.length === 0 ? <p className="text-xs text-gray-400">{s.noOverrides}</p> : (
              <ul className="space-y-1">
                {sc.overrides.map(o => (
                  <li key={o.id} className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200">
                    <span>{o.name}: {show(o.start_at)} → {show(o.end_at)}</span>
                    <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removeOverride(o.id)}>{s.del}</button>
                  </li>
                ))}
              </ul>
            )}
            {ovForm.scheduleId === sc.id ? (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mt-3 items-end">
                <div>
                  <label className={labelClass}>{s.person}</label>
                  <select className={inputClass} value={ovForm.user_id} onChange={e => setOvForm({ ...ovForm, user_id: e.target.value })}>
                    <option value="">—</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
                  </select>
                </div>
                <div><label className={labelClass}>{s.from}</label><input type="datetime-local" className={inputClass} value={ovForm.start} onChange={e => setOvForm({ ...ovForm, start: e.target.value })} /></div>
                <div><label className={labelClass}>{s.to}</label><input type="datetime-local" className={inputClass} value={ovForm.end} onChange={e => setOvForm({ ...ovForm, end: e.target.value })} /></div>
                <div className="flex gap-2">
                  <button className={btnClass} onClick={addOverride} disabled={!ovForm.user_id || !ovForm.start || !ovForm.end}>{s.add}</button>
                  <button className={secondaryBtnClass} onClick={() => setOvForm({ scheduleId: null, user_id: '', start: '', end: '' })}>{s.cancel}</button>
                </div>
              </div>
            ) : (
              <button className={`${secondaryBtnClass} mt-2`} onClick={() => setOvForm({ scheduleId: sc.id, user_id: '', start: '', end: '' })}>+ {s.addOverride}</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
