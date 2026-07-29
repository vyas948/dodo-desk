import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../apiFetch';
import Layout from '../components/Layout';

const inp = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500";
const lbl = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";

export default function CreateChange() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [agents, setAgents]       = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('basic'); // basic | planning | impact

  const [form, setForm] = useState({
    title: '', description: '', change_type: 'normal',
    risk_level: 'medium', risk_score: '',
    planned_date: '', start_date: '', end_date: '',
    owner_id: '', assigned_to_id: '',
    impact: '', rollback_plan: '', test_plan: '',
    cab_members: [],
    linked_ticket_ids: '', linked_asset_ids: '',
  });

  useEffect(() => {
    apiFetch('/users/', token)
      .then(d => setAgents(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(() => {});
  }, [token]);

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error(t('change.titleRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        risk_score: form.risk_score ? parseInt(form.risk_score) : null,
        owner_id: form.owner_id ? parseInt(form.owner_id) : null,
        assigned_to_id: form.assigned_to_id ? parseInt(form.assigned_to_id) : null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        linked_ticket_ids: form.linked_ticket_ids ? form.linked_ticket_ids.split(',').map(x => parseInt(x.trim())).filter(Boolean) : [],
        linked_asset_ids: form.linked_asset_ids ? form.linked_asset_ids.split(',').map(x => parseInt(x.trim())).filter(Boolean) : [],
      };
      const created = await apiFetch('/changes/', token, { method: 'POST', body: JSON.stringify(payload) });
      toast.success(t('change.changeCreated'));
      navigate(`/changes/${created.id}`);
    } catch(e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const card = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{t('change.newChange')}</h2>
          <div className="flex gap-2">
            <button onClick={() => navigate('/changes')}
                    className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={submitting}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
              {submitting ? t('change.creating') : t('change.createChangeShort')}
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="flex gap-1 mb-5">
          {[[`basic`,t('change.tabBasic')],[`planning`,t('change.tabPlanning')],[`impact`,t('change.tabImpact')]].map(([key,label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab===key ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Basic Info tab */}
        {activeTab === 'basic' && (
          <div className={card + " space-y-4"}>
            <div>
              <label className={lbl}>{t('change.title')}</label>
              <input value={form.title} onChange={e => setForm({...form, title: e.target.value})}
                     className={inp} placeholder={t('change.phTitle')} />
            </div>
            <div>
              <label className={lbl}>{t('change.description')}</label>
              <textarea rows={4} value={form.description} onChange={e => setForm({...form, description: e.target.value})}
                        className={inp} placeholder={t('change.phDescription')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>{t('change.changeType')}</label>
                <select value={form.change_type} onChange={e => setForm({...form, change_type: e.target.value})} className={inp}>
                  <option value="normal">{t('change.typeNormal')}</option>
                  <option value="standard">{t('change.typeStandard')}</option>
                  <option value="emergency">{t('change.typeEmergency')}</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  {form.change_type === 'normal' && t('change.normalDesc')}
                  {form.change_type === 'standard' && t('change.standardDesc')}
                  {form.change_type === 'emergency' && t('change.emergencyDesc')}
                </p>
              </div>
              <div>
                <label className={lbl}>{t('change.riskLevel')}</label>
                <select value={form.risk_level} onChange={e => setForm({...form, risk_level: e.target.value})} className={inp}>
                  <option value="low">{t('change.riskLow')}</option>
                  <option value="medium">{t('change.riskMedium')}</option>
                  <option value="high">{t('change.riskHigh')}</option>
                  <option value="critical">{t('change.riskCritical')}</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>{t('change.riskScore')} <span className="text-gray-400 font-normal">({t('change.riskScoreHint')})</span></label>
                <input type="number" min={1} max={25} value={form.risk_score}
                       onChange={e => setForm({...form, risk_score: e.target.value})}
                       className={inp} placeholder={t('change.phRiskScore')} />
                <p className="text-xs text-gray-400 mt-1">Rate impact (1–5) × likelihood (1–5)</p>
              </div>
              <div>
                <label className={lbl}>{t('change.changeOwner')}</label>
                <select value={form.owner_id} onChange={e => setForm({...form, owner_id: e.target.value})} className={inp}>
                  <option value="">{t('change.selectOwner')}</option>
                  {agents.filter(a => ['agent','admin','super_admin','platform_admin'].includes(a.role)).map(a => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>{t('change.assignedTo')}</label>
                <select value={form.assigned_to_id} onChange={e => setForm({...form, assigned_to_id: e.target.value})} className={inp}>
                  <option value="">{t('change.unassigned')}</option>
                  {agents.filter(a => ['agent','admin','super_admin','platform_admin'].includes(a.role)).map(a => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Planning tab */}
        {activeTab === 'planning' && (
          <div className={card + " space-y-4"}>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>{t('change.plannedDate')}</label>
                <input type="date" value={form.planned_date} onChange={e => setForm({...form, planned_date: e.target.value})} className={inp} />
              </div>
              <div />
              <div>
                <label className={lbl}>{t('change.implStart')}</label>
                <input type="datetime-local" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} className={inp} />
              </div>
              <div>
                <label className={lbl}>{t('change.implEnd')}</label>
                <input type="datetime-local" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} className={inp} />
              </div>
            </div>
            <div>
              <label className={lbl}>{t('change.cabMembers')}</label>
              <select multiple value={form.cab_members.map(String)}
                      onChange={e => setForm({...form, cab_members: [...e.target.selectedOptions].map(o => parseInt(o.value))})}
                      className={inp + " h-32"}>
                {agents.filter(a => ['agent','admin','super_admin','platform_admin'].includes(a.role)).map(a => (
                  <option key={a.id} value={a.id}>{a.full_name} ({a.role})</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple CAB members</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>{t('change.linkedTickets')}</label>
                <input value={form.linked_ticket_ids} onChange={e => setForm({...form, linked_ticket_ids: e.target.value})}
                       className={inp} placeholder={t('change.phLinkedTickets')} />
                <p className="text-xs text-gray-400 mt-1">Incidents that prompted this change</p>
              </div>
              <div>
                <label className={lbl}>{t('change.linkedAssets')}</label>
                <input value={form.linked_asset_ids} onChange={e => setForm({...form, linked_asset_ids: e.target.value})}
                       className={inp} placeholder={t('change.phLinkedAssets')} />
                <p className="text-xs text-gray-400 mt-1">Assets affected by this change</p>
              </div>
            </div>
          </div>
        )}

        {/* Impact & Plans tab */}
        {activeTab === 'impact' && (
          <div className={card + " space-y-4"}>
            <div>
              <label className={lbl}>{t('change.impactAssessment')}</label>
              <textarea rows={3} value={form.impact} onChange={e => setForm({...form, impact: e.target.value})}
                        className={inp} placeholder={t('change.phImpact')} />
            </div>
            <div>
              <label className={lbl}>{t('change.rollbackPlan')}</label>
              <textarea rows={3} value={form.rollback_plan} onChange={e => setForm({...form, rollback_plan: e.target.value})}
                        className={inp} placeholder={t('change.phRollback')} />
            </div>
            <div>
              <label className={lbl}>{t('change.testPlan')}</label>
              <textarea rows={3} value={form.test_plan} onChange={e => setForm({...form, test_plan: e.target.value})}
                        className={inp} placeholder={t('change.phTestPlan')} />
            </div>
          </div>
        )}

        {/* Bottom nav */}
        <div className="flex justify-between mt-5">
          <button onClick={() => setActiveTab(activeTab === 'impact' ? 'planning' : 'basic')}
                  disabled={activeTab === 'basic'}
                  className="px-4 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 transition disabled:opacity-30">
            {t('change.prev')}
          </button>
          {activeTab !== 'impact' ? (
            <button onClick={() => setActiveTab(activeTab === 'basic' ? 'planning' : 'impact')}
                    className="px-4 py-2 rounded-lg text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-200 transition">
              {t('change.next')}
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm hover:bg-indigo-700 transition disabled:opacity-50">
              {submitting ? t('change.creating') : t('change.createChange')}
            </button>
          )}
        </div>
      </div>
    </Layout>
  );
}
