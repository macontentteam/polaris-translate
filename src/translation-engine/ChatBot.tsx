import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, Sparkles, HelpCircle } from 'lucide-react';

const GEMINI_PROXY_URL = "/api/gemini-proxy";

const CHATBOT_SYSTEM_INSTRUCTION = `You are the Polaris Support AI, an expert in global translation and localization.
POLARIS ENGINE SPECS:
- Core: Glacier Core Architecture for data isolation and high-fidelity verification.
- Verification: Dual-intelligence (Gemini + GPT-5.2 proxy) meaning check and audit.
- Capability: Supports Text, Documents (PDF/Word), and Media (Video/Audio/Image OCR).
- Workflow: Multi-round consensus (up to 3 rounds) to hit 98/100 quality threshold.
- Languages: 14+ specific target mappings like German (Germany), Chinese (Mandarin), etc.
- Modes: Cybersecurity (specialized glossary), General, and Custom (user glossaries).
- Troubleshoot: If 'Failed to fetch' occurs, it usually means the audit proxy is down; suggest 'General' mode as a temporary bypass.
Keep responses professional, helpful, and technically accurate.`;

interface Message {
  role: 'user' | 'model';
  text: string;
}

export const ChatBot: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'model', text: "Hello! I'm the Polaris Support AI. I can help you with translation questions, guide you through the localization process, or troubleshoot tool issues." }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isOpen]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const userMessage = input.trim();
    setInput('');

    const updatedMessages: Message[] = [...messages, { role: 'user', text: userMessage }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      // Build full conversation history for the proxy (REST API contents format)
      const contents = updatedMessages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }],
      }));

      const response = await fetch(GEMINI_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          contents,
          systemInstruction: { parts: [{ text: CHATBOT_SYSTEM_INSTRUCTION }] },
          generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
        }),
      });

      if (!response.ok) throw new Error(`Proxy error: ${response.status}`);

      const data = await response.json();
      const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm having trouble processing that right now.";
      setMessages(prev => [...prev, { role: 'model', text: replyText }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'model', text: "Technical error connecting to Polaris AI. Please check your network." }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-[100]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all ${
          isOpen ? 'bg-neutral-800 rotate-90' : 'bg-blue-600 hover:scale-105'
        }`}
      >
        {isOpen ? <X className="text-white w-6 h-6" /> : <MessageCircle className="text-white w-6 h-6" />}
      </button>

      {isOpen && (
        <div className="absolute bottom-16 right-0 w-80 h-[500px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-neutral-200 animate-in fade-in slide-in-from-bottom-2">
          <div className="bg-neutral-900 p-4 text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <h3 className="font-bold text-sm uppercase tracking-widest">Polaris Support</h3>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50/50">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] p-3 rounded-xl text-sm leading-relaxed ${
                  m.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white border border-neutral-200 text-neutral-800 rounded-tl-none'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
            {isLoading && <Loader2 className="w-4 h-4 text-blue-500 animate-spin mx-auto" />}
          </div>

          <div className="p-3 bg-white border-t border-neutral-200">
            <div className="flex items-center gap-2 bg-neutral-100 rounded-xl px-3 py-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Ask about Polaris..."
                className="flex-1 bg-transparent border-none py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:ring-0 outline-none"
              />
              <button onClick={handleSendMessage} disabled={!input.trim() || isLoading} className="text-blue-600 disabled:text-neutral-400">
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};