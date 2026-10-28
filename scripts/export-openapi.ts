// יוצר את הקובץ docs/openapi.json מתוך ההגדרות בקוד:  npm run openapi:export
import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiSpec } from '../src/docs/openapi.js';

mkdirSync('docs', { recursive: true });
writeFileSync('docs/openapi.json', `${JSON.stringify(openApiSpec, null, 2)}\n`, 'utf8');
console.log('✅ docs/openapi.json written');
