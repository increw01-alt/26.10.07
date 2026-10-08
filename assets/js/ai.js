/* =========================================================
   프롬프트 공방 — AI로 다듬기
   두 가지 연결 방식 중 하나가 자동으로 선택됩니다.
   1) claude.ai 아티팩트로 열었을 때: 뷰어의 `sample` 기능 사용 (API 키 불필요)
   2) 직접 배포한 사이트(GitHub Pages, Cloudflare Pages 등): 본인의 Anthropic API 키를
      브라우저에 저장해 두고 공식 SDK(@anthropic-ai/sdk)로 호출
   - API 키는 이 브라우저의 localStorage에만 저장되며 어디에도 전송되지 않습니다(Anthropic API 제외).
   ========================================================= */
(function () {
  'use strict';
  var PW = window.PW;
  if (!PW) return;

  /* 설정: 필요하면 여기만 바꾸세요. */
  var SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@0.131.0';
  var MODELS = [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (기본, 가장 정확)', effort: true, fallbacks: true },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름)', effort: true, fallbacks: true },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (가장 저렴)', effort: false, fallbacks: false }
  ];
  var KEY_STORE = 'pw.ai.key', MODEL_STORE = 'pw.ai.model';
  var EDITABLE = ['task', 'success', 'role', 'context', 'audience', 'constraints', 'formatExtra', 'tone', 'examples'];

  var provider = null;   // { kind: 'sample', sample } 또는 { kind: 'direct' }
  var controller = null;

  /* ---------- 프롬프트 ----------
     GitHub의 prompt-engineering 스킬(PhAlves23, MIT)의 5단계 워크플로우와 황금률,
     Anthropic 'Prompting best practices'를 바탕으로 작성했습니다. */
  var SYSTEM = '당신은 프롬프트 엔지니어입니다. 사용자가 AI에게 보낼 프롬프트의 각 항목을 검증된 프롬프트 엔지니어링 기법(Anthropic 프롬프트 작성 가이드, The Prompt Report의 기법 분류)에 따라 더 구체적이고 실행 가능하게 다듬습니다. 사용자가 적지 않은 사실(수치, 회사명, 실적, 날짜, 이름)은 절대 지어내지 않습니다.';
  function buildInput(st) {
    var f = st.fields, subset = {};
    EDITABLE.forEach(function (k) { subset[k] = f[k] || ''; });
    var extra = [];
    if ((f.material || '').trim()) extra.push('입력 자료: 있음 (' + f.material.length + '자, 수정 대상 아님, 프롬프트에서 자동으로 태그로 구분됨)');
    if (f.format && f.format !== 'free') extra.push('선택된 출력 형식: ' + f.format);
    if (f.length && f.length !== 'any') extra.push('선택된 분량: ' + f.length);
    var proc = Object.keys(st.process || {}).filter(function (k) { return st.process[k]; });
    if (proc.length) extra.push('선택된 진행 방식 옵션: ' + proc.join(', ') + ' (별도 항목으로 자동 삽입됨)');
    return SYSTEM + '\n\n' +
      '작업 순서:\n' +
      '1. 진단: 실제 의도, 작업 유형(분류·추출·글쓰기·코딩·분석·리서치·요약·대화 중 하나), 읽는 사람, 출력 형식, 초안의 약점을 파악합니다. 약점 예: 모호한 표현, 결과물 종류·수량 없음, 범위 불명확, 부정문 위주의 지시, 이유 없는 지시, 성공 기준 없음, 형식 미지정, 예시 부족.\n' +
      '2. 기법 선택: 작업 유형에 실제로 도움이 되는 기법만 고릅니다. 단순한 작업에 기법을 덧붙여 부풀리지 마세요.\n' +
      '3. 재작성: 각 항목을 다시 씁니다. 역할은 분야와 경력이 구체적인 한 줄, 작업은 결과물·수량·목표가 드러나게, 배경은 상황과 이유, 제약은 긍정문 목록, 성공 기준은 검증 가능한 한 문장.\n' +
      '4. 자기 검토: 맥락이 없는 동료가 읽어도 바로 실행할 수 있는지, 범위가 명확한지(예: "첫 항목만이 아니라 모든 항목에"), 긍정문인지, 당연하지 않은 지시에 이유가 있는지 확인합니다.\n\n' +
      '규칙:\n' +
      '- 사용자가 적지 않은 사실을 지어내지 마세요. 꼭 필요한 정보가 비어 있으면 {{변수명}} 자리표시자로 남기고, 원본에 있던 {{변수}}는 그대로 보존하세요.\n' +
      '- "잘", "좀", "적당히" 같은 모호한 표현은 측정 가능한 기준으로 바꾸세요.\n' +
      '- "~하지 마세요"는 원하는 행동을 적는 긍정문으로 바꾸세요. 당연하지 않은 지시에는 이유를 한 구절 덧붙이세요.\n' +
      '- success(성공 기준)가 비어 있으면 작업 내용으로부터 검증 가능한 한 문장을 만들어 채우세요. 그 외 비어 있는 항목은 꼭 필요할 때만 짧게 채우고, 나머지는 빈 문자열로 두세요.\n' +
      '- constraints는 한 줄에 하나씩 "- "로 시작하는 2~5줄 목록으로 쓰세요. 강한 명령어(반드시, 절대, CRITICAL)와 심리적 압박 표현은 쓰지 마세요.\n' +
      '- examples는 있을 때만 다듬고, 없으면 지어내지 말고 빈 문자열로 두세요.\n' +
      '- 이미 충분히 좋은 항목은 바꾸지 말고 notes에 그렇게 적으세요. "다르지만 더 낫지 않은" 변경은 하지 마세요.\n' +
      '- 한국어로 작성하고 사용자의 의도와 말투 수준을 유지하세요.\n' +
      '- 응답은 JSON 객체 하나만 출력하세요. 설명 문장이나 코드 펜스를 붙이지 마세요.\n\n' +
      '현재 항목(JSON):\n' + JSON.stringify(subset, null, 2) + '\n\n' +
      (extra.length ? '참고:\n- ' + extra.join('\n- ') + '\n\n' : '') +
      '응답 형식(키는 그대로, 값은 문자열):\n' +
      '{"fields": {"task": "...", "success": "...", "role": "...", "context": "...", "audience": "...", "constraints": "...", "formatExtra": "...", "tone": "...", "examples": "..."}, "notes": ["적용한 기법과 고친 이유 한 줄", "..."], "assumptions": ["가정했거나 사용자 확인이 필요한 점 (없으면 빈 배열)"]}';
  }
  function parseLoose(text) {
    if (typeof text !== 'string') return text;
    var t = text.trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch (e) { /* 아래에서 재시도 */ }
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e2) { /* 실패 */ } }
    return null;
  }
  function normalize(result) {
    if (!result || typeof result !== 'object' || !result.fields || typeof result.fields !== 'object') return null;
    var fields = {};
    EDITABLE.forEach(function (k) { var v = result.fields[k]; if (typeof v === 'string') fields[k] = v.trim(); });
    var notes = Array.isArray(result.notes) ? result.notes.filter(function (n) { return typeof n === 'string' && n.trim(); }).slice(0, 8) : [];
    var assumptions = Array.isArray(result.assumptions) ? result.assumptions.filter(function (n) { return typeof n === 'string' && n.trim(); }).slice(0, 5) : [];
    return { fields: fields, notes: notes, assumptions: assumptions };
  }

  /* ---------- 실행 ---------- */
  function runSample(input, signal) {
    return provider.sample.json(input, { modelTier: 'default', signal: signal }).then(normalize);
  }
  function runDirect(input, signal) {
    var key = PW.store.get(KEY_STORE, '');
    var modelId = PW.store.get(MODEL_STORE, MODELS[0].id);
    var model = MODELS.filter(function (m) { return m.id === modelId; })[0] || MODELS[0];
    var Anthropic = null;
    return import(SDK_URL).then(function (mod) {
      Anthropic = mod.default;
      var client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, timeout: 180000, maxRetries: 1 });
      var params = { model: model.id, max_tokens: 16000, system: SYSTEM, messages: [{ role: 'user', content: input }] };
      if (model.effort) params.output_config = { effort: 'medium' };
      if (model.fallbacks) { params.betas = ['server-side-fallback-2026-07-01']; params.fallbacks = 'default'; }
      return client.beta.messages.create(params, { signal: signal });
    }).then(function (res) {
      if (res.stop_reason === 'refusal') throw { code: 'refused', message: 'refused' };
      var text = (res.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
      var parsed = normalize(parseLoose(text));
      if (!parsed) throw { code: 'invalid_json', message: 'no json', text: text };
      return parsed;
    }).catch(function (e) {
      if (e && e.code) throw e;
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.name)))) throw { code: 'cancelled', message: 'cancelled' };
      if (Anthropic) {
        if (e instanceof Anthropic.AuthenticationError) throw { code: 'auth', message: e.message };
        if (e instanceof Anthropic.RateLimitError) throw { code: 'rate_limited', message: e.message };
        if (e instanceof Anthropic.APIConnectionError) throw { code: 'network', message: e.message };
        if (e instanceof Anthropic.APIError) throw { code: 'api', message: (e.status ? e.status + ' ' : '') + e.message };
      }
      throw { code: 'sdk', message: e && e.message ? e.message : String(e) };
    });
  }
  function errorCopy(code) {
    return {
      cancelled: '',
      not_granted: '이 페이지의 AI 사용이 허용되지 않았어요. 아티팩트 권한에서 허용하면 다시 쓸 수 있어요.',
      sampling_disabled: '이 계정에서는 AI 호출을 사용할 수 없어요.',
      rate_limited: '요청이 너무 많거나 사용량 한도에 닿았어요. 잠시 후 다시 시도해주세요.',
      refused: 'AI가 이 요청에는 답하지 않았어요. 내용을 조금 바꿔서 다시 시도해주세요.',
      invalid_json: 'AI 응답을 해석하지 못했어요. 한 번 더 시도해주세요.',
      empty_completion: 'AI가 빈 응답을 보냈어요. 다시 시도해주세요.',
      prompt_too_large: '프롬프트가 너무 길어요. 입력 자료를 줄이고 다시 시도해주세요.',
      session_expired: '로그인이 만료됐어요. 다시 로그인한 뒤 시도해주세요.',
      auth: 'API 키가 올바르지 않아요. AI 설정에서 키를 다시 확인해주세요.',
      network: '네트워크 연결에 실패했어요. 인터넷 연결과 광고 차단 설정을 확인해주세요.',
      api: 'API 오류가 발생했어요.',
      sdk: 'AI 모듈을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해주세요.'
    }[code] || '알 수 없는 오류가 발생했어요. 잠시 후 다시 시도해주세요.';
  }

  /* ---------- UI ---------- */
  function showProgress() {
    var body = document.createElement('div');
    body.innerHTML = '<div class="ai-status"><span class="spinner" aria-hidden="true"></span><span>Claude가 프롬프트를 읽고 다듬는 중이에요. 보통 10~40초 걸려요.</span></div>';
    PW.openModal({ title: 'AI로 다듬기', body: body, actions: [{ label: '중지', onClick: function () { if (controller) controller.abort(); PW.closeModal(); } }] });
  }
  function showResult(result, st) {
    var body = document.createElement('div');
    var html = '';
    if (result.notes.length) html += '<div><strong>바뀐 점</strong><ul class="ai-notes">' + result.notes.map(function (n) { return '<li>' + PW.esc(n) + '</li>'; }).join('') + '</ul></div>';
    if (result.assumptions && result.assumptions.length) html += '<div><strong>가정 · 확인할 점</strong><ul class="ai-notes">' + result.assumptions.map(function (n) { return '<li>' + PW.esc(n) + '</li>'; }).join('') + '</ul></div>';
    var changed = EDITABLE.filter(function (k) { return result.fields[k] !== undefined && result.fields[k] !== (st.fields[k] || '').trim(); });
    if (!changed.length) html += '<p>바꿀 부분을 찾지 못했어요. 이미 충분히 구체적인 프롬프트예요.</p>';
    changed.forEach(function (k) {
      html += '<div class="ai-field"><span class="k">' + PW.esc(PW.labels[k] || k) + '</span><pre></pre></div>';
    });
    body.innerHTML = html;
    var pres = body.querySelectorAll('.ai-field pre');
    changed.forEach(function (k, i) { pres[i].textContent = result.fields[k] || '(비움)'; });
    var actions = [{ label: '닫기', onClick: PW.closeModal }];
    if (changed.length) actions.push({ label: '적용하기', primary: true, onClick: function () {
      var patch = {}; changed.forEach(function (k) { patch[k] = result.fields[k]; });
      PW.applyFields(patch);
      PW.closeModal();
      PW.toast('AI 제안을 적용했어요.', { label: '되돌리기', onClick: PW.restore });
    } });
    PW.openModal({ title: 'AI 제안 (' + changed.length + '개 항목)', body: body, actions: actions });
  }
  function refine() {
    var st = PW.getState();
    if (!(st.fields.task || '').trim()) { PW.toast('먼저 작업 항목을 적어주세요. 그래야 다듬을 내용이 있어요.'); return; }
    if (provider.kind === 'direct' && !PW.store.get(KEY_STORE, '')) { openSettings(true); return; }
    controller = new AbortController();
    showProgress();
    var input = buildInput(st);
    var run = provider.kind === 'sample' ? runSample(input, controller.signal) : runDirect(input, controller.signal);
    run.then(function (result) {
      if (!result) throw { code: 'invalid_json', message: 'empty' };
      showResult(result, st);
    }).catch(function (e) {
      var code = e && e.code ? e.code : 'unknown';
      if (code === 'cancelled') { PW.closeModal(); return; }
      PW.closeModal();
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') {
        PW.setAi({ available: false });
      }
      var msg = errorCopy(code);
      if (code === 'api' && e.message) msg += ' (' + String(e.message).slice(0, 120) + ')';
      PW.toast(msg, null, 6000);
    }).then(function () { controller = null; });
  }
  function openSettings(becauseMissing) {
    var body = document.createElement('div');
    var curModel = PW.store.get(MODEL_STORE, MODELS[0].id);
    body.innerHTML =
      (becauseMissing ? '<p>AI로 다듬기를 쓰려면 Anthropic API 키가 필요해요.</p>' : '') +
      '<div><label for="aiKey">Anthropic API 키</label><input type="password" id="aiKey" autocomplete="off" placeholder="sk-ant-..."><p class="field-note">키는 이 브라우저에만 저장되고, Anthropic API 호출에만 사용돼요. 공용 PC에서는 사용 후 삭제하세요. 키는 <a href="https://platform.claude.com/" target="_blank" rel="noopener">platform.claude.com</a>에서 발급받을 수 있어요.</p></div>' +
      '<div><label for="aiModel">모델</label><select id="aiModel">' + MODELS.map(function (m) { return '<option value="' + m.id + '"' + (m.id === curModel ? ' selected' : '') + '>' + PW.esc(m.label) + '</option>'; }).join('') + '</select></div>';
    var existing = PW.store.get(KEY_STORE, '');
    var actions = [];
    if (existing) actions.push({ label: '키 삭제', danger: true, left: true, onClick: function () { PW.store.del(KEY_STORE); PW.closeModal(); updatePill(); PW.toast('API 키를 삭제했어요.'); } });
    actions.push({ label: '취소', onClick: PW.closeModal });
    actions.push({ label: '저장', primary: true, onClick: function () {
      var k = (document.getElementById('aiKey').value || '').trim();
      var m = document.getElementById('aiModel').value;
      if (k) PW.store.set(KEY_STORE, k);
      else if (!existing) { PW.toast('API 키를 입력해주세요.'); return; }
      PW.store.set(MODEL_STORE, m);
      PW.closeModal(); updatePill();
      PW.toast('AI 설정을 저장했어요.' + (becauseMissing ? ' 이제 "AI로 다듬기"를 눌러보세요.' : ''));
    } });
    PW.openModal({ title: 'AI 설정', body: body, actions: actions });
    if (existing) { var inp = body.querySelector('#aiKey'); inp.placeholder = '저장된 키 유지 (바꾸려면 새 키 입력)'; }
  }
  function updatePill() {
    var has = !!PW.store.get(KEY_STORE, '');
    PW.setAi({ available: true, kind: 'direct', onClick: refine, settings: openSettings, label: has ? 'AI: API 키 설정됨' : '' });
  }

  /* ---------- 연결 방식 감지 ---------- */
  function init() {
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('sample').then(function (s) {
        if (!s) return;
        provider = { kind: 'sample', sample: s };
        PW.setAi({ available: true, kind: 'sample', onClick: refine, label: 'AI 다듬기 사용 가능' });
      }).catch(function () { /* 사용 불가: 버튼 숨김 유지 */ });
    } else {
      provider = { kind: 'direct' };
      updatePill();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
