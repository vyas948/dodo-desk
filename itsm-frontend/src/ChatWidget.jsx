import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useBranding } from './contexts/BrandingContext';

const API = import.meta.env.VITE_API_URL || '';

async function apiFetch(path, token, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Request failed'); }
  return r.json();
}

const TypingIndicator = () => (
  <div className="flex gap-1 items-center px-3 py-2">
    {[0,1,2].map(i => (
      <div key={i} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
    ))}
  </div>
);

const ToolBadge = ({ name }) => {
  const labels = {
    search_tickets: '🔍 Searching tickets…',
    get_ticket:     '🎫 Loading ticket…',
    create_ticket:  '✏️ Creating ticket…',
    search_kb:      '📚 Searching knowledge base…',
    get_asset:      '💻 Looking up asset…',
  };
  return (
    <div className="flex justify-start mb-1">
      <span className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 px-2 py-0.5 rounded-full">
        {labels[name] || `🔧 Using ${name}…`}
      </span>
    </div>
  );
};

const MessageBubble = ({ msg, accentColor }) => {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1"
             style={{ backgroundColor: accentColor }}>AI</div>
      )}
      <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
        isUser ? 'text-white rounded-tr-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-tl-sm'
      }`} style={isUser ? { backgroundColor: accentColor } : {}}>
        {msg.content}
        {msg.streaming && <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse rounded-sm" />}
      </div>
    </div>
  );
};

const SUGGESTIONS = ['Raise a ticket', 'Track my tickets', 'Search knowledge base'];

export default function ChatWidget() {
  const { token, user } = useAuth();
  const brandingCtx     = useBranding();
  const accentColor     = brandingCtx?.primary_color || '#4f46e5';
  const isEnterprise    = brandingCtx?.plan_limits?.ai_chatbot === true;

  const [open, setOpen]             = useState(false);
  const [sessions, setSessions]     = useState([]);
  const [sessionId, setSessionId]   = useState(null);
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [activeTools, setActiveTools] = useState([]);  // tools currently being called
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError]           = useState('');
  const [unread, setUnread]         = useState(0);
  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);
  const abortRef   = useRef(null);  // AbortController for SSE

  const GREETING = {
    role: 'assistant',
    content: `Hi ${user?.full_name?.split(' ')[0] || 'there'}! 👋 I'm DodoBot, your AI IT assistant.\n\nI can help you:\n• Raise and track support tickets\n• Search the knowledge base\n• Look up asset information\n\nWhat can I help you with today?`,
  };

  useEffect(() => {
    if (open) { inputRef.current?.focus(); setUnread(0); if (messages.length === 0) setMessages([GREETING]); }
  }, [open]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading, activeTools]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await apiFetch('/api/chat/sessions', token)); } catch(_) {}
  }, [token]);

  const loadSession = async (id) => {
    try {
      const data = await apiFetch(`/api/chat/sessions/${id}`, token);
      setSessionId(data.id); setMessages(data.messages); setShowHistory(false); setError('');
    } catch(e) { setError(e.message); }
  };

  const deleteSession = async (id, e) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/chat/sessions/${id}`, token, { method: 'DELETE' });
      setSessions(s => s.filter(x => x.id !== id));
      if (sessionId === id) { setSessionId(null); setMessages([GREETING]); }
    } catch(_) {}
  };

  const startNew = () => {
    // Cancel any in-progress stream
    abortRef.current?.abort();
    setSessionId(null); setMessages([{ role: 'assistant', content: 'Starting a new conversation. What can I help you with?' }]);
    setShowHistory(false); setError(''); setActiveTools([]);
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput(''); setError(''); setActiveTools([]);
    setMessages(m => [...m, { role: 'user', content: text }]);
    setLoading(true);

    // Abort any previous stream
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // ── SSE streaming path ──────────────────────────────────────────
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, session_id: sessionId || null }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Stream request failed');
      }

      // Add empty streaming assistant bubble
      setMessages(m => [...m, { role: 'assistant', content: '', streaming: true }]);

      const reader   = res.body.getReader();
      const decoder  = new TextDecoder();
      let   buffer   = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // last partial line stays in buffer

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw);

            if (event.type === 'delta') {
              // Append streamed text to the last message
              setMessages(m => {
                const updated = [...m];
                const last    = updated[updated.length - 1];
                if (last?.streaming) { updated[updated.length - 1] = { ...last, content: last.content + event.text }; }
                return updated;
              });
            } else if (event.type === 'tool') {
              setActiveTools(t => [...t, event.name]);
            } else if (event.type === 'done') {
              // Mark bubble as no longer streaming, update session info
              setMessages(m => {
                const updated = [...m];
                const last    = updated[updated.length - 1];
                if (last?.streaming) { updated[updated.length - 1] = { ...last, streaming: false }; }
                return updated;
              });
              setSessionId(event.session_id);
              setActiveTools([]);
              if (!open) setUnread(n => n + 1);
              loadSessions();
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch(parseErr) {
            if (parseErr.name !== 'SyntaxError') throw parseErr;
          }
        }
      }

    } catch (err) {
      if (err.name === 'AbortError') return; // user cancelled
      // ── Fallback to non-streaming if SSE fails ──────────────────────
      console.warn('SSE failed, falling back to non-streaming:', err.message);
      setActiveTools([]);
      setMessages(m => m.filter(x => !x.streaming)); // remove empty bubble
      try {
        const data = await apiFetch('/api/chat', token, {
          method: 'POST',
          body: JSON.stringify({ message: text, session_id: sessionId || null }),
        });
        setSessionId(data.session_id);
        setMessages(m => [...m, { role: 'assistant', content: data.reply }]);
        if (!open) setUnread(n => n + 1);
        loadSessions();
      } catch (fallbackErr) {
        setError(fallbackErr.message);
        setMessages(m => [...m, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  const handleOpen = () => { setOpen(o => !o); if (!open) loadSessions(); };

  // Guard — render nothing if not enterprise or not logged in
  // Must be AFTER all hooks (React rules of hooks)
  if (!isEnterprise || !token) return null;

  return (
    <>
      {/* ── Floating bubble ── */}
      <button onClick={handleOpen}
              className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: accentColor }}
              title="DodoBot — AI Assistant" aria-label="Open AI assistant">
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
        {unread > 0 && !open && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{unread}</span>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden"
             style={{ height: '520px' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0" style={{ backgroundColor: accentColor }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">AI</div>
              <div>
                <p className="font-semibold text-sm leading-none">DodoBot</p>
                <p className="text-xs opacity-75 mt-0.5">AI IT Assistant · Enterprise</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { setShowHistory(h => !h); if (!showHistory) loadSessions(); }}
                      className="text-white/80 hover:text-white transition" title="Chat history">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button onClick={startNew} className="text-white/80 hover:text-white transition" title="New conversation">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {/* History panel */}
          {showHistory && (
            <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 pt-2 pb-1 uppercase tracking-wider">Recent conversations</p>
              {sessions.length === 0 && <p className="text-xs text-gray-400 px-3 pb-3">No previous conversations.</p>}
              {sessions.map(s => (
                <div key={s.id} onClick={() => loadSession(s.id)}
                     className="flex items-center justify-between px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer group">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{s.title}</p>
                    <p className="text-xs text-gray-400">{new Date(s.updated_at).toLocaleDateString()}</p>
                  </div>
                  <button onClick={(e) => deleteSession(s.id, e)}
                          className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 ml-2 flex-shrink-0 transition" title="Delete">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2">
            {messages.map((msg, i) => <MessageBubble key={i} msg={msg} accentColor={accentColor} />)}

            {/* Tool call badges — shown while tools are running */}
            {activeTools.length > 0 && activeTools.map((name, i) => <ToolBadge key={i} name={name} />)}

            {/* Typing indicator — shown only when loading with no streaming bubble yet */}
            {loading && !messages.some(m => m.streaming) && (
              <div className="flex justify-start mb-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1"
                     style={{ backgroundColor: accentColor }}>AI</div>
                <div className="bg-gray-100 dark:bg-gray-700 rounded-2xl rounded-tl-sm"><TypingIndicator /></div>
              </div>
            )}
            {error && <p className="text-xs text-red-500 text-center mb-2 bg-red-50 dark:bg-red-900/20 rounded-lg px-2 py-1">{error}</p>}
            <div ref={bottomRef} />
          </div>

          {/* Suggestion chips */}
          {messages.length <= 1 && !loading && (
            <div className="flex gap-1.5 flex-wrap px-3 pb-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                        className="text-xs px-2.5 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 flex-shrink-0">
            <form onSubmit={sendMessage} className="flex items-end gap-2">
              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                        placeholder="Ask DodoBot anything..." rows={1}
                        className="flex-1 resize-none text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 max-h-28 overflow-y-auto"
                        style={{ lineHeight: '1.5' }} />
              <button type="submit" disabled={!input.trim() || loading}
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white transition-opacity disabled:opacity-40 flex-shrink-0"
                      style={{ backgroundColor: accentColor }} aria-label="Send">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-center">
              AI may make mistakes — verify critical information
            </p>
          </div>
        </div>
      )}
    </>
  );
}
