import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';

export default function IntegrationsTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    apiFetch('/admin/integrations-status', token).then(setStatus).catch(() => {});
  }, [token]);

  const INTEGRATIONS = [
    {
      key: 'slack', name: 'Slack', icon: '💬',
      desc: 'Get ticket events delivered to your Slack channels — new tickets, SLA breaches, status changes.',
      docsUrl: 'https://api.slack.com/messaging/webhooks',
      settingsTab: 'email', // redirects user to Email tab > Webhooks section
    },
    {
      key: 'teams', name: 'Microsoft Teams', icon: '💼',
      desc: 'Receive ticket notifications in Microsoft Teams channels via incoming webhooks.',
      docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
      settingsTab: 'email',
    },
    {
      key: 'smtp', name: 'Email (SMTP)', icon: '📧',
      desc: 'Send transactional emails using your own SMTP server for branded email delivery.',
      settingsTab: 'email',
    },
    {
      key: 'sso', name: 'Single Sign-On (SSO)', icon: '🔒',
      desc: 'Let your team sign in with Google, Microsoft, Okta, or SAML 2.0.',
      settingsTab: 'security',
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">🔗 Integrations</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Connect DodoDesk to your existing tools and services</p>
      </div>

      <div className="grid gap-4">
        {INTEGRATIONS.map(int => {
          const isConfigured = status ? status[int.key]?.configured : false;
          return (
            <div key={int.key} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="text-3xl flex-shrink-0">{int.icon}</div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-gray-800 dark:text-white">{int.name}</h4>
                    {isConfigured
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
              <div className="flex-shrink-0">
                <span className="text-xs text-gray-400">Configure in {int.settingsTab === 'email' ? 'Email tab' : 'Security tab'}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl p-4">
        <h4 className="font-medium text-indigo-700 dark:text-indigo-400 mb-1">🚀 More integrations coming</h4>
        <p className="text-sm text-indigo-600 dark:text-indigo-400">Zapier, Make, Jira, and more are on the roadmap. Email us at <a href="mailto:contact@dodobay.com" className="underline">contact@dodobay.com</a> to request a specific integration.</p>
      </div>
    </div>
  );
}
