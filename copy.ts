import fs from 'fs';
import path from 'path';

const files = [
  'StoresDashboard.tsx',
  'SettingsPage.tsx',
  'LoginPage.tsx'
];

for (const f of files) {
  const src = path.join(process.cwd(), 'repo_reference/src/components', f);
  const dest = path.join(process.cwd(), 'src/components', f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`Copied ${f}`);
  }
}
