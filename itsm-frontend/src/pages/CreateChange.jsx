import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../i18n/I18nContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../utils/apiFetch';
import Layout from '../components/Layout';
import { API } from '../api';

export default function CreateChange() {
  const { token } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [riskLevel, setRiskLevel] = useState('medium');
  const [plannedDate, setPlannedDate] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const body = { title, description, risk_level: riskLevel };
      if (plannedDate) body.planned_date = plannedDate;
      const res = await fetch(`${API}/changes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to create change');
      navigate('/changes');
    } catch (err) { toast.error(err.message); }
  };

  const cardClass = "bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6";
  const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const selectClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white";
  const btnPrimary = "bg-indigo-600 text-white px-5 py-2 rounded-lg hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition font-medium";
  const btnSecondary = "text-gray-600 dark:text-gray-300 hover:underline py-2";

  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <div className={cardClass}>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">{t('change.createChange')}</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.title')}</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('common.description')}</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} required rows={5} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('change.riskLevel')}</label>
              <select value={riskLevel} onChange={e => setRiskLevel(e.target.value)} className={selectClass}>
                <option value="low">{t('change.low')}</option>
                <option value="medium">{t('change.medium')}</option>
                <option value="high">{t('change.high')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('change.plannedDate')}</label>
              <input type="date" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} className={inputClass} />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button type="submit" className={btnPrimary}>{t('common.submit')}</button>
              <button type="button" onClick={() => navigate('/changes')} className={btnSecondary}>{t('common.cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}