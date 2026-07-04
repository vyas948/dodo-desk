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
    {
      key:'slack', name:'Slack', desc:'Get ticket events delivered to your Slack channels — new tickets, SLA breaches, status changes.', docsUrl:'https://api.slack.com/messaging/webhooks',
      logo: (
        <svg viewBox="0 0 124 124" className="w-8 h-8">
          <path d="M26.3 78.8a13.2 13.2 0 01-13.1 13.1A13.2 13.2 0 010 78.8a13.2 13.2 0 0113.2-13.1h13.1v13.1zm6.6 0a13.2 13.2 0 0113.1-13.1 13.2 13.2 0 0113.2 13.1v32.9a13.2 13.2 0 01-13.2 13.2 13.2 13.2 0 01-13.1-13.2V78.8z" fill="#E01E5A"/>
          <path d="M46 26.3a13.2 13.2 0 01-13.1-13.1A13.2 13.2 0 0146 0a13.2 13.2 0 0113.2 13.2v13.1H46zm0 6.6a13.2 13.2 0 0113.2 13.1 13.2 13.2 0 01-13.2 13.2H13.2A13.2 13.2 0 010 46a13.2 13.2 0 0113.2-13.1H46z" fill="#36C5F0"/>
          <path d="M98.5 46a13.2 13.2 0 0113.1-13.1A13.2 13.2 0 01124.8 46a13.2 13.2 0 01-13.2 13.2H98.5V46zm-6.6 0a13.2 13.2 0 01-13.1 13.2 13.2 13.2 0 01-13.2-13.2V13.2A13.2 13.2 0 0178.8 0a13.2 13.2 0 0113.1 13.2V46z" fill="#2EB67D"/>
          <path d="M78.8 98.5a13.2 13.2 0 0113.1 13.1 13.2 13.2 0 01-13.1 13.2 13.2 13.2 0 01-13.2-13.2V98.5h13.2zm0-6.6a13.2 13.2 0 01-13.2-13.1 13.2 13.2 0 0113.2-13.2h32.8a13.2 13.2 0 0113.2 13.2 13.2 13.2 0 01-13.2 13.1H78.8z" fill="#ECB22E"/>
        </svg>
      ),
    },
    {
      key:'teams', name:'Microsoft Teams', desc:'Receive ticket notifications in Teams channels via incoming webhooks.', docsUrl:'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
      logo: (
        <svg viewBox="0 0 2228.833 2073.333" className="w-8 h-8">
          <path d="M1554.637 777.5h575.713c54.391 0 98.483 44.092 98.483 98.483v524.398c0 199.901-162.051 361.952-361.952 361.952h-1.711c-199.901.028-361.975-162.019-361.975-361.92V828.971c.001-28.427 23.044-51.471 51.442-51.471z" fill="#5059C9"/>
          <circle cx="1943.75" cy="440.583" r="233.25" fill="#5059C9"/>
          <circle cx="1218.083" cy="336.917" r="336.917" fill="#7B83EB"/>
          <path d="M1667.323 777.5H717.01c-53.743 1.33-96.257 45.931-95.01 99.676v598.105c-7.505 322.519 247.657 590.16 570.167 598.053 322.51-7.893 577.672-275.534 570.167-598.053V877.176c1.245-53.745-41.268-98.346-95.011-99.676z" fill="#7B83EB"/>
          <path opacity=".1" d="M1244 777.5v838.145c-.258 38.435-23.549 72.964-59.09 87.598a91.856 91.856 0 01-35.765 7.257H667.613c-6.738-21.737-10.142-44.39-10.142-67.5V877.02c-1.246-53.659 41.168-98.19 94.83-99.52H1244z"/>
          <path opacity=".2" d="M1177.333 777.5v904.812c0 12.322-2.437 24.517-7.257 35.765-14.634 35.541-49.163 58.832-87.598 59.09H691.083c-8.856-21.434-16.102-43.616-21.612-66.333a508.52 508.52 0 01-12.021-109.334V877.02c-1.246-53.659 41.168-98.19 94.83-99.52h424.053z"/>
          <path opacity=".2" d="M1177.333 777.5v771.145c-.395 52.223-42.704 94.4-94.927 94.627H669.471C657.038 1601.088 650 1556.645 650 1510.5V877.02c-1.246-53.659 41.168-98.19 94.83-99.52h432.503z"/>
          <path opacity=".2" d="M1110.667 777.5v771.145c-.395 52.223-42.704 94.4-94.927 94.627H669.471C657.038 1601.088 650 1556.645 650 1510.5V877.02c-1.246-53.659 41.168-98.19 94.83-99.52h365.837z"/>
          <path d="M95.01 777.5h1015.657c52.473 0 95.01 42.538 95.01 95.01v1015.657c0 52.473-42.538 95.01-95.01 95.01H95.01C42.538 1983.177 0 1940.64 0 1888.167V872.51C0 820.038 42.538 777.5 95.01 777.5z" fill="#5059C9"/>
          <path d="M820.211 1099.021H630.268v517.5H509.494v-517.5H320.123V988.5h500.088v110.521z" fill="#fff"/>
        </svg>
      ),
    },
    {
      key:'smtp', name:'Email (SMTP)', desc:'Send transactional emails using your own SMTP server for branded delivery.', docsUrl:null,
      logo: (
        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="#6366f1" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"/>
        </svg>
      ),
    },
    {
      key:'sso', name:'Single Sign-On (SSO)', desc:'Let your team sign in with Google, Microsoft, Okta, or SAML 2.0.', docsUrl:null,
      logo: (
        <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="#0f172a" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/>
        </svg>
      ),
    },
    {
      key:'zapier', name:'Zapier / Make', desc:'Trigger automations in 1000+ apps when tickets are created or updated. Coming soon.', docsUrl:null,
      logo: (
        <svg viewBox="0 0 64 64" className="w-8 h-8">
          <circle cx="32" cy="32" r="32" fill="#FF4A00"/>
          <path d="M44.5 29.5h-12l8.5-8.5-3-3-8.5 8.5v-12h-4v12l-8.5-8.5-3 3 8.5 8.5h-12v4h12l-8.5 8.5 3 3 8.5-8.5v12h4v-12l8.5 8.5 3-3-8.5-8.5h12v-4z" fill="white"/>
        </svg>
      ),
    },
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
              <span className="mr-2 inline-flex">
                <svg viewBox="0 0 124 124" className="w-5 h-5 inline-block">
                  <path d="M26.3 78.8a13.2 13.2 0 01-13.1 13.1A13.2 13.2 0 010 78.8a13.2 13.2 0 0113.2-13.1h13.1v13.1zm6.6 0a13.2 13.2 0 0113.1-13.1 13.2 13.2 0 0113.2 13.1v32.9a13.2 13.2 0 01-13.2 13.2 13.2 13.2 0 01-13.1-13.2V78.8z" fill="#E01E5A"/>
                  <path d="M46 26.3a13.2 13.2 0 01-13.1-13.1A13.2 13.2 0 0146 0a13.2 13.2 0 0113.2 13.2v13.1H46zm0 6.6a13.2 13.2 0 0113.2 13.1 13.2 13.2 0 01-13.2 13.2H13.2A13.2 13.2 0 010 46a13.2 13.2 0 0113.2-13.1H46z" fill="#36C5F0"/>
                  <path d="M98.5 46a13.2 13.2 0 0113.1-13.1A13.2 13.2 0 01124.8 46a13.2 13.2 0 01-13.2 13.2H98.5V46zm-6.6 0a13.2 13.2 0 01-13.1 13.2 13.2 13.2 0 01-13.2-13.2V13.2A13.2 13.2 0 0178.8 0a13.2 13.2 0 0113.1 13.2V46z" fill="#2EB67D"/>
                  <path d="M78.8 98.5a13.2 13.2 0 0113.1 13.1 13.2 13.2 0 01-13.1 13.2 13.2 13.2 0 01-13.2-13.2V98.5h13.2zm0-6.6a13.2 13.2 0 01-13.2-13.1 13.2 13.2 0 0113.2-13.2h32.8a13.2 13.2 0 0113.2 13.2 13.2 13.2 0 01-13.2 13.1H78.8z" fill="#ECB22E"/>
                </svg>
              </span> Slack Webhook
            </h4>
            <p className="text-xs text-gray-400 mb-2">Sends ticket events to your Slack channel. <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">How to create →</a></p>
            <input value={cfg.slack_webhook_url} onChange={e=>setCfg({...cfg,slack_webhook_url:e.target.value})} className={inp} placeholder="https://hooks.slack.com/services/..." />
            {cfg.slack_webhook_url && <p className="text-xs text-green-500 mt-1">✅ Slack webhook configured</p>}
          </div>
          <div>
            <h4 className="font-medium text-gray-800 dark:text-white mb-1">
              <span className="mr-2 inline-flex">
                <svg viewBox="0 0 2228.833 2073.333" className="w-5 h-5 inline-block">
                  <path d="M1554.637 777.5h575.713c54.391 0 98.483 44.092 98.483 98.483v524.398c0 199.901-162.051 361.952-361.952 361.952h-1.711c-199.901.028-361.975-162.019-361.975-361.92V828.971c.001-28.427 23.044-51.471 51.442-51.471z" fill="#5059C9"/>
                  <circle cx="1943.75" cy="440.583" r="233.25" fill="#5059C9"/>
                  <circle cx="1218.083" cy="336.917" r="336.917" fill="#7B83EB"/>
                  <path d="M1667.323 777.5H717.01c-53.743 1.33-96.257 45.931-95.01 99.676v598.105c-7.505 322.519 247.657 590.16 570.167 598.053 322.51-7.893 577.672-275.534 570.167-598.053V877.176c1.245-53.745-41.268-98.346-95.011-99.676z" fill="#7B83EB"/>
                  <path opacity=".1" d="M1244 777.5v838.145c-.258 38.435-23.549 72.964-59.09 87.598a91.856 91.856 0 01-35.765 7.257H667.613c-6.738-21.737-10.142-44.39-10.142-67.5V877.02c-1.246-53.659 41.168-98.19 94.83-99.52H1244z"/>
                  <path opacity=".2" d="M1177.333 777.5v904.812c0 12.322-2.437 24.517-7.257 35.765-14.634 35.541-49.163 58.832-87.598 59.09H691.083c-8.856-21.434-16.102-43.616-21.612-66.333a508.52 508.52 0 01-12.021-109.334V877.02c-1.246-53.659 41.168-98.19 94.83-99.52h424.053z"/>
                  <path d="M95.01 777.5h1015.657c52.473 0 95.01 42.538 95.01 95.01v1015.657c0 52.473-42.538 95.01-95.01 95.01H95.01C42.538 1983.177 0 1940.64 0 1888.167V872.51C0 820.038 42.538 777.5 95.01 777.5z" fill="#5059C9"/>
                  <path d="M820.211 1099.021H630.268v517.5H509.494v-517.5H320.123V988.5h500.088v110.521z" fill="#fff"/>
                </svg>
              </span> Microsoft Teams Webhook
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
                    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center">{int.logo}</div>
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
