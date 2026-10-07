# 프롬프트 공방

항목(역할·배경·작업·제약·출력 형식·예시)을 채우면 바로 쓸 수 있는 프롬프트가 완성되는 정적 웹 앱입니다.
점수와 개선 팁, 업무별 템플릿 17종, 보관함(브라우저 저장), AI로 다듬기 기능을 포함합니다.

## 폴더 구조

```
.
├─ index.html                 # 메인 페이지 (단일 페이지 앱)
├─ assets/
│  ├─ css/style.css           # 디자인 토큰(라이트/다크) + 레이아웃
│  └─ js/
│     ├─ templates.js         # 템플릿·추천 칩·첫 실행 예시 데이터 (여기만 고치면 템플릿 추가 가능)
│     ├─ app.js               # 프롬프트 조립, 점수 계산, 보관함, 내보내기
│     └─ ai.js                # AI로 다듬기 (아티팩트 sample 기능 / 직접 API 키)
├─ scripts/build-artifact.mjs # claude.ai 아티팩트용 단일 파일 빌드
├─ .github/workflows/deploy-pages.yml  # GitHub Pages 자동 배포
└─ README.md
```

빌드 과정이 없습니다. `index.html`을 브라우저에서 열면 바로 동작합니다.

## 로컬 실행

```bash
# Windows / WSL2 / macOS 공통: 아무 정적 서버나 사용
python3 -m http.server 8080
# 또는
npx serve .
```

브라우저에서 `http://localhost:8080` 접속.

## 배포

### GitHub Pages (워크플로 포함)
1. 저장소 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 선택
2. `main` 브랜치에 푸시하면 `.github/workflows/deploy-pages.yml`이 자동 배포
3. 주소: `https://<계정>.github.io/<저장소>/`

### Cloudflare Pages
- Framework preset: None
- Build command: (비움)
- Build output directory: `/`

배포 후 `index.html`의 `canonical`, `og:url`을 실제 주소로 바꾸세요.

## AI로 다듬기

| 실행 환경 | 동작 |
|---|---|
| claude.ai 아티팩트로 열었을 때 | 뷰어의 `sample` 기능으로 Claude를 호출합니다. API 키가 필요 없고, 첫 사용 시 허용 여부를 묻습니다. |
| 직접 배포한 사이트 | 결과 패널의 열쇠 아이콘에서 본인의 Anthropic API 키를 입력하면 공식 SDK(`@anthropic-ai/sdk`, esm.sh에서 로드)로 직접 호출합니다. 키는 브라우저 `localStorage`에만 저장됩니다. |

- 기본 모델은 `claude-opus-5-5`이며, 거절 시 서버 측 폴백(`fallbacks: "default"`)이 켜져 있습니다. 끄려면 `assets/js/ai.js`의 `MODELS`에서 `fallbacks: false`로 바꾸세요.
- 공용 PC에서는 사용 후 AI 설정에서 키를 삭제하세요.

## 데이터 저장

- 작성 중인 초안, 보관함, 테마, API 키는 모두 브라우저 `localStorage`에만 저장됩니다. 서버로 전송되지 않습니다.
- 다른 기기로 옮기려면 보관함 → 내보내기(JSON) → 가져오기.

## 템플릿 추가

`assets/js/templates.js`의 `templates` 배열에 객체를 추가하면 됩니다. `{{변수}}` 형태로 적은 부분은 결과 패널에서 값을 채울 수 있습니다.

## 아티팩트용 빌드

```bash
node scripts/build-artifact.mjs dist/artifact.html
```

CSS/JS를 한 파일로 합치고, 아티팩트 CSP에서 막히는 Pretendard(jsdelivr) 대신 Google Fonts의 IBM Plex Sans KR을 사용합니다.
