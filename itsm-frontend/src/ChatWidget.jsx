import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useBranding } from './contexts/BrandingContext';
import { API } from './api';

async function apiFetch(path, token, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || 'Request failed'); }
  return r.json();
}

// ── Simple markdown renderer ───────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="bg-gray-200 dark:bg-gray-600 px-1 rounded text-xs font-mono">$1</code>')
    .replace(/^### (.+)$/gm, '<p class="font-semibold mt-2 mb-0.5">$1</p>')
    .replace(/^## (.+)$/gm,  '<p class="font-bold mt-2 mb-1">$1</p>')
    .replace(/^# (.+)$/gm,   '<p class="font-bold text-lg mt-2 mb-1">$1</p>')
    .replace(/^- (.+)$/gm,   '<div class="flex gap-1.5 my-0.5"><span>•</span><span>$1</span></div>')
    .replace(/^(\d+)\. (.+)$/gm, '<div class="flex gap-1.5 my-0.5"><span class="flex-shrink-0">$1.</span><span>$2</span></div>')
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}

// ── Typing indicator ───────────────────────────────────────────────────────
const TypingIndicator = () => (
  <div className="flex gap-1 items-center px-3 py-2">
    {[0,1,2].map(i => (
      <div key={i} className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
    ))}
  </div>
);

// ── Tool badge ─────────────────────────────────────────────────────────────
const TOOL_LABELS = {
  list_my_tickets:  '🎫 Fetching your tickets…',
  search_tickets:   '🔍 Searching tickets…',
  get_ticket:       '🎫 Loading ticket details…',
  create_ticket:    '✏️ Creating ticket…',
  update_ticket:    '✏️ Updating ticket…',
  search_kb:        '📚 Searching knowledge base…',
  list_kb_articles: '📚 Listing KB articles…',
  get_asset:        '💻 Looking up asset…',
  list_my_assets:   '💻 Fetching your assets…',
  check_sla:        '⏱️ Checking SLA status…',
};

const ToolBadge = ({ name }) => (
  <div className="flex justify-start mb-1">
    <span className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700 px-2 py-0.5 rounded-full animate-pulse">
      {TOOL_LABELS[name] || `🔧 Using ${name}…`}
    </span>
  </div>
);

// ── Message bubble ─────────────────────────────────────────────────────────
function MessageBubble({ msg, accentColor, onCopy, onFeedback }) {
  const isUser = msg.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    onCopy?.(msg);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 group`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold mr-2 flex-shrink-0 mt-1"
             style={{ backgroundColor: accentColor }}>AI</div>
      )}
      <div className="max-w-[82%]">
        <div className={`px-3 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? 'text-white rounded-tr-sm'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-tl-sm'
        }`} style={isUser ? { backgroundColor: accentColor } : {}}>
          {isUser ? (
            <span className="whitespace-pre-wrap">{msg.content}</span>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
          )}
          {msg.streaming && <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse rounded-sm" />}
        </div>

        {/* Action bar for bot messages */}
        {!isUser && !msg.streaming && msg.content && (
          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={handleCopy} title="Copy" className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition">
              {copied ? '✅' : '📋'}
            </button>
            {onFeedback && (
              <>
                <button onClick={() => onFeedback(msg, 'up')} title="Helpful" className={`text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition ${msg.feedback === 'up' ? 'text-green-500' : 'text-gray-400 hover:text-green-500'}`}>👍</button>
                <button onClick={() => onFeedback(msg, 'down')} title="Not helpful" className={`text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition ${msg.feedback === 'down' ? 'text-red-500' : 'text-gray-400 hover:text-red-400'}`}>👎</button>
              </>
            )}
            <span className="text-xs text-gray-300 dark:text-gray-600 ml-1">
              {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Suggested follow-up prompts ────────────────────────────────────────────
const FOLLOW_UPS_BY_TOOL = {
  create_ticket:    ['Check my ticket status', 'Show all my open tickets', 'Search knowledge base'],
  list_my_tickets:  ['Show overdue tickets', 'Check my SLA status', 'Search knowledge base'],
  search_kb:        ['Show all KB articles', 'Raise a ticket about this', 'Show my open tickets'],
  check_sla:        ['Show overdue tickets', 'Show my open tickets'],
  list_my_assets:   ['Get asset details', 'Show my open tickets'],
  update_ticket:    ['Show all my open tickets', 'Check my SLA status'],
};

const DEFAULT_SUGGESTIONS = ['Show my open tickets', 'Raise a ticket', 'Search knowledge base', 'Check SLA status', 'List my assets'];

export default function ChatWidget() {
  const { token, user } = useAuth();
  const brandingCtx  = useBranding();
  const accentColor  = brandingCtx?.primary_color || '#4f46e5';
  const isEnterprise = brandingCtx?.plan_limits?.ai_chatbot === true;

  const [open, setOpen]               = useState(false);
  const [expanded, setExpanded]       = useState(false);  // full-page mode
  const [sessions, setSessions]       = useState([]);
  const [sessionId, setSessionId]     = useState(null);
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [activeTools, setActiveTools] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError]             = useState('');
  const [unread, setUnread]           = useState(0);
  const [attachment, setAttachment]   = useState(null);
  const [lastToolsUsed, setLastToolsUsed] = useState([]);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const fileRef   = useRef(null);
  const abortRef  = useRef(null);

  const GREETING = {
    role: 'assistant',
    content: `Hi ${user?.full_name?.split(' ')[0] || 'there'}! 👋 I'm **DodoBot**, your AI IT assistant.\n\nI can help you:\n- Raise and track support tickets\n- Update ticket status or add comments\n- Search the knowledge base\n- Check your SLA status\n- Look up asset information\n\nWhat can I help you with today?`,
  };

  useEffect(() => {
    if (open) { inputRef.current?.focus(); setUnread(0); if (messages.length === 0) setMessages([GREETING]); }
  }, [open]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading, activeTools]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await apiFetch('/api/chat/sessions', token)); } catch {}
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
    } catch {}
  };

  const startNew = () => {
    abortRef.current?.abort();
    setSessionId(null); setMessages([{ role: 'assistant', content: 'Starting a new conversation. What can I help you with?' }]);
    setShowHistory(false); setError(''); setActiveTools([]); setLastToolsUsed([]);
  };

  const handleFeedback = (msg, type) => {
    setMessages(m => m.map(x => x === msg ? { ...x, feedback: type } : x));
    // Could send to backend for analytics
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('File too large — max 5MB'); return; }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      setAttachment({ name: file.name, media_type: file.type, data: dataUrl.split(',')[1], preview: file.type.startsWith('image/') ? dataUrl : null });
      setError('');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendMessage = async (text_override) => {
    const text = (text_override || input).trim();
    if (!text && !attachment || loading) return;
    const sentAttachment = attachment;
    setInput(''); setError(''); setActiveTools([]); setAttachment(null); setLastToolsUsed([]);

    const displayContent = text + (sentAttachment ? `\n📎 ${sentAttachment.name}` : '');
    setMessages(m => [...m, { role: 'user', content: displayContent }]);
    setLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text, session_id: sessionId || null,
          ...(sentAttachment ? { attachment: { name: sentAttachment.name, media_type: sentAttachment.media_type, data: sentAttachment.data } } : {})
        }),
      });

      if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData.detail || 'Stream failed'); }

      setMessages(m => [...m, { role: 'assistant', content: '', streaming: true }]);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw);
            if (event.type === 'delta') {
              setMessages(m => { const u=[...m]; const last=u[u.length-1]; if(last?.streaming) u[u.length-1]={...last,content:last.content+event.text}; return u; });
            } else if (event.type === 'tool') {
              setActiveTools(t => [...t, event.name]);
              if (event.name === 'create_ticket') window.dispatchEvent(new CustomEvent('dodesk:ticket-created'));
            } else if (event.type === 'done') {
              setMessages(m => { const u=[...m]; const last=u[u.length-1]; if(last?.streaming) u[u.length-1]={...last,streaming:false,created_at:new Date().toISOString()}; return u; });
              setSessionId(event.session_id);
              setLastToolsUsed(event.tools_used || []);
              setActiveTools([]);
              if (!open) setUnread(n => n + 1);
              loadSessions();
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch(parseErr) { if (parseErr.name !== 'SyntaxError') throw parseErr; }
        }
      }
    } catch(err) {
      if (err.name === 'AbortError') return;
      // Fallback
      setActiveTools([]);
      setMessages(m => m.filter(x => !x.streaming));
      try {
        const data = await apiFetch('/api/chat', token, {
          method: 'POST',
          body: JSON.stringify({ message: text, session_id: sessionId || null,
            ...(sentAttachment ? { attachment: { name: sentAttachment.name, media_type: sentAttachment.media_type, data: sentAttachment.data } } : {}) }),
        });
        setSessionId(data.session_id);
        setMessages(m => [...m, { role: 'assistant', content: data.reply, created_at: new Date().toISOString() }]);
        setLastToolsUsed(data.tools_used || []);
        if (!open) setUnread(n => n + 1);
        loadSessions();
      } catch(fallbackErr) {
        setError(fallbackErr.message);
        setMessages(m => [...m, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
      }
    } finally { setLoading(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  const handleOpen    = () => { setOpen(o => !o); if (!open) loadSessions(); };

  // Compute follow-up suggestions after last reply
  const followUpSuggestions = lastToolsUsed.length > 0
    ? (FOLLOW_UPS_BY_TOOL[lastToolsUsed[lastToolsUsed.length - 1]] || DEFAULT_SUGGESTIONS.slice(0, 3))
    : (messages.length <= 1 ? DEFAULT_SUGGESTIONS : []);

  if (!isEnterprise || !token) return null;

  const panelWidth  = expanded ? 'w-[680px]' : 'w-80 sm:w-96';
  const panelHeight = expanded ? 'h-[80vh]'  : 'h-[520px]';

  return (
    <>
      {/* ── Floating button ── */}
      <button onClick={handleOpen}
              className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: accentColor }}
              title="DodoBot — AI Assistant" aria-label="Open AI assistant">
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/></svg>
        )}
        {unread > 0 && !open && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">{unread}</span>
        )}
      </button>

      {/* ── Chat panel ── */}
      {open && (
        <div className={`fixed bottom-24 right-6 z-50 ${panelWidth} ${panelHeight} bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden transition-all duration-200`}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 text-white flex-shrink-0" style={{ backgroundColor: accentColor }}>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">AI</div>
              <div>
                <p className="font-semibold text-sm leading-none">DodoBot</p>
                <p className="text-xs opacity-75 mt-0.5">AI IT Assistant · Enterprise</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {/* History */}
              <button onClick={() => { setShowHistory(h => !h); if (!showHistory) loadSessions(); }}
                      className="text-white/80 hover:text-white transition" title="Chat history">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </button>
              {/* New conversation */}
              <button onClick={startNew} className="text-white/80 hover:text-white transition" title="New conversation">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
              </button>
              {/* Expand toggle */}
              <button onClick={() => setExpanded(e => !e)} className="text-white/80 hover:text-white transition" title={expanded ? 'Shrink' : 'Expand'}>
                {expanded ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0l5 0M4 4v5M15 15l5 5m0 0l-5 0m5 0v-5"/></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5"/></svg>
                )}
              </button>
            </div>
          </div>

          {/* History panel */}
          {showHistory && (
            <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 max-h-52 overflow-y-auto">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-3 pt-2 pb-1 uppercase tracking-wider">Recent conversations</p>
              {sessions.length === 0 && <p className="text-xs text-gray-400 px-3 pb-3">No previous conversations.</p>}
              {sessions.map(s => (
                <div key={s.id} onClick={() => loadSession(s.id)}
                     className="flex items-center justify-between px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer group">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{s.title}</p>
                    <p className="text-xs text-gray-400">{new Date(s.updated_at).toLocaleDateString()}</p>
                  </div>
                  <button onClick={e => deleteSession(s.id, e)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 ml-2 flex-shrink-0 transition" title="Delete">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 pt-3 pb-2">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} accentColor={accentColor}
                             onFeedback={handleFeedback} />
            ))}

            {/* Tool call badges */}
            {activeTools.map((name, i) => <ToolBadge key={i} name={name} />)}

            {/* Typing indicator */}
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

          {/* Follow-up / suggestion chips */}
          {followUpSuggestions.length > 0 && !loading && (
            <div className="flex gap-1.5 flex-wrap px-3 pb-2">
              {followUpSuggestions.slice(0, 4).map(s => (
                <button key={s} onClick={() => sendMessage(s)}
                        className="text-xs px-2.5 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition bg-white dark:bg-gray-800">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 flex-shrink-0">
            {/* Attachment preview */}
            {attachment && (
              <div className="flex items-center gap-2 mb-2 px-1">
                {attachment.preview ? (
                  <img src={attachment.preview} alt="preview" className="w-10 h-10 rounded-lg object-cover border border-gray-200 dark:border-gray-600" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-lg">
                    {attachment.media_type === 'application/pdf' ? '📄' : '📎'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{attachment.name}</p>
                </div>
                <button onClick={() => setAttachment(null)} className="text-gray-400 hover:text-red-500 transition flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            )}

            <div className="flex items-end gap-2">
              <input ref={fileRef} type="file" className="hidden" accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileSelect} />
              <button type="button" onClick={() => fileRef.current?.click()}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 border border-gray-300 dark:border-gray-600 hover:border-gray-400 transition flex-shrink-0"
                      title="Attach file (image, PDF — max 5MB)">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              </button>
              <div className="flex-1 relative">
                <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                          placeholder={attachment ? 'Add a message (optional)…' : 'Ask DodoBot anything…'} rows={1}
                          className="w-full resize-none text-sm border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 max-h-28 overflow-y-auto pr-10"
                          style={{ lineHeight: '1.5' }} />
                {input.length > 400 && (
                  <span className={`absolute bottom-2 right-2 text-xs ${input.length > 500 ? 'text-red-400' : 'text-gray-400'}`}>
                    {input.length}/500
                  </span>
                )}
              </div>
              <button type="button" onClick={() => sendMessage()} disabled={(!input.trim() && !attachment) || loading}
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white transition-opacity disabled:opacity-40 flex-shrink-0"
                      style={{ backgroundColor: accentColor }} aria-label="Send">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-center">
              Supports images & PDFs · AI may make mistakes · Press Enter to send
            </p>
          </div>
        </div>
      )}
    </>
  );
}
