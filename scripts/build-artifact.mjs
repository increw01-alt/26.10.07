// claude.ai 아티팩트용 단일 파일 빌드
// 사용법: node scripts/build-artifact.mjs [출력경로]
// - index.html의 <body> 내용 + CSS/JS를 하나의 파일로 합칩니다.
// - 아티팩트 뷰어는 <!doctype>/<html>/<head>/<body>를 스스로 감싸므로 본문만 출력합니다.
// - Pretendard(jsdelivr)는 아티팩트 CSP에서 막히므로 Google Fonts의 IBM Plex Sans KR로 대체합니다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || resolve(root, 'dist/artifact.html');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const css = readFileSync(resolve(root, 'assets/css/style.css'), 'utf8');
const js = ['assets/js/templates.js', 'assets/js/app.js', 'assets/js/ai.js']
  .map((p) => readFileSync(resolve(root, p), 'utf8'))
  .join('\n;\n');

const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [, '프롬프트 공방'])[1].trim();
let body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [, ''])[1];
body = body.replace(/<script\s+src="assets\/js\/[^"]+"><\/script>\s*/g, '');

const fonts = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=Nanum+Gothic+Coding:wght@400;700&display=swap';
const themeInit = "(function(){try{var t=JSON.parse(localStorage.getItem('pw.theme'));if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();";

const page = `<title>${title}</title>
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
<script>${themeInit}</script>
${body.trim()}
<script>
${js}
</script>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log('built', out, (page.length / 1024).toFixed(1) + ' KB');
