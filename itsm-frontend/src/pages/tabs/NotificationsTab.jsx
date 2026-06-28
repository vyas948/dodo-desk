import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

const NOTIFICATION_EVENTS = [
  { key: 'ticket_assigned',       label: 'A ticket is assigned to me',         icon: '🎫' },
  { key: 'ticket_commented',      label: 'Someone comments on my ticket',      icon: '💬' },
  { key: 'ticket_status_changed', label: 'A ticket status changes',            icon: '🔄' },
  { key: 'ticket_sla_breach',     label: 'A ticket breaches SLA',              icon: '⚠️' },
  { key: 'ticket_mentioned',      label: 'I am @mentioned in an internal note',icon: '📣' },
  { key: 'change_approved',       label: 'A change request is approved',       icon: '✅' },
  { key: 'change_rejected',       label: 'A change request is rejected',       icon: '❌' },
];

const EMAIL_EVENTS = [
  { key: 'email_ticket_assigned',  label: 'Ticket assigned to me',  icon: '📧' },
  { key: 'email_ticket_commented', label: 'New comment on ticket',  icon: '📧' },
  { key: 'email_sla_breach',       label: 'SLA breach alert',        icon: '📧' },
];

function Toggle({ checked, onChange }) {
  return (
    <div className={`relative w-10 h-5 rounded-full cursor-pointer transition ${checked ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`} onClick={onChange}>
      <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </div>
  );
}

export default function NotificationsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/users/me/notification-prefs', token).then(setPrefs).catch(() => {});
  }, [token]);

  const toggle = (key) => setPrefs(p => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch('/users/me/notification-prefs', token, { method:'PUT', body:JSON.stringify(prefs) }); toast.success('Notification preferences saved'); }
    catch(e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const card = "bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">🔔 Notification Preferences</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Choose which events trigger in-app and email notifications for you</p>
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-3">🔔 In-App Notifications</h4>
        <div className="space-y-3">
          {NOTIFICATION_EVENTS.map(ev => (
            <div key={ev.key} className="flex items-center justify-between py-1">
              <span className="text-sm text-gray-700 dark:text-gray-300">{ev.icon} {ev.label}</span>
              <Toggle checked={!!prefs[ev.key]} onChange={() => toggle(ev.key)} />
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-3">📧 Email Notifications</h4>
        <div className="space-y-3">
          {EMAIL_EVENTS.map(ev => (
            <div key={ev.key} className="flex items-center justify-between py-1">
              <span className="text-sm text-gray-700 dark:text-gray-300">{ev.icon} {ev.label}</span>
              <Toggle checked={!!prefs[ev.key]} onChange={() => toggle(ev.key)} />
            </div>
          ))}
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
