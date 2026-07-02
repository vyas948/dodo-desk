import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

export default function EmailTab() {
  const { token, user } = useAuth();
  const { toast } = useToast();
  const [cfg, setCfg] = useState({ smtp_host:'', smtp_port:587, smtp_user:'', smtp_pass:'', smtp_from:'', reply_to:'', slack_webhook_url:'', teams_webhook_url:'', email_signature:'', email_footer:'' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [activeSection, setActiveSection] = useState('smtp'); // smtp | signature | webhooks | integrations
  const [intStatus, setIntStatus] = useState(null);

  useEffect(() => {
    apiFetch('/admin/email-config', token).then(data => { setCfg(data); setTestEmail(user?.email || ''); }).catch(() => {});
    apiFetch('/admin/integrations-status', token).then(setIntStatus).catch(() => {});
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    try { await apiFetch('/admin/email-config', token, { method:'PUT', body:JSON.stringify(cfg) }); toast.success('Settings saved'); }
    catch(e) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await apiFetch('/admin/email-config/test', token, { method:'POST', body:JSON.stringify({ to_email: testEmail }) });
      if (res.ok) toast.success(res.message || 'Test email sent!');
      else toast.error(res.message || 'Test failed');
    } catch(e) { toast.error(e.message); }
    finally { setTesting(false); }
  };

  const INTEGRATIONS = [
    { key:'slack',  name:'Slack',              icon:'💬', desc:'Get ticket events delivered to your Slack channels — new tickets, SLA breaches, status changes.',    docsUrl:'https://api.slack.com/messaging/webhooks' },
    { key:'teams',  name:'Microsoft Teams',    icon:'💼', desc:'Receive ticket notifications in Teams channels via incoming webhooks.',                               docsUrl:'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook' },
    { key:'smtp',   name:'Email (SMTP)',        icon:'📧', desc:'Send transactional emails using your own SMTP server for branded delivery.',                          docsUrl: null },
    { key:'sso',    name:'Single Sign-On (SSO)',icon:'🔒', desc:'Let your team sign in with Google, Microsoft, Okta, or SAML 2.0.',                                   docsUrl: null },
    { key:'zapier', name:'Zapier / Make',       icon:'⚡', desc:'Trigger automations in 1000+ apps when tickets are created or updated. Coming soon.',                 docsUrl: null },
  ];

  const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
  const lbl = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";
  const card = "bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4";

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">📧 Email & Integrations</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Configure outbound email, webhooks and third-party integrations</p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 flex-wrap">
        {[['smtp','⚙️ SMTP'],['signature','✍️ Signature'],['webhooks','🔗 Webhooks'],['integrations','🔌 Integrations']].map(([key,label]) => (
          <button key={key} onClick={() => setActiveSection(key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeSection===key ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {activeSection === 'smtp' && (
        <div className={card}>
          <h4 className="font-medium text-gray-800 dark:text-white">SMTP Server</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 md:col-span-1"><label className={lbl}>SMTP Host</label><input value={cfg.smtp_host} onChange={e=>setCfg({...cfg,smtp_host:e.target.value})} className={inp} placeholder="smtp.gmail.com" /></div>
            <div><label className={lbl}>Port</label><input type="number" value={cfg.smtp_port} onChange={e=>setCfg({...cfg,smtp_port:parseInt(e.target.value)})} className={inp} /></div>
            <div><label className={lbl}>Username / Email</label><input value={cfg.smtp_user} onChange={e=>setCfg({...cfg,smtp_user:e.target.value})} className={inp} placeholder="you@company.com" /></div>
            <div><label className={lbl}>Password</label><input type="password" value={cfg.smtp_pass} onChange={e=>setCfg({...cfg,smtp_pass:e.target.value})} className={inp} placeholder="Leave blank to keep current" /></div>
            <div><label className={lbl}>From Address</label><input value={cfg.smtp_from} onChange={e=>setCfg({...cfg,smtp_from:e.target.value})} className={inp} placeholder="helpdesk@company.com" /></div>
            <div><label className={lbl}>Reply-To</label><input value={cfg.reply_to} onChange={e=>setCfg({...cfg,reply_to:e.target.value})} className={inp} placeholder="support@company.com" /></div>
          </div>
          <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
            <h4 className="font-medium text-gray-800 dark:text-white mb-3">Test Configuration</h4>
            <div className="flex gap-2">
              <input value={testEmail} onChange={e=>setTestEmail(e.target.value)} placeholder="Send test to..." className={inp + " flex-1"} />
              <button onClick={handleTest} disabled={testing || !cfg.smtp_host} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition disabled:opacity-50">
                {testing ? 'Sending...' : '📨 Send Test'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Sends a test email to verify your SMTP settings are correct</p>
          </div>
        </div>
      )}

      {activeSection === 'signature' && (
        <div className={card}>
          <div>
            <h4 className="font-medium text-gray-800 dark:text-white mb-1">Email Signature</h4>
            <p className="text-xs text-gray-400 mb-3">Appended to all outgoing ticket notification emails</p>
            <textarea rows={5} value={cfg.email_signature} onChange={e=>setCfg({...cfg,email_signature:e.target.value})} className={inp} placeholder="e.g.&#10;Best regards,&#10;The IT Support Team&#10;📞 +1 555-000-0000" />
          </div>
          <div>
            <h4 className="font-medium text-gray-800 dark:text-white mb-1">Email Footer</h4>
            <p className="text-xs text-gray-400 mb-3">Legal/compliance text shown at the bottom of emails</p>
            <textarea rows={3} value={cfg.email_footer} onChange={e=>setCfg({...cfg,email_footer:e.target.value})} className={inp} placeholder="e.g. This email is confidential. If you received it in error please delete it." />
          </div>
        </div>
      )}

      {activeSection === 'webhooks' && (
        <div className={card}>
          <div>
            <h4 className="font-medium text-gray-800 dark:text-white mb-1">
              <span className="mr-2">💬</span> Slack Webhook
            </h4>
            <p className="text-xs text-gray-400 mb-2">Sends ticket events to your Slack channel. <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">How to create →</a></p>
            <input value={cfg.slack_webhook_url} onChange={e=>setCfg({...cfg,slack_webhook_url:e.target.value})} className={inp} placeholder="https://hooks.slack.com/services/..." />
            {cfg.slack_webhook_url && <p className="text-xs text-green-500 mt-1">✅ Slack webhook configured</p>}
          </div>
          <div>
            <h4 className="font-medium text-gray-800 dark:text-white mb-1">
              <span className="mr-2">💼</span> Microsoft Teams Webhook
            </h4>
            <p className="text-xs text-gray-400 mb-2">Sends ticket events to your Teams channel. <a href="https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">How to create →</a></p>
            <input value={cfg.teams_webhook_url} onChange={e=>setCfg({...cfg,teams_webhook_url:e.target.value})} className={inp} placeholder="https://outlook.office.com/webhook/..." />
            {cfg.teams_webhook_url && <p className="text-xs text-green-500 mt-1">✅ Teams webhook configured</p>}
          </div>
        </div>
      )}

      {activeSection === 'integrations' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {INTEGRATIONS.map(int => {
              const isConfigured = intStatus ? intStatus[int.key]?.configured : false;
              const comingSoon = int.key === 'zapier';
              return (
                <div key={int.key} className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 flex items-start justify-between gap-4 ${comingSoon ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-4">
                    <div className="text-3xl flex-shrink-0">{int.icon}</div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold text-gray-800 dark:text-white">{int.name}</h4>
                        {comingSoon
                          ? <span className="text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 px-2 py-0.5 rounded-full">Coming soon</span>
                          : isConfigured
                            ? <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">✅ Connected</span>
                            : <span className="text-xs bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 px-2 py-0.5 rounded-full">Not configured</span>
                        }
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{int.desc}</p>
                      {int.docsUrl && (
                        <a href={int.docsUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-500 hover:underline mt-1 inline-block">
                          View documentation →
                        </a>
                      )}
                    </div>
                  </div>
                  {!comingSoon && (
                    <button onClick={() => setActiveSection(int.key === 'sso' ? 'smtp' : 'webhooks')}
                            className="text-xs text-indigo-500 hover:underline flex-shrink-0 mt-1">
                      Configure →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl p-4">
            <h4 className="font-medium text-indigo-700 dark:text-indigo-400 mb-1">🚀 More integrations coming</h4>
            <p className="text-sm text-indigo-600 dark:text-indigo-400">Zapier, Make, Jira, and more are on the roadmap. Email us at <a href="mailto:contact@dodobay.com" className="underline">contact@dodobay.com</a> to request a specific integration.</p>
          </div>
        </div>
      )}

      {activeSection !== 'integrations' && (
        <button onClick={handleSave} disabled={saving} className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      )}
    </div>
  );
}
