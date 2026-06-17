#!/bin/bash
set -euo pipefail

# Print title
echo "========================================================="
echo "       AI SAFETY BASELINE AUDIT SCRIPT v1.0"
echo "========================================================="

failed=0

# Helper function to check forbidden words
# Usage: check_forbidden "Description" "Directory list" "Grep Regex pattern"
check_forbidden() {
  local desc="$1"
  local dirs="$2"
  local pattern="$3"
  
  echo -n "Checking $desc... "
  
  local target_dirs=""
  for d in $dirs; do
    if [ -e "$d" ] || [ -f "$d" ]; then
      target_dirs="$target_dirs $d"
    fi
  done
  
  if [ -z "$target_dirs" ]; then
    echo "SKIPPED"
    return 0
  fi
  
  local hit_lines
  hit_lines=$(grep -rnEI "$pattern" $target_dirs 2>/dev/null || true)
  
  if [ -n "$hit_lines" ]; then
    echo -e "\033[0;31mFAILED\033[0m"
    echo "---------------------------------------------------------"
    echo "$hit_lines"
    echo "---------------------------------------------------------"
    failed=1
  else
    echo -e "\033[0;32mPASSED\033[0m"
  fi
}

check_forbidden_exclude() {
  local desc="$1"
  local dirs="$2"
  local pattern="$3"
  local exclude="$4"
  
  echo -n "Checking $desc... "
  
  local target_dirs=""
  for d in $dirs; do
    if [ -e "$d" ] || [ -f "$d" ]; then
      target_dirs="$target_dirs $d"
    fi
  done
  
  if [ -z "$target_dirs" ]; then
    echo "SKIPPED"
    return 0
  fi
  
  local hit_lines
  hit_lines=$(grep -rnEI --exclude="$exclude" "$pattern" $target_dirs 2>/dev/null || true)
  
  if [ -n "$hit_lines" ]; then
    echo -e "\033[0;31mFAILED\033[0m"
    echo "---------------------------------------------------------"
    echo "$hit_lines"
    echo "---------------------------------------------------------"
    failed=1
  else
    echo -e "\033[0;32mPASSED\033[0m"
  fi
}

# A. Real AI SDK dependency check
# package.json package-lock.json pnpm-lock.yaml yarn.lock
check_forbidden "Real AI SDK Dependencies" "package.json package-lock.json pnpm-lock.yaml yarn.lock" "@google/genai|openai|anthropic|ollama|deepseek-sdk|qwen|dashscope|cohere|mistralai"

# B. Backend Real AI Calls check
# src/server src/packages src/mcp-server.ts
check_forbidden "Backend Real AI Calls" "src/server src/packages src/mcp-server.ts" "@google/genai|GoogleGenAI|GoogleGenerativeAI|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|DASHSCOPE_API_KEY|generateContent|ai\.models|callGemini|callOpenAi|createChatCompletion|chat\.completions\.create|responses\.create|/v1/chat/completions|/v1/responses|api\.openai\.com|generativelanguage\.googleapis\.com|anthropic\.com|dashscope\.aliyuncs\.com"

# C. AI Key / Provider Configuration Runtime Check
# src/server src/packages src/components src/pages src/app
check_forbidden "AI Key / Provider Runtime Config" "src/server src/packages src/components src/pages src/app" "ai_api_key|apiKeyEncrypted|upsertAiProviderSchema|updateAiProviderSchema|listAiModelsSchema|provider\s*\+\s*apiKey|AI provider and API key are required|/api/settings/ai-models|/ai-models|Failed to fetch AI models|AI models|model list"

# D. TypeScript Bypass Check
check_forbidden "TypeScript Bypass Check" "src" "@ts-nocheck|@ts-ignore"

# E. Dynamic Obfuscation Check
check_forbidden "Dynamic Obfuscation Check" "src" "Buffer\.from|atob\(|btoa\(|String\.fromCharCodes|avoid trace detection|trace detection|obfuscated|dynamic obfuscation"

# F. User-facing Misleading Text Check
# src/components src/pages src/app
check_forbidden "User-facing Misleading Text" "src/components src/pages src/app" "Gemini AI|Gemini|API 密钥尚未配置|API Key 尚未配置|请检查 Settings 面板|配置 Gemini|配置 OpenAI|已启用真实 AI|已连接模型|模型生成完成|智能分析完成|AI 诊断失败，可能 API 密钥|Gemini AI 智能分析完成"

# G. Seed / Sandbox / Demo Data Check
# src prisma scripts package.json
check_forbidden_exclude "Seed / Sandbox / Demo Data" "src prisma scripts package.json" "reseed|seed-sandbox|cleanup_demo_data|wipe_sandbox|fake order|demo data|mock data|sample data|sandbox data|2499|2505|270" "audit-ai-safety.sh"

# Summary Result
echo "========================================================="
if [ $failed -eq 1 ]; then
  echo "AI safety baseline audit failed."
  exit 1
else
  echo "AI safety baseline audit passed."
  exit 0
fi
