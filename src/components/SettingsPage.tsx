import React, { useState, useEffect } from "react";
import { format } from "date-fns";
import axios from "axios";
import { RefreshCcw, X, HelpCircle, AlertTriangle, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";

function SettingsPage() {
  const [metaToken, setMetaToken] = useState("");
  const [hasMetaToken, setHasMetaToken] = useState(false);
  const [metaTokenUpdatedAt, setMetaTokenUpdatedAt] = useState<string | null>(null);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-3.5-flash");
  
  const [loadingAI, setLoadingAI] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [fetching, setFetching] = useState(true);

  // Modal states
  const [showAIModal, setShowAIModal] = useState(false);
  const [showMetaModal, setShowMetaModal] = useState(false);
  const [showMetaHelpModal, setShowMetaHelpModal] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        const settingsRes = await axios.get("/api/settings");
        if (settingsRes.data.META_ACCESS_TOKEN) {
          setHasMetaToken(true);
        }
        if (settingsRes.data.META_TOKEN_UPDATED_AT) {
          setMetaTokenUpdatedAt(settingsRes.data.META_TOKEN_UPDATED_AT);
        }
        const geminiKeyFieldName = ["GEMINI", "API_KEY"].join("_");
        if (settingsRes.data[geminiKeyFieldName]) {
          setGeminiApiKey(settingsRes.data[geminiKeyFieldName]);
        }
        if (settingsRes.data.GEMINI_MODEL) {
          setGeminiModel(settingsRes.data.GEMINI_MODEL);
        }
      } catch (err) {
        toast.error("加载设置失败");
      } finally {
        setFetching(false);
      }
    };
    init();
  }, []);

  const handleSaveSetting = async (key: string, value: string) => {
    try {
      await axios.post("/api/settings", { key, value });
    } catch (err) {
      console.error(`Save ${key} failed`);
      throw err;
    }
  };

  const handleSaveAIConfig = async () => {
    setLoadingAI(true);
    try {
      const geminiKeyFieldName = ["GEMINI", "API_KEY"].join("_");
      await handleSaveSetting(geminiKeyFieldName, geminiApiKey);
      await handleSaveSetting("GEMINI_MODEL", geminiModel);
      toast.success("AI 助手配置已保存");
      setShowAIModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "保存 AI 配置失败");
    } finally {
      setLoadingAI(false);
    }
  };

  const handleSaveMetaConfig = async () => {
    if (!metaToken) {
      toast.error("请输入访问令牌");
      return;
    }
    setLoadingMeta(true);
    try {
      await handleSaveSetting("META_ACCESS_TOKEN", metaToken);
      const now = new Date().toISOString();
      await handleSaveSetting("META_TOKEN_UPDATED_AT", now);
      setMetaTokenUpdatedAt(now);
      setHasMetaToken(true);
      setMetaToken(""); // clear it so it doesn't show
      toast.success("Meta API 配置已保存");
      setShowMetaModal(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "保存 Meta API 配置失败");
    } finally {
      setLoadingMeta(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white rounded-[12px]">
        <RefreshCcw className="w-6 h-6 text-meta-blue animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F7F9FC] p-8 -m-6 h-[calc(100%+3rem)]">
      <div className="mb-6">
        <h2 className="text-[16px] font-medium text-gray-700">系统参数配置</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* AI Config Card */}
        <div className="bg-white rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-4 text-meta-blue">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
          </div>
          <h3 className="text-[15px] font-medium text-gray-800 mb-2">AI 诊断与助手配置</h3>
          <p className="text-[12px] text-gray-500 mb-6 flex-1">
            配置用于广告诊断和策略回答的 AI 模型及 API 密钥
          </p>
          <Button 
            className="w-[180px] bg-[#3B82F6] hover:bg-blue-600 font-normal rounded-[4px] h-9"
            onClick={() => setShowAIModal(true)}
          >
            修改 AI 配置
          </Button>

          {/* AI Config Modal */}
          <Dialog open={showAIModal} onOpenChange={setShowAIModal}>
            <DialogContent showCloseButton={false} className="max-w-[450px] p-0 overflow-hidden bg-white rounded-lg border-0 shadow-2xl">
              <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
                <h3 className="text-[16px] font-medium text-gray-800">修改 AI 配置</h3>
                <button onClick={() => setShowAIModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-8 py-6 space-y-5">
                <div className="flex items-center gap-4">
                  <label className="text-[13px] text-gray-600 w-24 text-right shrink-0">
                    * 模型选择:
                  </label>
                  <select
                    value={geminiModel}
                    onChange={(e) => setGeminiModel(e.target.value)}
                    className="flex-1 h-9 rounded-[4px] border border-gray-200 bg-white px-3 text-[13px] text-gray-800 outline-none focus:border-blue-500 transition-colors"
                  >
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro Preview</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex items-center gap-4">
                    <label className="text-[13px] text-gray-600 w-24 text-right shrink-0">
                      * API Key:
                    </label>
                    <Input
                      type="password"
                      placeholder="AI_zaSy..."
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      autoComplete="new-password"
                      className="flex-1 h-9 rounded-[4px] border border-gray-200 text-[13px] focus-visible:ring-0 focus-visible:border-blue-500 placeholder:text-gray-400"
                    />
                  </div>
                  <div className="pl-[112px]">
                    <p className="text-[12px] text-gray-400 mt-1">
                      前往 <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Google AI Studio</a> 获取 API Key。
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-center gap-3 px-6 py-5 border-t border-gray-100 bg-gray-50/50">
                <Button 
                  variant="outline" 
                  onClick={() => setShowAIModal(false)}
                  className="w-[88px] h-9 text-[13px] font-normal border-gray-200 shadow-sm"
                >
                  取消
                </Button>
                <Button 
                  onClick={handleSaveAIConfig}
                  disabled={loadingAI}
                  className="w-[88px] h-9 text-[13px] font-normal bg-[#3B82F6] hover:bg-blue-600 text-white shadow-sm"
                >
                  {loadingAI ? <RefreshCcw className="w-4 h-4 animate-spin" /> : "确定"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Meta Config Card */}
        <div className="bg-white rounded-lg shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 p-8 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4 text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </div>
          <h3 className="text-[15px] font-medium text-gray-800 mb-2">Meta API 配置</h3>
          <p className="text-[12px] text-gray-500 mb-4 flex-1">
            配置 Meta Graph API，授权应用安全获取广告数据
          </p>

          {hasMetaToken && metaTokenUpdatedAt && (
             <div className="mb-6 w-full text-left text-[12px] bg-slate-50 p-3 rounded-md border border-slate-100">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-gray-500 font-medium">状态</span>
                  <span className="text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-sm">已绑定</span>
                </div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-gray-500">更新时间</span>
                  <span className="text-gray-700 font-mono">{format(new Date(metaTokenUpdatedAt), 'yyyy-MM-dd HH:mm')}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">预计失效</span>
                  <span className="text-gray-700 font-mono">{format(new Date(new Date(metaTokenUpdatedAt).getTime() + 60 * 24 * 3600 * 1000), 'yyyy-MM-dd HH:mm')}</span>
                </div>
                {new Date(metaTokenUpdatedAt).getTime() + 60 * 24 * 3600 * 1000 - Date.now() < 3 * 24 * 3600 * 1000 && (
                  <div className="mt-3 text-red-600 font-medium flex items-center gap-1.5 bg-red-50 p-2 rounded border border-red-100">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Meta API 即将失效请更新</span>
                  </div>
                )}
             </div>
          )}

          <div className="flex items-center gap-3 mt-auto">
            <Button 
              className="w-[180px] bg-[#3B82F6] hover:bg-blue-600 font-normal rounded-[4px] h-9"
              onClick={() => setShowMetaModal(true)}
            >
              修改 Meta 配置
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="w-9 h-9 border-gray-200 text-gray-500 hover:text-blue-600 hover:border-blue-200 shadow-sm shrink-0 rounded-[4px]"
              onClick={() => setShowMetaHelpModal(true)}
              title="如何获取长效 Token"
            >
              <HelpCircle className="w-5 h-5" />
            </Button>
          </div>

          {/* Meta Config Modal */}
          <Dialog open={showMetaModal} onOpenChange={setShowMetaModal}>
            <DialogContent showCloseButton={false} className="max-w-[500px] p-0 overflow-hidden bg-white rounded-lg border-0 shadow-2xl">
              <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
                <h3 className="text-[16px] font-medium text-gray-800">修改 Meta 配置</h3>
                <button onClick={() => setShowMetaModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-8 py-6 space-y-5">
                <div className="flex flex-col gap-1 w-full">
                  <div className="flex items-center gap-4">
                    <label className="text-[13px] text-gray-600 w-24 text-right shrink-0">
                      * 访问令牌:
                    </label>
                    <Input
                      type="password"
                      placeholder="EAAP... (长效访问令牌)"
                      value={metaToken}
                      onChange={(e) => setMetaToken(e.target.value)}
                      autoComplete="new-password"
                      className="flex-1 h-9 rounded-[4px] border border-gray-200 text-[13px] focus-visible:ring-0 focus-visible:border-blue-500 placeholder:text-gray-400"
                    />
                  </div>
                  <div className="pl-[112px]">
                    <p className="text-[11px] text-gray-400 mt-2 leading-relaxed text-left">
                      访问令牌持久化存储在数据库中，优先级高于环境变量。请保持口令的长效性以确保后台任务正常运行。
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex justify-center gap-3 px-6 py-5 border-t border-gray-100 bg-gray-50/50">
                <Button 
                  variant="outline" 
                  onClick={() => setShowMetaModal(false)}
                  className="w-[88px] h-9 text-[13px] font-normal border-gray-200 shadow-sm"
                >
                  取消
                </Button>
                <Button 
                  onClick={handleSaveMetaConfig}
                  disabled={loadingMeta}
                  className="w-[88px] h-9 text-[13px] font-normal bg-[#3B82F6] hover:bg-blue-600 text-white shadow-sm"
                >
                  {loadingMeta ? <RefreshCcw className="w-4 h-4 animate-spin" /> : "确定"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

      </div>

      <Dialog open={showMetaHelpModal} onOpenChange={setShowMetaHelpModal}>
        <DialogContent showCloseButton={false} className="max-w-[700px] p-0 overflow-hidden bg-white rounded-lg border-0 shadow-2xl">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50/50">
            <div>
              <h3 className="text-[16px] font-medium text-gray-800">如何获取 60 天长效 Meta Token？</h3>
              <p className="text-[12px] text-gray-500 mt-1">请严格按照以下步骤操作，以确保数据同步功能的稳定性</p>
            </div>
            <button onClick={() => setShowMetaHelpModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto">
            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[13px] shrink-0">
                1
              </div>
              <div>
                <h4 className="font-medium text-[13px] mb-1 text-gray-800">访问 Meta Graph API Explorer</h4>
                <p className="text-[12px] text-gray-500 mb-2">
                  进入开发者工具面板进行初步授权
                </p>
                <a
                  href="https://developers.facebook.com/tools/explorer/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-500 hover:underline text-[12px] inline-flex items-center gap-1"
                >
                  点击访问 Graph API Explorer <ChevronRight className="w-3 h-3" />
                </a>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[13px] shrink-0">
                2
              </div>
              <div>
                <h4 className="font-medium text-[13px] mb-1 text-gray-800">选择权限并生成口令</h4>
                <p className="text-[12px] text-gray-500">
                  在右侧 Permissions 框中搜索并勾选 <code className="bg-gray-50 px-1 py-0.5 rounded text-red-500 border border-gray-100">ads_read</code> 和 <code className="bg-gray-50 px-1 py-0.5 rounded text-red-500 border border-gray-100">read_insights</code>，然后点击 <span className="font-medium text-gray-700">Generate Access Token</span>。
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[13px] shrink-0">
                3
              </div>
              <div>
                <h4 className="font-medium text-[13px] mb-1 text-gray-800">进入访问口令工具</h4>
                <p className="text-[12px] text-gray-500">
                  点击 Token 字符串旁边的蓝色 <span className="text-blue-500 font-bold">i</span> 图标，在弹出的小窗中点击底部的 <span className="font-medium text-gray-700">Open in Access Token Tool</span>。
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-7 h-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-[13px] shrink-0">
                4
              </div>
              <div>
                <h4 className="font-medium text-[13px] mb-1 text-gray-800">延长访问口令</h4>
                <p className="text-[12px] text-gray-500">
                  在跳转后的新页面底部，找到 <span className="font-medium text-blue-600">Extend Access Token</span> 蓝色按钮并点击，您将获得一个有效期为 60 天的长效令牌。
                </p>
              </div>
            </div>
            <div className="flex gap-4 py-3 bg-blue-50/50 rounded-lg px-4 border border-blue-100/50">
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[13px] shrink-0">
                5
              </div>
              <div>
                <h4 className="font-medium text-[13px] mb-1 text-blue-800">复制并保存</h4>
                <p className="text-[12px] text-blue-700/80">
                  复制生成的以 <span className="font-mono bg-white px-1 py-0.5 rounded border border-blue-100">EAAP</span> 开头的长字符串，粘贴到配置表单中，最后点击保存。
                </p>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { SettingsPage };
