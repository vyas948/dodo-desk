import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';
import { useTranslation } from '../../i18n/I18nContext';

const cardClass = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4';
const labelClass = 'block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1';
const inputClass = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const btnClass = 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtnClass = 'px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition';

export default function WhatsAppTab() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({
    whatsapp_enabled: false,
    whatsapp_phone_number_id: '',
    whatsapp_business_account_id: '',
    whatsapp_access_token: '',
    whatsapp_display_number: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiFetch('/admin/whatsapp-config', token)
      .then(data => {
        setCfg(data);
        setForm(f => ({
          ...f,
          whatsapp_enabled: !!data.whatsapp_enabled,
          whatsapp_phone_number_id: data.whatsapp_phone_number_id || '',
          whatsapp_business_account_id: data.whatsapp_business_account_id || '',
          whatsapp_display_number: data.whatsapp_display_number || '',
          // access token is write-only — never populated from GET
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      // Don't overwrite a saved token with an empty field if the admin didn't touch it
      if (!body.whatsapp_access_token) delete body.whatsapp_access_token;
      const updated = await apiFetch('/admin/whatsapp-config', token, {
        method: 'PUT', body: JSON.stringify(body),
      });
      setCfg(c => ({ ...c, ...updated }));
      setForm(f => ({ ...f, whatsapp_access_token: '' }));
      toast.success(t('whatsapp.saved') || 'WhatsApp settings saved.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateToken = async () => {
    setGenLoading(true);
    try {
      const data = await apiFetch('/admin/whatsapp-config/generate-verify-token', token, { method: 'POST' });
      setCfg(c => ({ ...c, whatsapp_verify_token: data.whatsapp_verify_token }));
      toast.success(t('whatsapp.tokenGenerated') || 'Verify token generated.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleCopy = (value) => {
    navigator.clipboard.writeText(value || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return <div className={cardClass}><p className="text-sm text-gray-400">{t('common.loading') || 'Loading…'}</p></div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">📱 {t('whatsapp.title') || 'WhatsApp'}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {t('whatsapp.desc') || 'Let customers open tickets by messaging your WhatsApp Business number. Incoming messages are triaged by AI and auto-assigned to the right agent.'}
        </p>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-white">{t('whatsapp.enableTitle') || 'Enable WhatsApp ticketing'}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('whatsapp.enableDesc') || 'Turn on once your credentials below are saved and the webhook is configured in Meta.'}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={form.whatsapp_enabled}
              onChange={e => setForm({ ...form, whatsapp_enabled: e.target.checked })}
            />
            <div className="w-11 h-6 bg-gray-200 dark:bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:bg-indigo-600 transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>{t('whatsapp.phoneNumberId') || 'Phone Number ID'}</label>
            <input
              type="text"
              value={form.whatsapp_phone_number_id}
              onChange={e => setForm({ ...form, whatsapp_phone_number_id: e.target.value })}
              placeholder="e.g. 1334989443030103"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('whatsapp.businessAccountId') || 'Business Account ID'}</label>
            <input
              type="text"
              value={form.whatsapp_business_account_id}
              onChange={e => setForm({ ...form, whatsapp_business_account_id: e.target.value })}
              placeholder="e.g. 2071822826807810"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('whatsapp.displayNumber') || 'Display Phone Number'}</label>
            <input
              type="text"
              value={form.whatsapp_display_number}
              onChange={e => setForm({ ...form, whatsapp_display_number: e.target.value })}
              placeholder="+1 555 158 2548"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{t('whatsapp.accessToken') || 'Access Token'}</label>
            <input
              type="password"
              value={form.whatsapp_access_token}
              onChange={e => setForm({ ...form, whatsapp_access_token: e.target.value })}
              placeholder={cfg?.whatsapp_access_token_set ? '••••••••  (already set — leave blank to keep)' : 'Paste your Meta access token'}
              className={inputClass}
              autoComplete="new-password"
            />
            {cfg?.whatsapp_access_token_set && !form.whatsapp_access_token && (
              <p className="text-xs text-gray-400 mt-1">{t('whatsapp.tokenSetHint') || 'A token is already saved. Leave blank to keep it, or paste a new one to replace it.'}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button className={btnClass} onClick={handleSave} disabled={saving}>
            {saving ? (t('common.saving') || 'Saving…') : (t('common.save') || 'Save')}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h4 className="font-semibold text-gray-800 dark:text-white">{t('whatsapp.webhookTitle') || 'Meta webhook setup'}</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('whatsapp.webhookDesc') || 'In your Meta App Dashboard → WhatsApp → Configuration, set the Callback URL and Verify Token below, then subscribe to the "messages" field. This is configured once — it works for every company using this DodoDesk instance.'}
        </p>

        <div>
          <label className={labelClass}>{t('whatsapp.callbackUrl') || 'Callback URL'}</label>
          <div className="flex items-center gap-2">
            <input type="text" readOnly value={cfg?.webhook_url || ''} className={`${inputClass} bg-gray-50 dark:bg-gray-900 font-mono text-xs`} />
            <button className={secondaryBtnClass} onClick={() => handleCopy(cfg?.webhook_url)}>
              {copied ? (t('whatsapp.copied') || 'Copied!') : (t('whatsapp.copy') || 'Copy')}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass}>{t('whatsapp.verifyToken') || 'Verify Token'}</label>
          <div className="flex items-center gap-2">
            <input type="text" readOnly value={cfg?.whatsapp_verify_token || ''} placeholder={t('whatsapp.noTokenYet') || 'No token generated yet'} className={`${inputClass} bg-gray-50 dark:bg-gray-900 font-mono text-xs`} />
            <button className={secondaryBtnClass} onClick={() => handleCopy(cfg?.whatsapp_verify_token)} disabled={!cfg?.whatsapp_verify_token}>
              {t('whatsapp.copy') || 'Copy'}
            </button>
            <button className={secondaryBtnClass} onClick={handleGenerateToken} disabled={genLoading}>
              {genLoading ? (t('common.loading') || 'Loading…') : (t('whatsapp.generateToken') || 'Generate')}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">{t('whatsapp.verifyTokenHint') || 'Generating a new token replaces the old one — you\'ll need to update it in Meta too.'}</p>
        </div>
      </div>
    </div>
  );
}
