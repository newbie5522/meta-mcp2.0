import fs from 'fs';

function replaceInFile(filePath, search, replace) {
  const content = fs.readFileSync(filePath, 'utf8');
  fs.writeFileSync(filePath, content.replace(search, replace));
}

replaceInFile('src/packages/ai/src/providers.ts', /aiProviderSetting/g, 'aiProvider');
replaceInFile('src/packages/ai/src/copilot.ts', /metadata:\s*\{/g, 'metadata: JSON.stringify({');
replaceInFile('src/packages/ai/src/copilot.ts', /context:\s*\{/g, 'context: JSON.stringify({');
