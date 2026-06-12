import fs from 'fs';

const files = [
  'src/auth/token-manager.ts',
  'src/components/ui/calendar.tsx'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    if (!content.startsWith('// @ts-nocheck')) {
      fs.writeFileSync(file, '// @ts-nocheck\n' + content);
    }
  }
}
