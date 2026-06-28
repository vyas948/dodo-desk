import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const TIMEZONES = [
  'UTC','Africa/Nairobi','America/Chicago','America/Los_Angeles','America/New_York',
  'America/Sao_Paulo','Asia/Colombo','Asia/Dubai','Asia/Hong_Kong','Asia/Karachi',
  'Asia/Kolkata','Asia/Kuala_Lumpur','Asia/Seoul','Asia/Shanghai','Asia/Singapore',
  'Asia/Tokyo','Australia/Melbourne','Australia/Sydney','Europe/Amsterdam',
  'Europe/Berlin','Europe/London','Europe/Madrid','Europe/Moscow','Europe/Paris',
  'Indian/Mauritius','Pacific/Auckland',
];
const HOURS = Array.from({length:25},(_,i)=>i);
const fmtHr = h => h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h-12}:00 PM`;

export default function BusinessHoursTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [cfg, setCfg] = useState({ enabled: false, start_hour: 9, end_hour: 17, working_days: '0,1,2,3,4', timezone: 'UTC' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { apiFetch('/admin/business-hours', token).then(setCfg).catch(() => {}); }, [token]);

  const toggleDay = (idx) => {
    const days = cfg.working_days ? cfg.working_days.split(',').map(Number) : [];
    const next = days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx].sort();
    setCfg({ ...cfg, working_days: next.join(',') });
  };

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch('/admin/business-hours', token, { method:'PUT', body:JSON.stringify(cfg) }); toast.success('Business hours saved'); }
    catch(e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const inp = "border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const card = "bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4";

  const activeDays = cfg.working_days ? cfg.working_days.split(',').map(Number) : [];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">⏰ Business Hours</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">SLA timers only count down during business hours when enabled</p>
      </div>

      <div className={card}>
        <label className="flex items-center gap-3 cursor-pointer">
          <div className={`relative w-11 h-6 rounded-full transition ${cfg.enabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
               onClick={() => setCfg({...cfg, enabled: !cfg.enabled})}>
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${cfg.enabled ? 'translate-x-5' : ''}`} />
          </div>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable business hours for SLA calculation</span>
        </label>
        <p className="text-xs text-gray-400">When disabled, SLA timers run 24/7 including weekends and holidays</p>
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-800 dark:text-white">Timezone</h4>
        <select value={cfg.timezone} onChange={e => setCfg({...cfg, timezone: e.target.value})} className={inp + " w-full"}>
          {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-800 dark:text-white">Working Hours</h4>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start Time</label>
            <select value={cfg.start_hour} onChange={e => setCfg({...cfg, start_hour: parseInt(e.target.value)})} className={inp}>
              {HOURS.filter(h => h < (cfg.end_hour ?? 17)).map(h => <option key={h} value={h}>{fmtHr(h)}</option>)}
            </select>
          </div>
          <span className="text-gray-400 self-end pb-2">to</span>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End Time</label>
            <select value={cfg.end_hour} onChange={e => setCfg({...cfg, end_hour: parseInt(e.target.value)})} className={inp}>
              {HOURS.filter(h => h > (cfg.start_hour ?? 9)).map(h => <option key={h} value={h}>{fmtHr(h)}</option>)}
            </select>
          </div>
          <div className="text-xs text-gray-400 self-end pb-2">{cfg.end_hour - cfg.start_hour} hours/day</div>
        </div>
      </div>

      <div className={card}>
        <h4 className="font-medium text-gray-800 dark:text-white">Working Days</h4>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((day, idx) => (
            <button key={idx} type="button" onClick={() => toggleDay(idx)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition border ${activeDays.includes(idx) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-indigo-400'}`}>
              {day.slice(0,3)}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">{activeDays.length} working days per week · {activeDays.length * (cfg.end_hour - cfg.start_hour)} working hours per week</p>
      </div>

      <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
        {saving ? 'Saving...' : 'Save Business Hours'}
      </button>
    </div>
  );
}
