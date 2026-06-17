#!/usr/bin/env bash
set -euo pipefail

# Print title
echo "========================================================="
echo "       AI SAFETY BASELINE AUDIT SCRIPT v2.0"
echo "========================================================="

hard_failed=0
warnings=0

# Helper function for hard blockers
check_blocker() {
  local desc="$1"
  local dirs="$2"
  local pattern="$3"
  
  echo -n "Checking BLOCKER: $desc... "
  
  local target_paths=""
  for d in $dirs; do
    if [ -e "$d" ] || [ -f "$d" ]; then
      target_paths="$target_paths $d"
    fi
  done
  
  if [ -z "$target_paths" ]; then
    echo -e "\033[0;34mSKIPPED\033[0m"
    return 0
  fi
  
  local hit_lines
  # Exclude the audit script itself to avoid self-triggering on its rules
  hit_lines=$(grep -rnEI --exclude="audit-ai-safety.sh" "$pattern" $target_paths 2>/dev/null || true)
  
  if [ -n "$hit_lines" ]; then
    echo -e "\033[0;31mHARD FAILED\033[0m"
    echo "---------------------------------------------------------"
    echo "$hit_lines"
    echo "---------------------------------------------------------"
    hard_failed=1
  else
    echo -e "\033[0;32mPASSED\033[0m"
  fi
}

# Helper function for warnings
check_warning() {
  local desc="$1"
  local dirs="$2"
  local pattern="$3"
  
  echo -n "Checking WARNING: $desc... "
  
  local target_paths=""
  for d in $dirs; do
    if [ -e "$d" ] || [ -f "$d" ]; then
      target_paths="$target_paths $d"
    fi
  done
  
  if [ -z "$target_paths" ]; then
    echo -e "\033[0;34mSKIPPED\033[0m"
    return 0
  fi
  
  local hit_lines
  hit_lines=$(grep -rnEI --exclude="audit-ai-safety.sh" "$pattern" $target_paths 2>/dev/null || true)
  
  if [ -n "$hit_lines" ]; then
    echo -e "\033[0;33mWARNING DETECTED\033[0m"
    echo "---------------------------------------------------------"
    echo "$hit_lines"
    echo "---------------------------------------------------------"
    warnings=$((warnings + 1))
  else
    echo -e "\033[0;32mPASSED\033[0m"
  fi
}

# ----------------------------------------
# HARD BLOCKERS
# ----------------------------------------

# HARD BLOCKER A: Real AI SDK dependency check
check_blocker "Real AI SDK Dependencies" "package.json package-lock.json pnpm-lock.yaml yarn.lock" "@google/genai|openai|anthropic|ollama|deepseek-sdk|dashscope|cohere|mistralai"

# HARD BLOCKER B: Backend Real AI calls
check_blocker "Backend Real AI Calls" "src/server src/packages src/mcp-server.ts" "@google/genai|GoogleGenAI|GoogleGenerativeAI|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DASHSCOPE_API_KEY|generateContent|ai\.models|callGemini|callOpenAi|createChatCompletion|chat\.completions\.create|responses\.create|/v1/chat/completions|/v1/responses|api\.openai\.com|generativelanguage\.googleapis\.com|anthropic\.com|dashscope\.aliyuncs\.com|/ai-models|Failed to fetch AI models"

# HARD BLOCKER C: AI Key / Provider Configuration Runtime Check
check_blocker "AI Key / Provider Config in Runtime" "src/server src/packages src/components src/pages src/app" "ai_api_key|apiKeyEncrypted|upsertAiProviderSchema|updateAiProviderSchema|listAiModelsSchema|provider\s*\+\s*apiKey|AI provider and API key are required|/api/settings/ai-models|/ai-models|Failed to fetch AI models|AI models|model list"

# HARD BLOCKER D: Front-end Misleading text
check_blocker "Front-end Misleading Text" "src/components src/pages src/app" "Gemini AI|Gemini audit|API 密钥尚未配置|API Key 尚未配置|请检查 Settings 面板|配置 Gemini|配置 OpenAI|已启用真实 AI|已连接模型|模型生成完成|智能分析完成|AI 诊断失败，可能 API 密钥|Gemini AI 智能分析完成|一键启动 Gemini AI|Gemini AI 智能素材深度审计"

# HARD BLOCKER E: seed / sandbox / demo data check
check_blocker "Seed / Sandbox / Demo Data Pollution" "src/server src/packages src/components src/pages src/app prisma scripts package.json" "reseed-db-system|seed-sandbox|cleanup_demo_data|wipe_sandbox|fake order|demo data|mock data|sample data|sandbox data|seedSandboxData|Fetched: 270|2499|2505"


# ----------------------------------------
# WARNINGS (No Exit 1)
# ----------------------------------------

# WARNING A: TypeScript Bypass Check
check_warning "TypeScript Bypass Check" "src" "@ts-nocheck|@ts-ignore"

# WARNING B: Normal Buffer.from / encryption check
check_warning "Normal Encryption / Buffer Check" "src" "Buffer\.from|atob\(|btoa\(|String\.fromCharCode"

# WARNING C: Prisma AI schema leftovers
check_warning "Prisma Legacy AI Schema Leftovers" "prisma/schema.prisma" "AiProvider|AiConversation|AiMessage|AiAnalysisReport|AiActionSuggestion|apiKeyEncrypted"


# Summary Result
echo "========================================================="
if [ $warnings -gt 0 ]; then
  echo "AI safety baseline warnings detected ($warnings warned), review separately."
fi

if [ $hard_failed -eq 1 ]; then
  echo "AI safety baseline audit failed."
  exit 1
else
  echo "AI safety baseline audit passed."
  exit 0
fi
