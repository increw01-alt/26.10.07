/* =========================================================
   프롬프트 공방 — 메인 로직
   작성 폼 ↔ 프롬프트 조립 ↔ 점수/점검 ↔ 보관함(localStorage)
   ========================================================= */
(function () {
  'use strict';

  var D = window.PW_DATA;
  if (!D) { console.error('PW_DATA가 없습니다. templates.js를 먼저 불러오세요.'); return; }

  /* ---------- 유틸 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function fmtDate(ts) {
    try { var d = new Date(ts); return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0'); } catch (e) { return ''; }
  }
  function fmtNum(n) { try { return Number(n).toLocaleString('ko-KR'); } catch (e) { return String(n); } }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }
  };
  function icon(name, cls) { return '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }

  /* ---------- 상수 ---------- */
  var FIELD_KEYS = ['task', 'success', 'role', 'context', 'audience', 'material', 'constraints', 'format', 'length', 'formatExtra', 'tone', 'examples', 'language'];
  var FIELD_LABELS = { task: '작업', success: '성공 기준', role: '역할', context: '배경', audience: '대상 독자', material: '입력 자료', constraints: '제약 조건', format: '출력 형식', length: '분량', formatExtra: '형식 추가 지시', tone: '톤과 스타일', examples: '예시', language: '답변 언어' };
  var PROCESS_KEYS = Object.keys(D.process);
  var VAR_RE = /\{\{\s*([^{}\n]+?)\s*\}\}/g;
  var VAGUE = ['좀', '잘', '대충', '적당히', '알아서', '뭔가', '그냥', '괜찮게', '멋지게', '이쁘게', '예쁘게', '느낌있게', '센스있게', '쩔게', '최대한'];
  var BOUNDARY = '[\\s,.!?()\\[\\]"\'“”‘’~·]';
  var VAGUE_RE = new RegExp('(^|' + BOUNDARY + ')(' + VAGUE.join('|') + ')(?=$|' + BOUNDARY + ')', 'g');
  var DELIV = ['글', '기사', '포스트', '카피', '문구', '제목', '슬로건', '이메일', '메일', '요약', '분석', '번역', '코드', '함수', '컴포넌트', '페이지', '사이트', '스크립트', '표', '목록', '리스트', '계획', '기획', '제안서', '보고서', '초안', '아이디어', '시나리오', '설명', '가이드', '매뉴얼', '질문', '답변', '피드백', '리뷰', '검토', '수정안', '개선안', '비교', '정리', '설계', '디자인', '프롬프트', 'FAQ', '설문', '대본', '광고', '캠페인', '문서', '회의록', '개요', '구조', '전략', '체크리스트', '정의', '예시', '버전', '안을', '문장', '단락', '문단', '요청서', '게시물', '해시태그', '프로그램', '함수를', '쿼리', 'SQL', 'JSON', 'HTML', 'CSS', '수정', '원인'];
  var DELIV_RE = new RegExp(DELIV.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'));
  var SECTION_TITLES = { role: '역할', context: '배경', task: '작업', success: '성공 기준', audience: '대상 독자', material: '입력 자료', constraints: '제약 조건', format: '출력 형식', tone: '톤과 스타일', examples: '예시', process: '진행 방식' };
  var SECTION_TAGS = { role: 'role', context: 'context', task: 'task', success: 'success_criteria', audience: 'audience', material: 'documents', constraints: 'constraints', format: 'format', tone: 'tone', examples: 'examples', process: 'process' };

  /* ---------- 상태 ---------- */
  function emptyFields() {
    return { task: '', success: '', role: '', context: '', audience: '', material: '', constraints: '', format: 'free', length: 'any', formatExtra: '', tone: '', examples: '', language: 'ko' };
  }
  var state = { fields: emptyFields(), process: {}, structure: 'markdown', vars: {}, currentId: null, sampleLoaded: false };
  var lastEval = null;
  var undoSnapshot = null;

  /* ---------- 프롬프트 조립 ---------- */
  function roleSentence(role) {
    var r = (role || '').trim();
    if (!r) return '';
    if (/입니다|이다\.?$|이에요|예요|당신은|너는|^you are/i.test(r)) return r;
    return '당신은 ' + r + '입니다.';
  }
  function toBullets(text) {
    return (text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      return '- ' + l.replace(/^(?:[-*•·]|\d+[.)])\s*/, '');
    });
  }
  function exampleBlocks(text) {
    var t = (text || '').trim();
    return t ? t.split(/\n\s*\n/).map(function (b) { return b.trim(); }).filter(Boolean) : [];
  }
  function examplesBlock(text) {
    return exampleBlocks(text).map(function (b) { return '<example>\n' + b + '\n</example>'; }).join('\n');
  }
  function buildSections(f, p) {
    var s = [];
    function push(key, body) { body = (body || '').trim(); if (body) s.push({ key: key, title: SECTION_TITLES[key], tag: SECTION_TAGS[key], body: body }); }
    push('role', roleSentence(f.role));
    push('context', f.context);
    push('task', f.task);
    push('success', f.success);
    push('audience', f.audience);
    var mat = (f.material || '').trim();
    push('material', mat);
    var cons = toBullets(f.constraints);
    if (f.language && f.language !== 'none' && D.languages[f.language]) cons.unshift('- 답변 언어: ' + D.languages[f.language]);
    push('constraints', cons.join('\n'));
    var fmt = [];
    if (f.format && f.format !== 'free' && D.formats[f.format]) fmt.push('- 형식: ' + D.formats[f.format]);
    if (f.length && f.length !== 'any' && D.lengths[f.length]) fmt.push('- 분량: ' + D.lengths[f.length]);
    fmt = fmt.concat(toBullets(f.formatExtra));
    push('format', fmt.join('\n'));
    var tones = (f.tone || '').split(/[,，/]/).map(function (t) { return t.trim(); }).filter(Boolean);
    push('tone', tones.length ? tones.join(', ') + ' 톤으로 작성하세요.' : '');
    push('examples', examplesBlock(f.examples));
    var proc = PROCESS_KEYS.filter(function (k) { return p && p[k]; }).map(function (k) { return '- ' + D.process[k].text; });
    push('process', proc.join('\n'));
    // 긴 자료는 지시보다 앞에 두는 편이 결과가 좋습니다.
    if (mat.length > 1200) {
      var idx = -1;
      s.forEach(function (sec, i) { if (sec.key === 'material') idx = i; });
      if (idx > 0) { var m = s.splice(idx, 1)[0]; s.unshift(m); }
    }
    return s;
  }
  function renderStructure(sections, structure) {
    if (!sections.length) return '';
    return sections.map(function (sec) {
      var body = sec.body;
      if (sec.key === 'material') {
        if (structure === 'xml') return '<documents>\n<document index="1">\n<document_content>\n' + body + '\n</document_content>\n</document>\n</documents>';
        body = '"""\n' + body + '\n"""';
        return (structure === 'plain' ? sec.title + ':\n' : '# ' + sec.title + '\n') + body;
      }
      if (structure === 'xml') return '<' + sec.tag + '>\n' + body + '\n</' + sec.tag + '>';
      if (structure === 'plain') return (body.indexOf('\n') >= 0 ? sec.title + ':\n' + body : sec.title + ': ' + body);
      return '# ' + sec.title + '\n' + body;
    }).join('\n\n');
  }
  function extractVars(text) {
    var names = [], seen = {}, m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(text))) { var n = m[1].trim(); if (!seen[n]) { seen[n] = true; names.push(n); } }
    return names;
  }
  function fillVars(text, vars) {
    return text.replace(VAR_RE, function (m, name) { var v = vars[name.trim()]; return (v && v.trim()) ? v.trim() : m; });
  }
  function assembleRaw(f, p, structure) { return renderStructure(buildSections(f, p), structure); }
  function assembleFinal() { return fillVars(assembleRaw(state.fields, state.process, state.structure), state.vars); }

  /* ---------- 점수 ---------- */
  function findVague(text) {
    var hits = [], seen = {}, m;
    VAGUE_RE.lastIndex = 0;
    while ((m = VAGUE_RE.exec(text || ''))) { if (!seen[m[2]]) { seen[m[2]] = true; hits.push(m[2]); } }
    return hits;
  }
  var NEG_RE = /(하지\s?마|하지\s?않|금지|말\s?것|말아|않기|않도록|제외|없이)/;
  var EMPH_RE = /(반드시|절대|무조건|CRITICAL|MUST|IMPORTANT|!!+)/gi;
  var TRICK_RE = /(심호흡|커리어가\s?달|팁을\s?(줄게|드릴)|보상을\s?(줄게|드릴)|take a deep breath|important to my career)/i;
  var REQ_END_RE = /(주세요|하세요|해\s?줘|주십시오|바랍니다|부탁해|부탁드립니다)[.!]?(?=\s|$)/g;
  function countMatches(re, text) { var m = (text || '').match(re); return m ? m.length : 0; }
  function evaluate(f, p, assembled) {
    var items = [], penalty = 0;
    function add(key, label, weight, earned, status, tip, field, prio) {
      items.push({ key: key, label: label, weight: weight, earned: earned, status: status, tip: tip, field: field, prio: prio == null ? (weight - earned) : prio });
    }
    var task = (f.task || '').trim();
    if (task.length >= 15) add('task', '작업 명시', 15, 15, 'ok', '', 'task');
    else if (task.length) add('task', '작업 명시', 15, 7, 'warn', '작업을 한두 문장 더 자세히 적어주세요. 무엇을, 어떤 결과물로, 왜 필요한지.', 'task');
    else add('task', '작업 명시', 15, 0, 'miss', '무엇을 원하는지 작업을 적어주세요. 가장 중요한 항목입니다.', 'task');

    var vague = findVague(task);
    var hasDeliv = DELIV_RE.test(task), hasNum = /\d/.test(task);
    var sp = (hasDeliv ? 7 : 0) + (hasNum ? 3 : 0);
    if (!hasDeliv && hasNum) sp = 5;
    sp = clamp(sp - vague.length * 2, 0, 10);
    var spTip = vague.length ? "'" + vague.join("', '") + "' 같은 표현 대신 기준을 적어주세요. 예: 소제목 5개로, 300자 이내로." : '결과물의 종류와 수량을 적어주세요. 예: 제목 후보 3개, 500자 소개글.';
    add('specific', '구체성', 10, sp, sp >= 8 ? 'ok' : (sp >= 4 ? 'warn' : 'miss'), spTip, 'task');

    var suc = (f.success || '').trim();
    if (suc.length >= 10) add('success', '성공 기준', 10, 10, 'ok', '', 'success');
    else if (suc.length) add('success', '성공 기준', 10, 5, 'warn', '성공 기준을 한 문장으로 완성해주세요. 어떤 결과가 나오면 성공인지.', 'success');
    else add('success', '성공 기준', 10, 0, 'miss', '어떤 답이 좋은 답인지 한 문장으로 적어주세요. AI가 스스로 검토하는 기준이 됩니다. 예: 고치지 않고 바로 쓸 수 있으면 성공.', 'success');

    var role = (f.role || '').trim();
    add('role', '역할', 8, role.length >= 2 ? 8 : 0, role.length >= 2 ? 'ok' : 'miss', '역할을 정하면 답변의 관점과 깊이가 달라집니다. 분야와 경력을 구체적으로. 예: 10년 경력의 카피라이터.', 'role');

    var ctx = (f.context || '').trim();
    if (ctx.length >= 40) add('context', '배경', 12, 12, 'ok', '', 'context');
    else if (ctx.length) add('context', '배경', 12, 6, 'warn', '배경을 2~3문장으로 늘려보세요. 누가, 어떤 상황에서, 왜 필요한지. 이유를 알면 AI가 더 잘 일반화합니다.', 'context');
    else add('context', '배경', 12, 0, 'miss', '상황과 이유를 알려주면 답변이 일반론에서 벗어납니다. 서비스 소개, 현재 상황, 이 결과물이 필요한 이유를 적어주세요.', 'context');

    var aud = (f.audience || '').trim();
    add('audience', '대상 독자', 5, aud ? 5 : 0, aud ? 'ok' : 'miss', '결과물을 읽을 사람을 적으면 난이도와 말투가 맞춰집니다.', 'audience');

    var hasFmt = (f.format && f.format !== 'free') || (f.length && f.length !== 'any') || (f.formatExtra || '').trim();
    add('format', '출력 형식', 10, hasFmt ? 10 : 0, hasFmt ? 'ok' : 'miss', '출력 계약을 정해주세요. 형식(표, 목록, JSON), 분량, "설명 없이 결과만"처럼 구체적으로.', 'format');

    var consLines = toBullets(f.constraints).map(function (l) { return l.replace(/^- /, ''); });
    var negCount = consLines.filter(function (l) { return NEG_RE.test(l); }).length;
    var negHeavy = consLines.length >= 2 && negCount / consLines.length > 0.6;
    var consBase = consLines.length >= 2 ? 10 : (consLines.length === 1 ? 6 : 0);
    var consPos = consLines.length ? (negHeavy ? 2 : 5) : 0;
    var consTip = !consLines.length ? '꼭 지킬 것과 하지 말아야 할 것을 적어주세요. 과장 금지, 글자 수, 말투 등. 당연하지 않은 조건에는 이유를 덧붙이면 더 잘 지켜요.'
      : negHeavy ? '부정문이 많아요. "~하지 말 것" 대신 원하는 행동을 적어주세요. 예: "마크다운 금지" → "문단형 산문으로 작성".'
      : consLines.length < 2 ? '제약 조건을 하나 더 추가해보세요. 반드시 포함할 것, 언어나 말투, 길이.' : '';
    add('constraints', '제약 조건', 15, consBase + consPos, !consLines.length ? 'miss' : (consLines.length < 2 || negHeavy ? 'warn' : 'ok'), consTip, 'constraints');

    var exCount = exampleBlocks(f.examples).length;
    if (exCount >= 2) add('examples', '예시', 10, 10, 'ok', '', 'examples');
    else if (exCount === 1) add('examples', '예시', 10, 7, 'warn', '예시를 빈 줄로 나눠 2~3개 넣고 서로 다른 경우를 담으면 형식과 톤이 더 정확해져요.', 'examples');
    else add('examples', '예시', 10, 0, 'miss', '원하는 결과물 예시를 한 개만 넣어도 품질이 크게 올라갑니다. 예시는 자동으로 <example> 태그로 감싸집니다.', 'examples');

    var anyProc = PROCESS_KEYS.some(function (k) { return p && p[k]; });
    add('process', '진행 방식', 5, anyProc ? 5 : 0, anyProc ? 'ok' : 'warn', '진행 방식을 하나 이상 체크해보세요. 자료가 길면 "먼저 인용", 품질이 중요하면 "초안 → 검토 → 수정본".', 'process');

    var instr = task + '\n' + (f.constraints || '') + '\n' + (f.formatExtra || '');
    var emph = countMatches(EMPH_RE, instr);
    if (emph >= 3) { penalty += 3; add('emphasis', '강조 표현', 0, 0, 'warn', '강한 강조 표현(반드시, 절대, MUST)이 ' + emph + '개예요. 최신 모델에는 조건과 이유를 설명하는 편이 더 잘 통하고, 과한 강조는 과잉 반응을 부릅니다.', 'constraints', 6); }
    if (TRICK_RE.test(instr)) { penalty += 3; add('trick', '심리적 표현', 0, 0, 'warn', '"심호흡", "커리어가 달렸다" 같은 표현은 최신 모델에서 효과가 없거나 역효과예요. 구조와 기준으로 해결하세요.', 'task', 6); }
    var reqCount = countMatches(REQ_END_RE, task);
    if (reqCount >= 3) { penalty += 3; add('multi', '요청 개수', 0, 0, 'warn', '요청 문장이 ' + reqCount + '개예요. 한 프롬프트에는 한 작업이 좋아요. 단계를 나누거나 "초안 → 검토 → 수정본" 옵션을 써보세요.', 'task', 5); }
    if (assembled.length > 8000) { penalty += 5; add('length', '길이', 0, 0, 'warn', '프롬프트가 8,000자를 넘습니다. 핵심만 남기거나 자료를 줄여보세요.', 'material', 5); }

    var score = clamp(items.reduce(function (a, it) { return a + it.earned; }, 0) - penalty, 0, 100);
    var band = score >= 85 ? 'great' : score >= 65 ? 'good' : score >= 40 ? 'fair' : 'draft';
    var bandLabel = { great: '훌륭함', good: '좋음', fair: '보통', draft: '초안' }[band];
    var tips = items.filter(function (it) { return it.status !== 'ok'; }).sort(function (a, b) { return b.prio - a.prio; }).slice(0, 3);
    return { score: score, band: band, bandLabel: bandLabel, items: items, tips: tips, vague: vague };
  }
  function estimateTokens(text) {
    var hangul = 0, other = 0;
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if ((c >= 0xAC00 && c <= 0xD7A3) || (c >= 0x3131 && c <= 0x318E)) hangul++;
      else if (!/\s/.test(text[i])) other++;
    }
    return Math.round(hangul / 1.3 + other / 3.2);
  }

  /* ---------- 결과 시트 렌더링 ---------- */
  function markLine(raw, allowVague) {
    var ranges = [], m;
    VAR_RE.lastIndex = 0;
    while ((m = VAR_RE.exec(raw))) ranges.push([m.index, m.index + m[0].length, 'm-var']);
    if (allowVague) {
      VAGUE_RE.lastIndex = 0;
      while ((m = VAGUE_RE.exec(raw))) { var st = m.index + m[1].length; ranges.push([st, st + m[2].length, 'm-vague']); }
    }
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    ranges.forEach(function (r) {
      if (r[0] < pos) return;
      out += esc(raw.slice(pos, r[0])) + '<mark class="' + r[2] + '"' + (r[2] === 'm-vague' ? ' title="모호한 표현: 기준을 적어주세요"' : ' title="채워야 할 변수"') + '>' + esc(raw.slice(r[0], r[1])) + '</mark>';
      pos = r[1];
    });
    return out + esc(raw.slice(pos));
  }
  function sheetHtml(text, structure) {
    if (!text) return '<span class="empty">왼쪽에서 작업을 적으면 여기에 프롬프트가 만들어집니다.</span>';
    var titles = Object.keys(SECTION_TITLES).map(function (k) { return SECTION_TITLES[k]; });
    return text.split('\n').map(function (line) {
      var isHead = false;
      if (structure === 'markdown') isHead = /^# /.test(line);
      else if (structure === 'xml') isHead = /^<\/?[a-z_]+(?: index="\d+")?>$/.test(line);
      else isHead = titles.some(function (t) { return line.indexOf(t + ':') === 0; });
      if (isHead && structure === 'plain') {
        var i = line.indexOf(':');
        return '<span class="sh">' + esc(line.slice(0, i + 1)) + '</span>' + markLine(line.slice(i + 1), true);
      }
      if (isHead) return '<span class="sh">' + esc(line) + '</span>';
      return markLine(line, true);
    }).join('\n');
  }

  /* ---------- DOM 참조 ---------- */
  var el = {};
  function cacheDom() {
    el.form = $('#form');
    el.sheet = $('#sheet');
    el.score = $('#score');
    el.ringFg = $('#ringFg');
    el.scoreNum = $('#scoreNum');
    el.scoreBand = $('#scoreBand');
    el.scoreStats = $('#scoreStats');
    el.tips = $('#tips');
    el.vars = $('#vars');
    el.checkList = $('#checkList');
    el.checkSummary = $('#checkSummary');
    el.structure = $('#structure');
    el.vagueNote = $('#vagueNote');
    el.builder = $('#builder');
    el.segScore = $('#segScore');
    el.sampleBanner = $('#sampleBanner');
    el.libCount = $('#libCount');
    el.modal = $('#modal');
    el.modalTitle = $('#modalTitle');
    el.modalBody = $('#modalBody');
    el.modalFoot = $('#modalFoot');
    el.toast = $('#toast');
    el.aiBtn = $('#aiBtn');
    el.aiSettingsBtn = $('#aiSettingsBtn');
    el.aiPill = $('#aiPill');
  }

  /* ---------- 폼 ↔ 상태 ---------- */
  function readForm() {
    FIELD_KEYS.forEach(function (k) { var input = $('[data-field="' + k + '"]'); if (input) state.fields[k] = input.value; });
    state.process = {};
    $$('[data-process]').forEach(function (cb) { if (cb.checked) state.process[cb.getAttribute('data-process')] = true; });
    state.structure = el.structure.value;
  }
  function writeForm() {
    FIELD_KEYS.forEach(function (k) { var input = $('[data-field="' + k + '"]'); if (input) input.value = state.fields[k] == null ? '' : state.fields[k]; });
    $$('[data-process]').forEach(function (cb) { cb.checked = !!state.process[cb.getAttribute('data-process')]; });
    el.structure.value = state.structure;
    syncChips();
  }
  function syncChips() {
    var tones = (state.fields.tone || '').split(/[,，/]/).map(function (t) { return t.trim(); });
    $$('[data-chips="tone"] .chip').forEach(function (c) { c.setAttribute('aria-pressed', tones.indexOf(c.getAttribute('data-value')) >= 0 ? 'true' : 'false'); });
    ['constraints', 'success'].forEach(function (k) {
      var lines = toBullets(state.fields[k]).map(function (l) { return l.replace(/^- /, ''); });
      $$('[data-chips="' + k + '"] .chip').forEach(function (c) { c.setAttribute('aria-pressed', lines.indexOf(c.getAttribute('data-value')) >= 0 ? 'true' : 'false'); });
    });
    ['role', 'audience'].forEach(function (k) {
      $$('[data-chips="' + k + '"] .chip').forEach(function (c) { c.setAttribute('aria-pressed', (state.fields[k] || '').trim() === c.getAttribute('data-value') ? 'true' : 'false'); });
    });
  }

  /* ---------- 렌더 ---------- */
  function render() {
    var raw = assembleRaw(state.fields, state.process, state.structure);
    var names = extractVars(raw);
    Object.keys(state.vars).forEach(function (k) { if (names.indexOf(k) < 0) delete state.vars[k]; });
    var finalText = fillVars(raw, state.vars);
    el.sheet.innerHTML = sheetHtml(finalText, state.structure);
    renderVars(names);
    lastEval = evaluate(state.fields, state.process, finalText);
    renderScore(lastEval, finalText);
    renderChecklist(lastEval);
    renderVagueNote(lastEval);
    saveDraft();
  }
  function renderVars(names) {
    if (!names.length) { el.vars.hidden = true; el.vars.innerHTML = ''; return; }
    el.vars.hidden = false;
    var html = '<div class="vars-title">변수 채우기 <span class="hint">(' + names.length + '개 · 비워두면 그대로 표시됩니다)</span></div>';
    names.forEach(function (n, i) {
      html += '<div class="var-row"><label for="var-' + i + '" title="' + esc(n) + '">{{' + esc(n) + '}}</label><input type="text" id="var-' + i + '" data-var="' + esc(n) + '" value="' + esc(state.vars[n] || '') + '" placeholder="값 입력"></div>';
    });
    el.vars.innerHTML = html;
  }
  function renderScore(ev, text) {
    var circ = 2 * Math.PI * 20;
    el.ringFg.setAttribute('stroke-dasharray', circ.toFixed(2));
    el.ringFg.setAttribute('stroke-dashoffset', (circ * (1 - ev.score / 100)).toFixed(2));
    el.scoreNum.textContent = ev.score;
    el.score.setAttribute('data-band', ev.band);
    el.score.querySelector('.score-ring').setAttribute('aria-label', '점수 ' + ev.score + '점, ' + ev.bandLabel);
    el.scoreBand.textContent = ev.bandLabel + ' · ' + ev.score + '점';
    el.scoreStats.textContent = text ? fmtNum(text.length) + '자 · 약 ' + fmtNum(estimateTokens(text)) + ' 토큰(추정)' : '아직 내용이 없습니다';
    el.segScore.textContent = ev.score + '점';
    if (!ev.tips.length) {
      el.tips.innerHTML = '<div class="tip is-ok">' + icon('check') + '<span>필수 요소가 모두 들어갔어요. 결과를 받아보고 부족한 부분을 더 구체적으로 다듬어 보세요.</span></div>';
    } else {
      el.tips.innerHTML = ev.tips.map(function (t) {
        return '<div class="tip">' + icon('alert') + '<span>' + esc(t.tip) + '</span><button type="button" data-focus="' + esc(t.field) + '">채우기</button></div>';
      }).join('');
    }
  }
  function renderChecklist(ev) {
    var okCount = ev.items.filter(function (i) { return i.status === 'ok'; }).length;
    var total = ev.items.filter(function (i) { return i.weight > 0; }).length;
    el.checkSummary.textContent = okCount + '/' + total + ' 충족';
    el.checkList.innerHTML = ev.items.map(function (i) {
      var ic = i.status === 'ok' ? 'check' : (i.status === 'warn' ? 'alert' : 'minus');
      return '<li data-status="' + i.status + '">' + icon(ic) + '<span>' + esc(i.label) + (i.status !== 'ok' && i.tip ? ' <span class="hint">· ' + esc(i.tip) + '</span>' : '') + '</span>' + (i.weight ? '<span class="w">' + i.earned + '/' + i.weight + '</span>' : '') + '</li>';
    }).join('');
  }
  function renderVagueNote(ev) {
    if (!ev.vague.length) { el.vagueNote.hidden = true; return; }
    el.vagueNote.hidden = false;
    el.vagueNote.innerHTML = icon('alert') + '<span>모호한 표현 ' + ev.vague.map(function (v) { return '<mark>' + esc(v) + '</mark>'; }).join(' ') + ' → 숫자나 조건으로 바꿔보세요. 예: "잘 정리" 대신 "소제목 4개로 정리".</span>';
  }

  /* ---------- 초안 저장/복원 ---------- */
  var saveDraft = debounce(function () {
    store.set('pw.draft', { fields: state.fields, process: state.process, structure: state.structure, vars: state.vars, currentId: state.currentId, sampleLoaded: state.sampleLoaded });
  }, 250);
  function loadDraft() {
    var d = store.get('pw.draft', null);
    if (!d || !d.fields) return false;
    state.fields = Object.assign(emptyFields(), d.fields);
    state.process = d.process || {};
    state.structure = d.structure || 'markdown';
    state.vars = d.vars || {};
    state.currentId = d.currentId || null;
    state.sampleLoaded = !!d.sampleLoaded;
    return true;
  }

  /* ---------- 필드 적용 ---------- */
  function applyFields(fields, process, opts) {
    opts = opts || {};
    if (opts.snapshot !== false) undoSnapshot = { fields: Object.assign({}, state.fields), process: Object.assign({}, state.process), vars: Object.assign({}, state.vars) };
    state.fields = Object.assign(emptyFields(), fields || {});
    if (process) state.process = Object.assign({}, process);
    if (opts.resetVars !== false) state.vars = {};
    if (opts.currentId !== undefined) state.currentId = opts.currentId;
    state.sampleLoaded = !!opts.sample;
    el.sampleBanner.hidden = !state.sampleLoaded;
    writeForm();
    render();
  }
  function restoreSnapshot() {
    if (!undoSnapshot) return;
    var s = undoSnapshot; undoSnapshot = null;
    applyFields(s.fields, s.process, { snapshot: false, resetVars: false });
    state.vars = s.vars; render();
  }
  function isFormEmpty() {
    return !FIELD_KEYS.some(function (k) { return ['format', 'length', 'language'].indexOf(k) < 0 && (state.fields[k] || '').trim(); });
  }

  /* ---------- 템플릿 ---------- */
  function templateById(id) { for (var i = 0; i < D.templates.length; i++) if (D.templates[i].id === id) return D.templates[i]; return null; }
  function loadTemplate(id) {
    var t = templateById(id);
    if (!t) return;
    var doLoad = function () {
      applyFields(t.fields, t.process, { currentId: null });
      location.hash = 'builder';
      setPane('form');
      toast('"' + t.title + '" 템플릿을 불러왔어요. {{변수}}는 결과 패널에서 채울 수 있어요.');
      var first = $('[data-field="task"]'); if (first) first.focus();
    };
    if (!isFormEmpty() && !state.sampleLoaded) {
      openModal({
        title: '현재 내용을 덮어쓸까요?',
        body: '<p>작성 중인 내용이 템플릿으로 바뀝니다. 필요하면 먼저 저장해 두세요. (덮어쓴 뒤에도 "되돌리기"로 복구할 수 있어요)</p>',
        actions: [
          { label: '취소', onClick: closeModal },
          { label: '덮어쓰기', primary: true, onClick: function () { closeModal(); doLoad(); toast('템플릿을 불러왔어요.', { label: '되돌리기', onClick: restoreSnapshot }); } }
        ]
      });
    } else doLoad();
  }
  var tplFilter = { cat: '전체', q: '' };
  function renderTemplates() {
    var grid = $('#tplGrid'), empty = $('#tplEmpty');
    var q = tplFilter.q.trim().toLowerCase();
    var list = D.templates.filter(function (t) {
      if (tplFilter.cat !== '전체' && t.cat !== tplFilter.cat) return false;
      if (!q) return true;
      return (t.title + ' ' + t.desc + ' ' + t.tags.join(' ') + ' ' + t.fields.task).toLowerCase().indexOf(q) >= 0;
    });
    grid.innerHTML = list.map(function (t) {
      return '<article class="tpl-card" data-id="' + t.id + '">' +
        '<div class="tpl-cat">' + esc(t.cat) + '</div>' +
        '<h3>' + esc(t.title) + '</h3>' +
        '<p>' + esc(t.desc) + '</p>' +
        '<div class="tpl-tags">' + t.tags.map(function (x) { return '<span class="tag">' + esc(x) + '</span>'; }).join('') + '</div>' +
        '<div class="tpl-foot"><button type="button" class="btn btn-primary btn-sm" data-use="' + t.id + '">' + icon('pen') + '사용하기</button><button type="button" class="btn-link" data-preview="' + t.id + '">미리보기</button></div>' +
        '<pre class="sheet tpl-preview" hidden></pre>' +
        '</article>';
    }).join('');
    empty.hidden = list.length > 0;
  }
  function renderTemplateCats() {
    $('#tplCats').innerHTML = D.categories.map(function (c) {
      return '<button type="button" class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (c === tplFilter.cat ? 'true' : 'false') + '">' + esc(c) + '</button>';
    }).join('');
  }
  function renderQuickstart() {
    var box = $('#quickChips');
    box.innerHTML = D.templates.slice(0, 6).map(function (t) { return '<button type="button" class="chip" data-use="' + t.id + '">' + esc(t.title) + '</button>'; }).join('');
  }

  /* ---------- 보관함 ---------- */
  function getSaved() { var s = store.get('pw.saved', []); return Array.isArray(s) ? s : []; }
  function setSaved(list) { var ok = store.set('pw.saved', list); updateLibCount(); return ok; }
  function updateLibCount() { var n = getSaved().length; el.libCount.textContent = n; el.libCount.hidden = n === 0; }
  function defaultTitle() {
    var t = (state.fields.task || '').trim().split('\n')[0];
    return t.length > 40 ? t.slice(0, 40) + '…' : (t || '제목 없는 프롬프트');
  }
  function openSaveModal() {
    readForm();
    if (isFormEmpty()) { toast('저장할 내용이 없어요. 작업을 먼저 적어주세요.'); return; }
    var existing = state.currentId ? getSaved().filter(function (x) { return x.id === state.currentId; })[0] : null;
    var body = document.createElement('div');
    body.innerHTML = '<label for="saveName">이름</label><input type="text" id="saveName" maxlength="80" value="' + esc(existing ? existing.title : defaultTitle()) + '"><p class="field-note">이 브라우저에만 저장됩니다. 다른 기기에서 쓰려면 보관함에서 내보내기를 이용하세요.</p>';
    var actions = [{ label: '취소', onClick: closeModal }];
    if (existing) actions.push({ label: '덮어쓰기', onClick: function () { persist(existing.id, $('#saveName').value); } });
    actions.push({ label: existing ? '새로 저장' : '저장', primary: true, onClick: function () { persist(null, $('#saveName').value); } });
    openModal({ title: '보관함에 저장', body: body, actions: actions });
    setTimeout(function () { var i = $('#saveName'); if (i) { i.focus(); i.select(); } }, 30);
    function persist(id, name) {
      name = (name || '').trim() || defaultTitle();
      var list = getSaved(), now = Date.now();
      var item = { id: id || uid(), title: name, createdAt: now, updatedAt: now, fields: Object.assign({}, state.fields), process: Object.assign({}, state.process), structure: state.structure, vars: Object.assign({}, state.vars), score: lastEval ? lastEval.score : 0 };
      if (id) {
        list = list.map(function (x) { if (x.id === id) { item.createdAt = x.createdAt; return item; } return x; });
      } else list.unshift(item);
      if (!setSaved(list)) { toast('저장하지 못했어요. 브라우저 저장 공간을 확인해주세요.'); return; }
      state.currentId = item.id; state.sampleLoaded = false; el.sampleBanner.hidden = true; saveDraft();
      closeModal();
      toast('보관함에 저장했어요.', { label: '보관함 열기', onClick: function () { location.hash = 'library'; } });
    }
  }
  function renderLibrary() {
    var list = getSaved(), box = $('#libList'), empty = $('#libEmpty');
    empty.hidden = list.length > 0;
    box.innerHTML = list.map(function (it) {
      var circ = 2 * Math.PI * 20, sc = clamp(Number(it.score) || 0, 0, 100);
      var band = sc >= 85 ? 'great' : sc >= 65 ? 'good' : sc >= 40 ? 'fair' : 'draft';
      var snippet = (it.fields && it.fields.task || '').replace(/\s+/g, ' ').trim();
      return '<article class="lib-item" data-id="' + esc(it.id) + '">' +
        '<div class="score" data-band="' + band + '"><div class="score-ring" role="img" aria-label="점수 ' + sc + '점"><svg viewBox="0 0 48 48"><circle class="ring-bg" cx="24" cy="24" r="20"/><circle class="ring-fg" cx="24" cy="24" r="20" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + (circ * (1 - sc / 100)).toFixed(2) + '"/></svg><span class="score-num">' + sc + '</span></div></div>' +
        '<div class="lib-main"><h3>' + esc(it.title) + '</h3><p>' + esc(snippet) + '</p><div class="meta">' + fmtDate(it.updatedAt || it.createdAt) + ' · ' + (it.structure === 'xml' ? 'XML 태그' : it.structure === 'plain' ? '일반 문단' : '마크다운') + (it.fields && it.fields.role ? ' · ' + esc(it.fields.role.slice(0, 24)) : '') + '</div></div>' +
        '<div class="lib-actions"><button type="button" class="btn btn-primary btn-sm" data-open="' + esc(it.id) + '">열기</button><button type="button" class="btn btn-sm" data-copy="' + esc(it.id) + '">복사</button><button type="button" class="btn btn-sm btn-danger" data-del="' + esc(it.id) + '">삭제</button></div>' +
        '</article>';
    }).join('');
  }
  function openSaved(id) {
    var it = getSaved().filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    applyFields(it.fields, it.process, { currentId: it.id, resetVars: true });
    state.vars = it.vars || {}; state.structure = it.structure || 'markdown'; el.structure.value = state.structure; render();
    location.hash = 'builder'; setPane('form');
    toast('"' + it.title + '"을(를) 불러왔어요.');
  }
  function deleteSaved(id, btn) {
    if (btn.getAttribute('data-armed') !== '1') {
      btn.setAttribute('data-armed', '1'); btn.textContent = '정말 삭제';
      setTimeout(function () { if (btn.isConnected) { btn.removeAttribute('data-armed'); btn.textContent = '삭제'; } }, 3000);
      return;
    }
    var list = getSaved(), removed = list.filter(function (x) { return x.id === id; })[0];
    setSaved(list.filter(function (x) { return x.id !== id; }));
    if (state.currentId === id) { state.currentId = null; saveDraft(); }
    renderLibrary();
    toast('삭제했어요.', { label: '되돌리기', onClick: function () { var l = getSaved(); l.unshift(removed); setSaved(l); renderLibrary(); } });
  }
  function exportLibrary() {
    var list = getSaved();
    if (!list.length) { toast('내보낼 프롬프트가 없어요.'); return; }
    saveFile('prompts-' + fmtDate(Date.now()).replace(/\./g, '') + '.json', JSON.stringify({ app: 'prompt-workshop', version: 1, exportedAt: new Date().toISOString(), items: list }, null, 2));
  }
  function importLibrary(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        var items = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
        if (!items) throw new Error('형식');
        var list = getSaved(), ids = {}; list.forEach(function (x) { ids[x.id] = true; });
        var added = 0;
        items.forEach(function (it) {
          if (!it || !it.fields || typeof it.fields.task !== 'string') return;
          var copy = { id: (it.id && !ids[it.id]) ? it.id : uid(), title: String(it.title || '가져온 프롬프트').slice(0, 80), createdAt: Number(it.createdAt) || Date.now(), updatedAt: Number(it.updatedAt) || Date.now(), fields: Object.assign(emptyFields(), it.fields), process: it.process || {}, structure: it.structure || 'markdown', vars: it.vars || {}, score: clamp(Number(it.score) || 0, 0, 100) };
          ids[copy.id] = true; list.push(copy); added++;
        });
        setSaved(list); renderLibrary();
        toast(added ? added + '개를 가져왔어요.' : '가져올 수 있는 항목이 없었어요.');
      } catch (e) { toast('파일을 읽지 못했어요. 이 사이트에서 내보낸 JSON 파일인지 확인해주세요.'); }
    };
    reader.onerror = function () { toast('파일을 읽지 못했어요.'); };
    reader.readAsText(file);
  }

  /* ---------- 복사 / 파일 ---------- */
  function copyText(text) {
    var p;
    try { p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard')); } catch (e) { p = Promise.reject(e); }
    return p.then(function () { return true; }).catch(function () {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); return !!ok;
      } catch (e2) { return false; }
    });
  }
  function doCopy() {
    readForm();
    var text = assembleFinal();
    if (!text) { toast('복사할 내용이 없어요.'); return; }
    copyText(text).then(function (ok) {
      if (ok) toast('프롬프트를 복사했어요. AI 채팅창에 붙여넣으세요.');
      else showCopyFallback(text);
    });
  }
  function showCopyFallback(text) {
    var body = document.createElement('div');
    body.innerHTML = '<p>자동 복사가 막혀 있어요. 아래 내용을 직접 선택해서 복사해주세요.</p><textarea id="fallbackText" rows="12" readonly></textarea>';
    body.querySelector('textarea').value = text;
    openModal({ title: '직접 복사', body: body, actions: [{ label: '닫기', primary: true, onClick: closeModal }] });
    setTimeout(function () { var t = $('#fallbackText'); if (t) { t.focus(); t.select(); } }, 30);
  }
  function saveFile(filename, text) {
    if (window.claude && typeof window.claude.use === 'function') {
      return window.claude.use('downloads').then(function (dl) {
        if (!dl) { showCopyFallback(text); return 'unavailable'; }
        return dl.save({ filename: filename, data: text }).then(function () { toast('파일을 저장했어요.'); return 'saved'; }).catch(function (e) {
          if (e && e.code === 'declined') return 'declined';
          showCopyFallback(text); return 'error';
        });
      }).catch(function () { showCopyFallback(text); return 'error'; });
    }
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
      return Promise.resolve('saved');
    } catch (e) { showCopyFallback(text); return Promise.resolve('error'); }
  }
  function exportPrompt(kind) {
    readForm();
    var text = assembleFinal();
    if (!text) { toast('내보낼 내용이 없어요.'); return; }
    var base = 'prompt-' + fmtDate(Date.now()).replace(/\./g, '');
    if (kind === 'json') saveFile(base + '.json', JSON.stringify({ app: 'prompt-workshop', version: 1, title: defaultTitle(), fields: state.fields, process: state.process, structure: state.structure, vars: state.vars, prompt: text }, null, 2));
    else if (kind === 'md') saveFile(base + '.md', text);
    else saveFile(base + '.txt', text);
  }

  /* ---------- 모달 / 토스트 ---------- */
  var lastFocus = null;
  function openModal(opts) {
    el.modalTitle.textContent = opts.title || '';
    el.modalBody.innerHTML = '';
    if (typeof opts.body === 'string') el.modalBody.innerHTML = opts.body; else if (opts.body) el.modalBody.appendChild(opts.body);
    el.modalFoot.innerHTML = '';
    (opts.actions || []).forEach(function (a) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : '') + (a.left ? ' left' : '');
      b.textContent = a.label; if (a.id) b.id = a.id;
      b.addEventListener('click', function () { if (a.onClick) a.onClick(b); });
      el.modalFoot.appendChild(b);
    });
    el.modalFoot.hidden = !(opts.actions && opts.actions.length);
    lastFocus = document.activeElement;
    el.modal.hidden = false;
    var f = el.modalBody.querySelector('input, textarea, select, button') || el.modal.querySelector('[data-close]');
    if (f) setTimeout(function () { f.focus(); }, 20);
  }
  function closeModal() {
    el.modal.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* 무시 */ } }
  }
  var toastTimer = null;
  function toast(msg, action, duration) {
    clearTimeout(toastTimer);
    el.toast.innerHTML = '<span></span>';
    el.toast.firstChild.textContent = msg;
    if (action) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = action.label;
      b.addEventListener('click', function () { el.toast.hidden = true; action.onClick(); });
      el.toast.appendChild(b);
    }
    el.toast.hidden = false;
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, duration || (action ? 6000 : 3200));
  }

  /* ---------- 라우팅 / 테마 / 패널 ---------- */
  var VIEWS = ['builder', 'templates', 'library', 'guide'];
  function hashToView() { var h = (location.hash || '').replace('#', ''); return VIEWS.indexOf(h) >= 0 ? h : 'builder'; }
  var currentView = null;
  function showView(name) {
    VIEWS.forEach(function (v) {
      var sec = $('#view-' + v); if (sec) sec.classList.toggle('is-active', v === name);
    });
    $$('.nav-item').forEach(function (a) {
      var active = a.getAttribute('data-view') === name;
      a.classList.toggle('is-active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (name === 'library') renderLibrary();
    if (currentView && currentView !== name) window.scrollTo(0, 0);
    currentView = name;
  }
  function setPane(p) {
    el.builder.setAttribute('data-pane', p);
    $$('.seg button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-pane') === p ? 'true' : 'false'); });
  }
  var THEME_SEQ = ['light', 'dark', 'system'];
  function applyTheme(mode, fromUser) {
    var root = document.documentElement;
    if (mode === 'system') { if (fromUser) root.removeAttribute('data-theme'); }
    else root.setAttribute('data-theme', mode);
    var iconName = mode === 'dark' ? 'moon' : mode === 'light' ? 'sun' : 'monitor';
    var use = $('#themeIcon use'); if (use) use.setAttribute('href', '#i-' + iconName);
    var btn = $('#themeBtn'); if (btn) btn.setAttribute('title', '테마: ' + ({ light: '밝게', dark: '어둡게', system: '시스템 설정' })[mode] + ' (클릭하여 변경)');
  }
  function initTheme() {
    var saved = store.get('pw.theme', 'system');
    if (THEME_SEQ.indexOf(saved) < 0) saved = 'system';
    applyTheme(saved, false);
    $('#themeBtn').addEventListener('click', function () {
      var cur = store.get('pw.theme', 'system'); if (THEME_SEQ.indexOf(cur) < 0) cur = 'system';
      var next = THEME_SEQ[(THEME_SEQ.indexOf(cur) + 1) % THEME_SEQ.length];
      store.set('pw.theme', next); applyTheme(next, true);
    });
  }

  /* ---------- 이벤트 ---------- */
  function focusField(key) {
    setPane('form');
    var target = key === 'process' ? $('[data-process]') : (key === 'format' ? $('[data-field="format"]') : $('[data-field="' + key + '"]'));
    if (!target) return;
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { target.scrollIntoView(); }
    setTimeout(function () { target.focus(); }, 250);
  }
  function bindEvents() {
    var onInput = debounce(function () {
      readForm(); syncChips();
      if (state.sampleLoaded) { state.sampleLoaded = false; el.sampleBanner.hidden = true; }
      render();
    }, 120);
    el.form.addEventListener('input', onInput);
    el.form.addEventListener('change', onInput);
    el.form.addEventListener('submit', function (e) { e.preventDefault(); });
    el.structure.addEventListener('change', function () { readForm(); render(); });

    // 추천 칩
    document.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-chips] .chip');
      if (chip) {
        var group = chip.closest('[data-chips]').getAttribute('data-chips'), val = chip.getAttribute('data-value');
        readForm();
        if (group === 'tone') {
          var tones = (state.fields.tone || '').split(/[,，/]/).map(function (t) { return t.trim(); }).filter(Boolean);
          var i = tones.indexOf(val); if (i >= 0) tones.splice(i, 1); else tones.push(val);
          state.fields.tone = tones.join(', ');
        } else if (group === 'constraints' || group === 'success') {
          var lines = toBullets(state.fields[group]).map(function (l) { return l.replace(/^- /, ''); });
          var j = lines.indexOf(val); if (j >= 0) lines.splice(j, 1); else lines.push(val);
          state.fields[group] = lines.map(function (l) { return (group === 'constraints' ? '- ' : '') + l; }).join('\n');
        } else {
          state.fields[group] = ((state.fields[group] || '').trim() === val) ? '' : val;
        }
        writeForm(); render();
        return;
      }
      var focusBtn = e.target.closest('[data-focus]');
      if (focusBtn) { focusField(focusBtn.getAttribute('data-focus')); return; }
      var useBtn = e.target.closest('[data-use]');
      if (useBtn) { loadTemplate(useBtn.getAttribute('data-use')); return; }
      var prevBtn = e.target.closest('[data-preview]');
      if (prevBtn) {
        var t = templateById(prevBtn.getAttribute('data-preview'));
        var pre = prevBtn.closest('.tpl-card').querySelector('.tpl-preview');
        if (pre.hidden) { pre.innerHTML = sheetHtml(assembleRaw(Object.assign(emptyFields(), t.fields), t.process, 'markdown'), 'markdown'); pre.hidden = false; prevBtn.textContent = '닫기'; }
        else { pre.hidden = true; prevBtn.textContent = '미리보기'; }
        return;
      }
      var catBtn = e.target.closest('[data-cat]');
      if (catBtn) { tplFilter.cat = catBtn.getAttribute('data-cat'); renderTemplateCats(); renderTemplates(); return; }
      var openBtn = e.target.closest('[data-open]');
      if (openBtn) { openSaved(openBtn.getAttribute('data-open')); return; }
      var copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) {
        var it = getSaved().filter(function (x) { return x.id === copyBtn.getAttribute('data-copy'); })[0];
        if (it) copyText(fillVars(assembleRaw(Object.assign(emptyFields(), it.fields), it.process, it.structure || 'markdown'), it.vars || {})).then(function (ok) { toast(ok ? '복사했어요.' : '복사하지 못했어요. 열기 후 직접 복사해주세요.'); });
        return;
      }
      var delBtn = e.target.closest('[data-del]');
      if (delBtn) { deleteSaved(delBtn.getAttribute('data-del'), delBtn); return; }
      var segBtn = e.target.closest('.seg button');
      if (segBtn) { setPane(segBtn.getAttribute('data-pane')); return; }
      if (e.target.closest('[data-close]')) { closeModal(); return; }
      var menuBtn = e.target.closest('#exportBtn');
      var menuList = $('#exportMenu');
      if (menuBtn) { var open = menuList.hidden; menuList.hidden = !open; menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); return; }
      var exportItem = e.target.closest('[data-export]');
      if (exportItem) { menuList.hidden = true; $('#exportBtn').setAttribute('aria-expanded', 'false'); exportPrompt(exportItem.getAttribute('data-export')); return; }
      if (!e.target.closest('.menu')) { menuList.hidden = true; $('#exportBtn').setAttribute('aria-expanded', 'false'); }
    });

    // 변수 입력
    el.vars.addEventListener('input', function (e) {
      var inp = e.target.closest('[data-var]'); if (!inp) return;
      state.vars[inp.getAttribute('data-var')] = inp.value;
      var raw = assembleRaw(state.fields, state.process, state.structure);
      var finalText = fillVars(raw, state.vars);
      el.sheet.innerHTML = sheetHtml(finalText, state.structure);
      lastEval = evaluate(state.fields, state.process, finalText); renderScore(lastEval, finalText);
      saveDraft();
    });

    $('#copyBtn').addEventListener('click', doCopy);
    $('#saveBtn').addEventListener('click', openSaveModal);
    $('#clearBtn').addEventListener('click', function () {
      readForm();
      if (isFormEmpty()) return;
      applyFields(emptyFields(), {}, { currentId: null });
      toast('비웠어요.', { label: '되돌리기', onClick: restoreSnapshot });
    });
    $('#sampleClear').addEventListener('click', function () { applyFields(emptyFields(), {}, { currentId: null }); var f = $('[data-field="task"]'); if (f) f.focus(); });
    $('#tplSearch').addEventListener('input', debounce(function (e) { tplFilter.q = e.target.value; renderTemplates(); }, 120));
    $('#libExport').addEventListener('click', exportLibrary);
    $('#libImport').addEventListener('change', function (e) { var f = e.target.files && e.target.files[0]; if (f) importLibrary(f); e.target.value = ''; });
    $('#libClear').addEventListener('click', function () {
      if (!getSaved().length) return;
      openModal({ title: '보관함을 모두 비울까요?', body: '<p>저장한 프롬프트 ' + getSaved().length + '개가 삭제됩니다. 되돌릴 수 없으니 필요하면 먼저 내보내기를 해두세요.</p>', actions: [{ label: '취소', onClick: closeModal }, { label: '모두 삭제', danger: true, onClick: function () { setSaved([]); renderLibrary(); closeModal(); toast('보관함을 비웠어요.'); } }] });
    });

    window.addEventListener('hashchange', function () { showView(hashToView()); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !el.modal.hidden) { closeModal(); return; }
      var mod = e.ctrlKey || e.metaKey;
      if (!mod || currentView !== 'builder' || !el.modal.hidden) return;
      if (e.key === 'Enter') { e.preventDefault(); doCopy(); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); openSaveModal(); }
    });
  }

  /* ---------- 초기화 ---------- */
  function init() {
    cacheDom();
    initTheme();
    renderQuickstart();
    renderTemplateCats();
    renderTemplates();
    updateLibCount();
    bindEvents();
    if (!loadDraft()) {
      state.fields = Object.assign(emptyFields(), D.sample.fields);
      state.process = Object.assign({}, D.sample.process);
      state.sampleLoaded = true;
    }
    el.sampleBanner.hidden = !state.sampleLoaded;
    writeForm();
    render();
    showView(hashToView());
    setPane('form');
  }

  /* ---------- 외부(AI 모듈)용 API ---------- */
  window.PW = {
    getState: function () { readForm(); return { fields: Object.assign({}, state.fields), process: Object.assign({}, state.process), structure: state.structure, vars: Object.assign({}, state.vars) }; },
    getPrompt: function () { readForm(); return assembleFinal(); },
    applyFields: function (fields, process) {
      readForm();
      var merged = Object.assign({}, state.fields, fields || {});
      applyFields(merged, process || state.process, { currentId: state.currentId, resetVars: false });
    },
    restore: restoreSnapshot,
    labels: FIELD_LABELS,
    openModal: openModal, closeModal: closeModal, toast: toast, esc: esc, store: store, icon: icon,
    setAi: function (opts) {
      // opts: { available: bool, kind: 'sample'|'direct', onClick: fn, settings: fn, label: string }
      el.aiBtn.hidden = !opts.available;
      el.aiSettingsBtn.hidden = !(opts.available && opts.settings);
      if (opts.available) {
        el.aiBtn.onclick = opts.onClick;
        if (opts.settings) el.aiSettingsBtn.onclick = opts.settings;
        el.aiPill.hidden = !opts.label; el.aiPill.textContent = opts.label || '';
      } else { el.aiPill.hidden = true; }
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
