import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';
import { useTranslation } from '../../i18n/I18nContext';

const cardClass = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4';
const labelClass = 'block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1';
const inputClass = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const btnClass = 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtnClass = 'px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed';

// Plain-language hints for the Meta error codes an admin is most likely to hit.
function explainMetaError(err, tr) {
  if (!err) return null;
  const code = err.code;
  const sub = err.error_subcode;
  if (code === 190) return tr('whatsapp.errToken', 'The access token is invalid or has expired. Generate a new one in Meta and save it above.');
  if (code === 100 && sub === 33) return tr('whatsapp.errNoAccess', 'The token has no permission on this Phone Number ID, or the ID is wrong. Use a System User token that has this WhatsApp account assigned with full control.');
  if (code === 100) return tr('whatsapp.errParam', 'Meta rejected a parameter. Check the Phone Number ID and the recipient number.');
  if (code === 131047) return tr('whatsapp.errWindow', 'The recipient has not messaged this number in the last 24 hours, so free-form text is not allowed. Ask them to send a message first, then retry.');
  if (code === 131030) return tr('whatsapp.errNotAllowed', 'The recipient is not on the allowed list for this number (test numbers only allow a few approved recipients).');
  if (code === 131031 || code === 133010) return tr('whatsapp.errNotRegistered', 'This phone number is not fully registered with WhatsApp yet. Finish "Register your WhatsApp phone number" in Meta.');
  if (code === 10 || code === 200) return tr('whatsapp.errPermission', 'The token lacks the whatsapp_business_messaging permission.');
  return null;
}

export default function WhatsAppTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  // A missing translation key makes t() return the key itself (truthy), so `t(k) || 'x'`
  // would show "whatsapp.something" on screen. tr() falls back to English in that case.
  const tr = (key, fallback) => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };

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

  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

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
      else body.whatsapp_access_token = body.whatsapp_access_token.trim();
      const updated = await apiFetch('/admin/whatsapp-config', token, {
        method: 'PUT', body: JSON.stringify(body),
      });
      setCfg(c => ({ ...c, ...updated, whatsapp_access_token_set: c?.whatsapp_access_token_set || !!body.whatsapp_access_token }));
      setForm(f => ({ ...f, whatsapp_access_token: '' }));
      toast.success(tr('whatsapp.saved', 'WhatsApp settings saved.'));
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
      toast.success(tr('whatsapp.tokenGenerated', 'Verify token generated.'));
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

  const handleTestMessage = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/admin/whatsapp-config/test-message', token, {
        method: 'POST', body: JSON.stringify({ to_number: testTo }),
      });
      setTestResult(res);
    } catch (e) {
      // Validation problems (missing credentials, bad number) and plan gating arrive here
      setTestResult({ ok: false, error: { message: e.message } });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className={cardClass}><p className="text-sm text-gray-400">{tr('common.loading', 'Loading…')}</p></div>;
  }

  const hint = testResult && !testResult.ok ? explainMetaError(testResult.error, tr) : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">📱 {tr('whatsapp.title', 'WhatsApp')}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {tr('whatsapp.desc', 'Let customers open tickets by messaging your WhatsApp Business number. Incoming messages are triaged by AI and auto-assigned to the right agent.')}
        </p>
      </div>

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-white">{tr('whatsapp.enableTitle', 'Enable WhatsApp ticketing')}</h4>
            <p className="text-sm text-gray-500 dark:text-gray-400">{tr('whatsapp.enableDesc', 'Turn on once your credentials below are saved and the webhook is configured in Meta.')}</p>
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
            <label className={labelClass}>{tr('whatsapp.phoneNumberId', 'Phone Number ID')}</label>
            <input
              type="text"
              value={form.whatsapp_phone_number_id}
              onChange={e => setForm({ ...form, whatsapp_phone_number_id: e.target.value })}
              placeholder="e.g. 1334989443030103"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{tr('whatsapp.businessAccountId', 'Business Account ID')}</label>
            <input
              type="text"
              value={form.whatsapp_business_account_id}
              onChange={e => setForm({ ...form, whatsapp_business_account_id: e.target.value })}
              placeholder="e.g. 2071822826807810"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{tr('whatsapp.displayNumber', 'Display Phone Number')}</label>
            <input
              type="text"
              value={form.whatsapp_display_number}
              onChange={e => setForm({ ...form, whatsapp_display_number: e.target.value })}
              placeholder="+1 555 158 2548"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>{tr('whatsapp.accessToken', 'Access Token')}</label>
            <input
              type="password"
              value={form.whatsapp_access_token}
              onChange={e => setForm({ ...form, whatsapp_access_token: e.target.value })}
              placeholder={cfg?.whatsapp_access_token_set ? '••••••••  (already set — leave blank to keep)' : 'Paste your Meta access token'}
              className={inputClass}
              autoComplete="new-password"
            />
            {cfg?.whatsapp_access_token_set && !form.whatsapp_access_token && (
              <p className="text-xs text-gray-400 mt-1">{tr('whatsapp.tokenSetHint', 'A token is already saved. Leave blank to keep it, or paste a new one to replace it.')}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button className={btnClass} onClick={handleSave} disabled={saving}>
            {saving ? tr('common.saving', 'Saving…') : tr('common.save', 'Save')}
          </button>
        </div>
      </div>

      <div className={cardClass}>
        <h4 className="font-semibold text-gray-800 dark:text-white">{tr('whatsapp.testTitle', 'Send a test message')}</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('whatsapp.testDesc', 'Sends a real WhatsApp message from your business number using the saved settings, and shows exactly what Meta answers. Save your changes first. The recipient must have messaged your business number in the last 24 hours.')}
        </p>

        <div>
          <label className={labelClass}>{tr('whatsapp.testRecipient', 'Recipient number')}</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={testTo}
              onChange={e => setTestTo(e.target.value)}
              placeholder="+230 5xxx xxxx"
              className={inputClass}
            />
            <button className={btnClass} onClick={handleTestMessage} disabled={testing || !testTo.trim()}>
              {testing ? tr('whatsapp.testSending', 'Sending…') : tr('whatsapp.testSend', 'Send test')}
            </button>
          </div>
        </div>

        {testResult && testResult.ok && (
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-300">
            ✅ {tr('whatsapp.testOk', 'Meta accepted the message. It should arrive on the recipient\'s WhatsApp within a few seconds.')}
          </div>
        )}

        {testResult && !testResult.ok && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-800 dark:text-red-300 space-y-2">
            <p className="font-medium">❌ {tr('whatsapp.testFailed', 'The message was not sent.')}</p>
            {hint && <p>{hint}</p>}
            <p className="font-mono text-xs break-words">
              {testResult.error?.message || tr('whatsapp.unknownError', 'Unknown error')}
              {testResult.error?.code != null && ` (code ${testResult.error.code}${testResult.error.error_subcode ? `, subcode ${testResult.error.error_subcode}` : ''})`}
            </p>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <h4 className="font-semibold text-gray-800 dark:text-white">{tr('whatsapp.webhookTitle', 'Meta webhook setup')}</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {tr('whatsapp.webhookDesc', 'In your Meta App Dashboard → WhatsApp → Configuration, set the Callback URL and Verify Token below, then subscribe to the "messages" field. This is configured once, it works for every company using this DodoDesk instance.')}
        </p>

        <div>
          <label className={labelClass}>{tr('whatsapp.callbackUrl', 'Callback URL')}</label>
          <div className="flex items-center gap-2">
            <input type="text" readOnly value={cfg?.webhook_url || ''} className={`${inputClass} bg-gray-50 dark:bg-gray-900 font-mono text-xs`} />
            <button className={secondaryBtnClass} onClick={() => handleCopy(cfg?.webhook_url)}>
              {copied ? tr('whatsapp.copied', 'Copied!') : tr('whatsapp.copy', 'Copy')}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass}>{tr('whatsapp.verifyToken', 'Verify Token')}</label>
          <div className="flex items-center gap-2">
            <input type="text" readOnly value={cfg?.whatsapp_verify_token || ''} placeholder={tr('whatsapp.noTokenYet', 'No token generated yet')} className={`${inputClass} bg-gray-50 dark:bg-gray-900 font-mono text-xs`} />
            <button className={secondaryBtnClass} onClick={() => handleCopy(cfg?.whatsapp_verify_token)} disabled={!cfg?.whatsapp_verify_token}>
              {tr('whatsapp.copy', 'Copy')}
            </button>
            <button className={secondaryBtnClass} onClick={handleGenerateToken} disabled={genLoading}>
              {genLoading ? tr('common.loading', 'Loading…') : tr('whatsapp.generateToken', 'Generate')}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">{tr('whatsapp.verifyTokenHint', 'Generating a new token replaces the old one, you\'ll need to update it in Meta too.')}</p>
        </div>
      </div>
    </div>
  );
}
