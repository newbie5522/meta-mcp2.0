import React, { useEffect, useState } from "react";
import { Bot, X, Maximize2, Send, Wand2, Sparkles } from "lucide-react";

type CopilotMessage = {
  role: "system" | "user" | "assistant";
  type?: "context" | "text";
  title?: string;
  content: string;
  context?: any;
};

export function AICopilotWindow() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [activeContext, setActiveContext] = useState<any | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: "assistant",
      type: "text",
      content: "你好！我是你的 AI 优化师。你可以点击页面里的“问 AI”按钮，我会自动带入当前对象数据。"
    }
  ]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent;
      const detail = custom.detail || {};
      setIsOpen(true);
      setActiveContext(detail);
      setInputValue(detail.prompt || "");
      setMessages(prev => [
        ...prev,
        {
          role: "system",
          type: "context",
          title: detail.title || "已载入分析上下文",
          content: detail.prompt || "",
          context: detail.context || {}
        }
      ]);
    };

    window.addEventListener("open-ai-context", handler);
    return () => window.removeEventListener("open-ai-context", handler);
  }, []);

  const handleSend = () => {
    const content = inputValue.trim();
    if (!content) return;

    setMessages(prev => [
      ...prev,
      { role: "user", type: "text", content },
      {
        role: "assistant",
        type: "text",
        content: "通用 AI Copilot 接口尚未接入，本次已载入上下文并保留提示词，可复制到已配置的 AI 分析接口。"
      }
    ]);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-tr from-indigo-600 to-purple-600 rounded-full shadow-2xl flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-all z-50 group"
        title="打开 AI Copilot"
      >
        <Sparkles className="w-6 h-6 animate-pulse group-hover:animate-none" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[400px] h-[600px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="p-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Wand2 className="w-5 h-5 shrink-0" />
          <span className="font-semibold tracking-wide truncate">
            {activeContext?.title || "AI Copilot"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="p-1 hover:bg-white/20 rounded-md transition-colors" title="展开">
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-white/20 rounded-md transition-colors"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-slate-50 p-4 overflow-y-auto">
        <div className="space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              {msg.type === "context" ? (
                <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-2xl rounded-tl-sm text-xs text-slate-700 space-y-2 shadow-sm min-w-0 flex-1">
                  <div className="font-bold text-indigo-800">{msg.title}</div>
                  <pre className="whitespace-pre-wrap text-[11px] bg-white/70 rounded-lg p-2 max-h-40 overflow-auto">
                    {JSON.stringify(msg.context, null, 2)}
                  </pre>
                  <div className="text-slate-600 whitespace-pre-wrap">{msg.content}</div>
                </div>
              ) : (
                <div className="bg-white p-3 rounded-2xl rounded-tl-sm shadow-sm border border-slate-100 text-sm text-slate-700 whitespace-pre-wrap min-w-0 flex-1">
                  {msg.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="p-4 bg-white border-t border-slate-200 shrink-0">
        <div className="relative">
          <textarea
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="询问数据表现，或者获取优化建议..."
            className="w-full min-h-[74px] pl-4 pr-12 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-inner resize-none"
          />
          <button
            onClick={handleSend}
            className="absolute right-2 bottom-3 p-2 bg-indigo-600 text-white rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
            title="发送"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
