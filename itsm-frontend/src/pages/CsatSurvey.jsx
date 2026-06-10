import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from '../i18n/I18nContext';
import { API } from '../api';

export default function CsatSurvey() {
  const { token } = useParams();
  const { t } = useTranslation();
  const [ticket, setTicket] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/csat/${token}`)
      .then(res => res.json())
      .then(data => {
        setTicket(data);
        if (data.rating) setSubmitted(true);
      })
      .catch(() => setError(t('csat.notFound')))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    try {
      const res = await fetch(`${API}/csat/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment }),
      });
      if (!res.ok) { const data = await res.json(); throw new Error(data.detail || t('common.error')); }
      setSubmitted(true);
    } catch (e) { setError(e.message); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-gray-500 dark:text-gray-400">
      {t('common.loading')}
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center text-red-500">{error}</div>
  );

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 max-w-md w-full text-center">
        {!submitted ? (
          <>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">{t('csat.title')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('csat.ticket')}: {ticket.title}</p>
            <div className="flex justify-center gap-2 mb-6">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setRating(n)}
                  className={`w-10 h-10 rounded-full text-lg font-medium transition ${
                    rating >= n
                      ? 'bg-yellow-400 text-white'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={t('csat.comments')}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg p-3 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 mb-4 resize-none"
              rows={3}
            />
            {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={rating === 0}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:opacity-50 transition"
            >
              {t('csat.submit')}
            </button>
          </>
        ) : (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-2">{t('csat.thankYou')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('csat.thankYouMsg')}</p>
          </>
        )}
      </div>
    </div>
  );
}
