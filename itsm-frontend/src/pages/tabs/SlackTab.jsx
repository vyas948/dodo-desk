import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { apiFetch } from '../../apiFetch';
import { useTranslation } from '../../i18n/I18nContext';

const cardClass = 'bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 space-y-4';
const labelClass = 'block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1';
const inputClass = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400';
const btnClass = 'px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtnClass = 'px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition disabled:opacity-50';
const dangerBtnClass = 'px-4 py-2 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition';

const STR = {
  en: {
    title: 'Slack', desc: 'Two-way Slack: new tickets appear in a channel with Assign and Resolve buttons, replies in the thread become ticket comments, and your team can log tickets with /dododesk.',
    notReady: 'The DodoDesk Slack app is not set up on the server yet. Ask DodoBay support to enable it.',
    notConnected: 'Not connected', connect: 'Connect Slack', connecting: 'Opening Slack…', connected: 'Connected to workspace', disconnect: 'Disconnect', disconnectConfirm: 'Disconnect Slack? Alerts and thread sync will stop.',
    channel: 'Alert channel', pickChannel: 'Choose a channel…', saveChannel: 'Save channel', channelSaved: 'Channel saved.', test: 'Send test message', testSent: 'Test message sent to Slack.',
    howTitle: 'How your team uses it',
    how1: 'Alerts: every new ticket (portal, e-mail, WhatsApp or Slack) is posted in the channel with Assign to me and Resolve buttons.',
    how2: 'Thread replies: a reply in the thread becomes an internal note. Start it with "reply:" to send it to the requester.',
    how3: 'Commands: /dododesk new <problem>, /dododesk my, /dododesk <ticket number>.',
    how4: 'Only people whose Slack e-mail matches an active DodoDesk user can act. Everyone else is told to ask their admin.',
    r: { connected: 'Slack connected. Now choose the alert channel.', cancelled: 'Slack connection cancelled.', failed: 'Slack connection failed. Please try again.', invalid_state: 'That connection link expired. Please try again.', workspace_in_use: 'That Slack workspace is already connected to another company.' },
    loading: 'Loading…',
  },
  fr: {
    title: 'Slack', desc: 'Slack bidirectionnel : les nouveaux tickets apparaissent dans un canal avec des boutons Attribuer et Résoudre, les réponses du fil deviennent des commentaires, et votre équipe peut créer des tickets avec /dododesk.',
    notReady: 'L\'application Slack DodoDesk n\'est pas encore configurée sur le serveur. Contactez le support DodoBay.',
    notConnected: 'Non connecté', connect: 'Connecter Slack', connecting: 'Ouverture de Slack…', connected: 'Connecté à l\'espace de travail', disconnect: 'Déconnecter', disconnectConfirm: 'Déconnecter Slack ? Les alertes et la synchronisation des fils s\'arrêteront.',
    channel: 'Canal d\'alertes', pickChannel: 'Choisir un canal…', saveChannel: 'Enregistrer le canal', channelSaved: 'Canal enregistré.', test: 'Envoyer un message test', testSent: 'Message test envoyé à Slack.',
    howTitle: 'Comment votre équipe l\'utilise',
    how1: 'Alertes : chaque nouveau ticket (portail, e-mail, WhatsApp ou Slack) est publié dans le canal avec les boutons M\'attribuer et Résoudre.',
    how2: 'Réponses dans le fil : une réponse devient une note interne. Commencez par « reply: » pour l\'envoyer au demandeur.',
    how3: 'Commandes : /dododesk new <problème>, /dododesk my, /dododesk <numéro de ticket>.',
    how4: 'Seules les personnes dont l\'e-mail Slack correspond à un utilisateur DodoDesk actif peuvent agir. Les autres sont invitées à contacter leur administrateur.',
    r: { connected: 'Slack connecté. Choisissez maintenant le canal d\'alertes.', cancelled: 'Connexion Slack annulée.', failed: 'La connexion à Slack a échoué. Veuillez réessayer.', invalid_state: 'Ce lien de connexion a expiré. Veuillez réessayer.', workspace_in_use: 'Cet espace de travail Slack est déjà connecté à une autre entreprise.' },
    loading: 'Chargement…',
  },
};

export default function SlackTab() {
  const { token } = useAuth();
  const { toast } = useToast();
  const { language } = useTranslation();
  const s = STR[language] || STR.en;

  const [st, setSt] = useState(null);
  const [channels, setChannels] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await apiFetch('/admin/slack', token);
      setSt(d); setChannelId(d.channel_id || '');
      if (d.connected) apiFetch('/admin/slack/channels', token).then(setChannels).catch(e => toast.error(e.message));
    } catch (e) { toast.error(e.message); }
  };

  useEffect(() => {
    load();
    try {
      const p = new URLSearchParams(window.location.search);
      const r = p.get('slack');
      if (r && s.r[r]) { (r === 'connected' ? toast.success : toast.error)(s.r[r]); }
    } catch { /* ignore */ }
  }, [token]);

  const connect = async () => {
    setBusy(true);
    try { const d = await apiFetch('/admin/slack/install-url', token); window.location.href = d.url; }
    catch (e) { toast.error(e.message); setBusy(false); }
  };
  const saveChannel = async () => {
    const c = channels.find(x => x.id === channelId);
    setBusy(true);
    try { await apiFetch('/admin/slack/channel', token, { method: 'PUT', body: JSON.stringify({ channel_id: channelId, channel_name: c?.name || '' }) }); toast.success(s.channelSaved); await load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { await apiFetch('/admin/slack/test', token, { method: 'POST' }); toast.success(s.testSent); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm(s.disconnectConfirm)) return;
    setBusy(true);
    try { await apiFetch('/admin/slack', token, { method: 'DELETE' }); setChannels([]); await load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!st) return <div className={cardClass}><p className="text-sm text-gray-400">{s.loading}</p></div>;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white">💬 {s.title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{s.desc}</p>
      </div>

      <div className={cardClass}>
        {!st.app_ready && <p className="text-sm text-amber-600 dark:text-amber-400">{s.notReady}</p>}
        {st.app_ready && !st.connected && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-sm text-gray-500">{s.notConnected}</span>
            <button className={btnClass} disabled={busy} onClick={connect}>{busy ? s.connecting : s.connect}</button>
          </div>
        )}
        {st.connected && (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-gray-700 dark:text-gray-200">✅ {s.connected} <strong>{st.team_name}</strong></p>
              <button className={dangerBtnClass} disabled={busy} onClick={disconnect}>{s.disconnect}</button>
            </div>
            <div>
              <label className={labelClass}>{s.channel}</label>
              <div className="flex gap-2 flex-wrap">
                <select className={`${inputClass} flex-1 min-w-[12rem]`} value={channelId} onChange={e => setChannelId(e.target.value)}>
                  <option value="">{s.pickChannel}</option>
                  {channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
                </select>
                <button className={btnClass} disabled={busy || !channelId || channelId === st.channel_id} onClick={saveChannel}>{s.saveChannel}</button>
                <button className={secondaryBtnClass} disabled={busy || !st.channel_id} onClick={test}>{s.test}</button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className={cardClass}>
        <h4 className="font-semibold text-gray-800 dark:text-white">{s.howTitle}</h4>
        <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-2 list-disc pl-5">
          <li>{s.how1}</li><li>{s.how2}</li><li>{s.how3}</li><li>{s.how4}</li>
        </ul>
      </div>
    </div>
  );
}
