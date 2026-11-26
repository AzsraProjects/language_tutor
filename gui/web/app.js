/* Language Tutor — GUI frontend (design B « Défis »).
 * Vanilla JS, no build step. Talks to the Python backend through
 * window.pywebview.api.* and receives pushed events on window.LT.onEvent().
 * When no backend shows up (plain browser), a built-in demo API takes over
 * (isolated at the end of this file).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  var API = null; // backend (real or demo)
  var S = null; // last full state received from the backend
  var UI = {
    view: 'boot',
    rec: 'ready', // ready | starting | rec | transcribing | thinking
    recStart: 0,
    recTimer: null,
    typing: false,
    followup: true,
    feedback: null, // last "feedback" event of the running session
    feedbackLoading: false,
    fbReplies: 0,
    setupBusy: {}, // step -> {pct, label}
    updateBusy: null, // {pct, label}
    modal: null, // {kind, ...}
    draft: null, // settings draft
    lastFocus: null,
    demo: false,
    meet: null, // first-use flow: {step, questions, idx, answers, heard, showTr, result}
    lesson: null, // running lesson: {data, pos, results, x}
    lessonLoading: null, // {kind}
    lessonEnd: null // result of finish_lesson
  };

  var XP_PER_CHALLENGE = 50;
  var CHEST_BONUS = 100;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function pct(part, whole) { return whole > 0 ? clamp(Math.round((part / whole) * 100), 0, 100) : 0; }
  // 148540 -> "148 540" (non-breaking spaces between thousands).
  function fmt(n) { return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function langName(code) {
    var list = (S && S.languages) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].code === code) { return list[i].name; } }
    return code || '';
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ------------------------------------------------------------------
  // Icons (inline SVG, decorative unless stated)
  // ------------------------------------------------------------------

  function svg(w, h, vb, body, extra) {
    return '<svg aria-hidden="true" width="' + w + '" height="' + h + '" viewBox="' + vb + '" fill="none"' + (extra || '') + '>' + body + '</svg>';
  }

  var ICON = {
    logo: function (s) {
      return svg(s, s, '0 0 36 36', '<rect x="1" y="1" width="34" height="34" rx="11" fill="#2EA8FF" stroke="#1B7FCC" stroke-width="2"/><path d="M10 25V13l8 6 8-6v12" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>');
    },
    flame: function (s) { return svg(s, s, '0 0 24 24', '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .5 1.5 1 2 2 2 0-3-1-5 1-8z" fill="#FF7A45"/>'); },
    bolt: function (s, color) { return svg(s, s, '0 0 24 24', '<path d="M13 2L5 13h5l-1 9 8-12h-5z" fill="' + (color || '#2EA8FF') + '"/>'); },
    chest: function (s, white) {
      return svg(s, s, '0 0 28 28', '<rect x="4" y="11" width="20" height="13" rx="2.5" fill="' + (white ? '#fff' : '#FF5C8A') + '" stroke="#40081C" stroke-width="2.2"/><path d="M4 16h20M14 11v13" stroke="#40081C" stroke-width="2.2"/><path d="M14 11c-5-1-7-7-2.5-7 2 0 2.5 4 2.5 7zm0 0c5-1 7-7 2.5-7-2 0-2.5 4-2.5 7z" stroke="#40081C" stroke-width="2.2" stroke-linejoin="round"/>');
    },
    gear: function () { return svg(20, 20, '0 0 20 20', '<path d="M3 6h9M16 6h1M3 14h1M8 14h9" stroke="#46607A" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="6" r="2" stroke="#46607A" stroke-width="2"/><circle cx="6" cy="14" r="2" stroke="#46607A" stroke-width="2"/>'); },
    mic: function (s, color) {
      var c = color || '#062A45';
      return svg(s, s, '0 0 30 30', '<rect x="10.5" y="4" width="9" height="15" rx="4.5" fill="' + c + '"/><path d="M6.5 14.5a8.5 8.5 0 0017 0M15 23v3.5" stroke="' + c + '" stroke-width="2.6" stroke-linecap="round"/>');
    },
    stop: function (s) { return svg(s, s, '0 0 24 24', '<rect x="5" y="5" width="14" height="14" rx="4" fill="#40081C"/>'); },
    check: function (s, color, w) { return svg(s, s, '0 0 30 30', '<path d="M8 15.5l5 5 9-11" stroke="' + (color || '#23330A') + '" stroke-width="' + (w || 3.4) + '" stroke-linecap="round" stroke-linejoin="round"/>'); },
    close: function () { return svg(18, 18, '0 0 18 18', '<path d="M4 4l10 10M14 4L4 14" stroke="#46607A" stroke-width="2.4" stroke-linecap="round"/>'); },
    warn: function () { return svg(22, 22, '0 0 24 24', '<path d="M12 3.5l9.5 16.5h-19z" fill="#FFC93C" stroke="#4D3A00" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5" stroke="#4D3A00" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.3" fill="#4D3A00"/>'); },
    refresh: function () { return svg(18, 18, '0 0 20 20', '<path d="M3.5 10a6.5 6.5 0 1011.6-4M15.5 2.5V6H12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'); },
    folder: function () { return svg(18, 18, '0 0 20 20', '<path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h3.5l2 2H16a1.5 1.5 0 011.5 1.5v7A1.5 1.5 0 0116 16H4a1.5 1.5 0 01-1.5-1.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'); },
    star: function (s, on) {
      return svg(s, s, '0 0 24 24', '<path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.5l-5.9 3.1 1.2-6.5L2.5 9.5l6.6-.9z" fill="' + (on ? '#FFC93C' : '#E2ECF3') + '" stroke="' + (on ? '#DB8A0B' : '#B4C6D6') + '" stroke-width="1.8" stroke-linejoin="round"/>');
    },
    lock: function (s) { return svg(s, s, '0 0 14 14', '<rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="#46607A"/><path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" stroke="#46607A" stroke-width="1.6"/>'); },
    speaker: function (s, color) {
      var c = color || 'currentColor';
      return svg(s, s, '0 0 24 24', '<path d="M4 9.5h3.500L12 5.500v13L7.500 14.500H4z" fill="' + c + '" stroke="' + c + '" stroke-width="1.6" stroke-linejoin="round"/><path d="M15.500 9a4.200 4.200 0 010 6M18 6.500a7.800 7.800 0 010 11" stroke="' + c + '" stroke-width="2.200" stroke-linecap="round"/>');
    },
    cards: function (s) { return svg(s, s, '0 0 28 28', '<rect x="8" y="4" width="15" height="18" rx="3.500" fill="#BFE0FA" stroke="#062A45" stroke-width="2.200"/><rect x="4.500" y="7" width="15" height="18" rx="3.500" fill="#fff" stroke="#062A45" stroke-width="2.200"/><path d="M8.500 13h7M8.500 17.500h4.500" stroke="#062A45" stroke-width="2.200" stroke-linecap="round"/>'); },
    puzzle: function (s) { return svg(s, s, '0 0 28 28', '<path d="M5 9.500h5.200a2.800 2.800 0 115.600 0H21a2 2 0 012 2v3.700a2.800 2.800 0 100 5.600V22a2 2 0 01-2 2H5a2 2 0 01-2-2v-4.200a2.800 2.800 0 100-5.600V11.500a2 2 0 012-2z" fill="#fff" stroke="#062A45" stroke-width="2.200" stroke-linejoin="round"/>'); },
    wave: function (s) { return svg(s, s, '0 0 28 28', '<path d="M5 12v4M9.500 8.500v11M14 5v18M18.500 9.500v9M23 12.500v3" stroke="#062A45" stroke-width="2.600" stroke-linecap="round"/>'); },
    loop: function (s) { return svg(s, s, '0 0 28 28', '<path d="M5.500 14a8.500 8.500 0 0114.800-5.700M22.500 14a8.500 8.500 0 01-14.800 5.700" stroke="#23330A" stroke-width="2.600" stroke-linecap="round"/><path d="M21 3.500V9h-5.500M7 24.500V19h5.500" stroke="#23330A" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>'); },
    back: function () { return svg(16, 16, '0 0 14 14', '<path d="M8.5 3L4.5 7l4 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'); },
    avatar: function (s) {
      return svg(s, s, '0 0 48 48', '<circle cx="24" cy="24" r="22" fill="#2EA8FF" stroke="#1B7FCC" stroke-width="3"/><ellipse cx="17.5" cy="21" rx="4" ry="5" fill="#fff"/><ellipse cx="30.5" cy="21" rx="4" ry="5" fill="#fff"/><circle cx="18.5" cy="22" r="2.2" fill="#14263A"/><circle cx="31.5" cy="22" r="2.2" fill="#14263A"/><path d="M18 31c3 3.5 9 3.5 12 0" stroke="#062A45" stroke-width="3" stroke-linecap="round"/>', ' class="avatar"');
    }
  };

  // Level badge: gets richer at tiers 1, 5, 10, 25 and 50.
  function levelBadge(level, size) {
    level = Math.max(1, level | 0);
    var fs = level > 99 ? 22 : (level > 9 ? 28 : 34);
    var num = function (fill, y) {
      return '<text x="50" y="' + (y || 62) + '" text-anchor="middle" font-family="Rubik, sans-serif" font-weight="800" font-size="' + fs + '" fill="' + fill + '">' + level + '</text>';
    };
    var shield = 'M50 10l32 12v25c0 21-14 35-32 44-18-9-32-23-32-44V22z';
    var wings = '<path d="M20 56C6 54-4 45-8 31c7 5 14 7 20 7-5-5-8-11-8-18 6 8 14 13 23 15z" fill="#FFC93C" stroke="#DB8A0B" stroke-width="2.5" stroke-linejoin="round"/><path d="M80 56c14-2 24-11 28-25-7 5-14 7-20 7 5-5 8-11 8-18-6 8-14 13-23 15z" fill="#FFC93C" stroke="#DB8A0B" stroke-width="2.5" stroke-linejoin="round"/>';
    var body;
    if (level < 5) {
      body = '<circle cx="50" cy="50" r="38" fill="#E2ECF3" stroke="#B4C6D6" stroke-width="5"/>' + num('#24405A');
    } else if (level < 10) {
      body = '<circle cx="50" cy="54" r="40" fill="#1B7FCC"/><circle cx="50" cy="49" r="40" fill="#2EA8FF"/><circle cx="50" cy="49" r="31" stroke="#fff" stroke-width="3" stroke-dasharray="1.5 7" stroke-linecap="round"/>' + num('#062A45', 61);
    } else if (level < 25) {
      body = '<path d="' + shield + '" fill="#D63A69" transform="translate(0 5)"/><path d="' + shield + '" fill="#FF5C8A"/><path d="M50 18l3 6.5 7 .9-5 4.8 1.2 7-6.2-3.4-6.200 3.400 1.200-7-5-4.800 7-.900z" fill="#fff"/>' + num('#40081C', 70);
    } else if (level < 50) {
      body = wings + '<path d="' + shield + '" fill="#DB8A0B" transform="translate(0 5)"/><path d="' + shield + '" fill="#FFC93C"/><path d="M50 19l25 9.5v19c0 16-11 27-25 34-14-7-25-18-25-34v-19z" fill="#FFE08A" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>' + num('#3A2A00', 66);
    } else {
      var rays = '';
      for (var a = 0; a < 180; a += 30) { rays += '<rect x="46.500" y="-12" width="7" height="124" rx="3.500" transform="rotate(' + a + ' 50 50)"/>'; }
      body = '<g class="lvl-rays" fill="#FFC93C">' + rays + '</g>' + wings +
        '<path d="' + shield + '" fill="#DB8A0B" transform="translate(0 5)"/><path d="' + shield + '" fill="#FFC93C"/>' +
        '<path d="M50 19l25 9.5v19c0 16-11 27-25 34-14-7-25-18-25-34v-19z" fill="#6C3BD1" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>' +
        '<path d="M33 8l6.500 8.500L50 3l10.500 13.500L67 8l2 15H31z" fill="#FFC93C" stroke="#DB8A0B" stroke-width="2.5" stroke-linejoin="round"/>' +
        num('#fff', 66) +
        '<path class="lvl-spark" d="M-6 6l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FFC93C"/><path class="lvl-spark s2" d="M106 74l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FF5C8A"/><path class="lvl-spark s3" d="M102 0l1.500 4 4 1.500-4 1.500-1.500 4-1.500-4-4-1.500 4-1.500z" fill="#6C3BD1"/>';
    }
    return '<span class="lvl" role="img" aria-label="Niveau ' + level + '"><svg width="' + size + '" height="' + size + '" viewBox="-10 -6 120 112" fill="none">' + body + '</svg></span>';
  }

  // ------------------------------------------------------------------
  // Backend calls
  // ------------------------------------------------------------------

  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    var p;
    try {
      if (!API || typeof API[name] !== 'function') { throw new Error('Fonction indisponible : ' + name); }
      p = API[name].apply(API, args);
    } catch (err) {
      p = Promise.resolve({ ok: false, error: String((err && err.message) || err) });
    }
    return Promise.resolve(p).then(function (res) {
      if (!res || res.ok === false) {
        toast((res && res.error) || 'Une erreur est survenue.', 'error');
        return res || { ok: false };
      }
      return res;
    }, function (err) {
      toast(String((err && err.message) || err), 'error');
      return { ok: false, error: String(err) };
    });
  }

  function applyState(res) {
    if (res && res.ok !== false && res.setup && res.progress) { S = res; return true; }
    return false;
  }

  // ------------------------------------------------------------------
  // Toasts + effects
  // ------------------------------------------------------------------

  function toast(message, kind, ms) {
    var box = $('#toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' is-' + kind : '');
    el.textContent = message;
    box.appendChild(el);
    while (box.children.length > 3) { box.removeChild(box.firstChild); }
    setTimeout(function () {
      el.className += ' out';
      setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 300);
    }, ms || (kind === 'error' ? 6000 : 3200));
  }

  function flyXp(amount, anchorSel) {
    if (!amount || reducedMotion()) { return; }
    var anchor = $(anchorSel || '#chip-xp');
    if (!anchor) { return; }
    var r = anchor.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'xp-fly';
    el.textContent = '+' + amount + ' XP';
    el.style.left = Math.max(8, r.left + r.width / 2 - 36) + 'px';
    el.style.top = (r.bottom + 6) + 'px';
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) { el.parentNode.removeChild(el); } }, 1400);
    anchor.classList.remove('bump');
    void anchor.offsetWidth;
    anchor.classList.add('bump');
  }

  function confetti(count) {
    if (reducedMotion()) { return; }
    var fx = $('#fx');
    var colors = ['#2EA8FF', '#FF5C8A', '#B6E33C', '#FFC93C', '#1B7FCC'];
    for (var i = 0; i < count; i++) {
      var c = document.createElement('i');
      c.className = 'confetti';
      c.style.left = (Math.random() * 100) + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 0.5) + 's';
      c.style.setProperty('--dx', (Math.random() * 240 - 120) + 'px');
      c.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      if (i % 3 === 0) { c.style.borderRadius = '50%'; c.style.height = '12px'; }
      fx.appendChild(c);
    }
    setTimeout(function () { fx.innerHTML = ''; }, 3400);
  }

  // ------------------------------------------------------------------
  // Shared pieces
  // ------------------------------------------------------------------

  function streakText(n) { return n > 1 ? n + ' jours' : n + ' jour'; }

  function topbarRight(opts) {
    var p = S.progress;
    var html = '';
    html += '<span class="chip chip-streak" title="Jours d\'affilée avec une séance">' + ICON.flame(20) + '<span class="sr-only">Série : </span>' + streakText(p.streak) + '</span>';
    html += '<span class="chip chip-xp" id="chip-xp" title="Points d\'expérience">' + ICON.bolt(18) + fmt(p.xp) + ' XP</span>';
    html += '<span class="chip chip-level" title="Niveau ' + p.level + '">' + levelBadge(p.level, 34) + 'Niv. ' + p.level + '</span>';
    html += '<span class="chip chip-chest" title="Coffre : une récompense toutes les ' + p.chest_every + ' séances">' + ICON.chest(22) +
      '<span class="bar bar-pink" role="img" aria-label="Coffre : ' + p.chest_count + ' séances sur ' + p.chest_every + '"><span style="width:' + pct(p.chest_count, p.chest_every) + '%"></span></span>' +
      p.chest_count + ' / ' + p.chest_every + '</span>';
    if (opts && opts.lang) { html += '<span class="chip chip-lang">' + esc(langName(S.language)) + '</span>'; }
    html += '<button type="button" class="btn btn-icon" data-act="settings" aria-label="Réglages" title="Réglages">' + ICON.gear() + '</button>';
    return html;
  }

  function topbar(opts) {
    return '<header class="topbar"><div class="brand">' + ICON.logo(36) + '<span>Language Tutor</span></div>' +
      '<div class="topbar-right" id="topbar-right">' + topbarRight(opts) + '</div></header>';
  }

  function refreshTopbar() {
    var el = $('#topbar-right');
    if (el && S) { el.innerHTML = topbarRight({ lang: UI.view !== 'home' }); }
  }

  function questHtml(c, clickable) {
    var inner = '<span class="q-mark">' + ICON.check(16, '#23330A', 4) + '</span>' +
      '<span class="q-text">' + esc(c.text) + '</span>' +
      '<span class="q-xp">' + (c.done ? 'Réussi' : '+' + XP_PER_CHALLENGE + ' XP') + '</span>';
    if (clickable) {
      return '<button type="button" class="quest' + (c.done ? ' is-done' : '') + '" data-act="challenge" data-id="' + esc(c.id) + '" aria-pressed="' + (c.done ? 'true' : 'false') + '" title="' + esc(c.text) + ' — clique pour ' + (c.done ? 'annuler' : 'marquer comme réussi') + '">' + inner + '</button>';
    }
    return '<div class="quest' + (c.done ? ' is-done' : '') + '">' + inner + '</div>';
  }

  // ------------------------------------------------------------------
  // View: setup
  // ------------------------------------------------------------------

  function setupSteps() {
    var s = S.setup;
    var steps = [];
    if (s.needs_ollama === false) {
      steps.push({ id: 'ollama', title: 'Ollama (tuteur local)', ok: true, desc: 'Pas nécessaire : tu utilises un fournisseur externe.' });
    } else if (!s.ollama_installed) {
      steps.push({ id: 'ollama', title: 'Ollama (tuteur local)', ok: false, action: 'install_ollama', actionLabel: 'Installer Ollama',
        desc: 'Le moteur qui fait tourner ton tuteur sur ce PC, sans rien envoyer sur Internet.' });
    } else if (!s.ollama_running) {
      steps.push({ id: 'ollama', title: 'Ollama (tuteur local)', ok: false, action: 'start_ollama', actionLabel: 'Démarrer Ollama',
        desc: 'Ollama est installé mais ne tourne pas encore.' });
    } else {
      steps.push({ id: 'ollama', title: 'Ollama (tuteur local)', ok: true, desc: 'Installé et démarré.' });
    }
    var ollamaReady = s.needs_ollama === false || (s.ollama_installed && s.ollama_running);
    steps.push({ id: 'model', title: 'Modèle de langue', ok: !!s.model_ok, action: 'pull_model', actionLabel: 'Télécharger',
      blocked: !ollamaReady && s.needs_ollama !== false,
      desc: s.model_ok ? esc(S.settings.model) + ' est prêt.' : (s.needs_ollama === false ? 'Le modèle ' + esc(S.settings.model) + ' ne répond pas : vérifie tes réglages.' : 'Le cerveau du tuteur (' + esc(S.settings.model) + '). Quelques Go à télécharger, une seule fois.') });
    if (s.needs_ollama === false) { steps[steps.length - 1].action = null; }
    steps.push({ id: 'whisper_bin', title: 'Moteur de transcription', ok: !!s.whisper_bin_ok, action: 'download_whisper_bin', actionLabel: 'Installer',
      desc: s.whisper_bin_ok ? 'Whisper est prêt.' : 'Whisper transforme ta voix en texte, sur ce PC.' });
    steps.push({ id: 'whisper_model', title: 'Modèle de transcription', ok: !!s.whisper_model_ok, action: 'download_whisper_model', actionLabel: 'Télécharger',
      desc: s.whisper_model_ok ? 'Modèle « ' + esc(S.settings.whisper_model) + ' » prêt.' : 'Le modèle Whisper « ' + esc(S.settings.whisper_model) + ' », à télécharger une seule fois.' });
    steps.push({ id: 'mic', title: 'Micro', ok: !!s.mic_ok, action: null,
      desc: s.mic_ok ? 'Micro détecté.' : 'Aucun micro détecté. Branche-en un, puis clique sur « Revérifier ».' });
    return steps;
  }

  function stepBusyKey(step) { return step.action; }

  function setupStepsHtml() {
    var steps = setupSteps();
    var html = '';
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      var busy = st.action ? UI.setupBusy[stepBusyKey(st)] : null;
      var cls = 'step' + (st.ok ? ' is-ok' : '') + (busy ? ' is-busy' : '');
      var mark = st.ok ? ICON.check(22) : (busy ? '<span class="spinner"></span>' : String(i + 1));
      html += '<li class="' + cls + '"><span class="step-mark">' + mark + '</span>' +
        '<div class="step-body"><span class="step-title">' + st.title + '</span><span class="step-desc">' + st.desc + '</span></div>';
      if (!st.ok && st.action && !busy) {
        html += '<button type="button" class="btn btn-primary btn-sm" data-act="setup" data-step="' + st.action + '"' + (st.blocked ? ' disabled title="Installe d\'abord Ollama"' : '') + '>' + st.actionLabel + '</button>';
      }
      if (busy) {
        var known = typeof busy.pct === 'number';
        html += '<div class="step-progress" data-progress="' + st.action + '"><span class="bar' + (known ? '' : ' indet') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100"' + (known ? ' aria-valuenow="' + Math.round(busy.pct) + '"' : '') + '><span style="width:' + (known ? clamp(busy.pct, 0, 100) : 35) + '%"></span></span>' +
          '<small>' + busyLabel(busy) + '</small></div>';
      }
      html += '</li>';
    }
    return html;
  }

  function viewSetup() {
    return '<div class="view"><div class="scroll"><div class="setup"><div class="setup-card">' +
      '<div class="setup-head">' + ICON.avatar(64) + '<h1>Préparons ton tuteur</h1></div>' +
      '<p class="setup-sub">Encore quelques éléments à mettre en place. C\'est à faire une seule fois, ensuite tout fonctionne hors ligne.</p>' +
      '<ol class="steps" id="steps">' + setupStepsHtml() + '</ol>' +
      '<div class="setup-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="settings">' + ICON.gear() + 'Réglages</button>' +
      '<button type="button" class="btn btn-sm" data-act="recheck">' + ICON.refresh() + 'Revérifier</button></div>' +
      '</div></div></div></div>';
  }

  function busyLabel(busy) {
    return esc(busy.label || 'En cours…') + (typeof busy.pct === 'number' ? ' — ' + Math.round(busy.pct) + ' %' : '');
  }

  function refreshSetup() {
    var el = $('#steps');
    if (el) { el.innerHTML = setupStepsHtml(); }
  }

  // Progress ticks only touch the bar and its label, so the rest of the
  // list (and its animations) is left alone.
  function updateSetupProgress(step) {
    var box = $('[data-progress="' + step + '"]');
    var busy = UI.setupBusy[step];
    if (!box || !busy) { refreshSetup(); return; }
    var bar = $('.bar', box);
    var known = typeof busy.pct === 'number';
    if (known === bar.classList.contains('indet')) { refreshSetup(); return; }
    if (known) {
      bar.firstChild.style.width = clamp(busy.pct, 0, 100) + '%';
      bar.setAttribute('aria-valuenow', Math.round(busy.pct));
    }
    $('small', box).innerHTML = busyLabel(busy);
  }

  // ------------------------------------------------------------------
  // View: home
  // ------------------------------------------------------------------

  function updateBannerHtml() {
    if (!S.update) { return ''; }
    if (UI.updateBusy) {
      var known = typeof UI.updateBusy.pct === 'number';
      return '<span>' + esc(UI.updateBusy.label || 'Mise à jour en cours…') + '</span>' +
        '<span class="bar' + (known ? '' : ' indet') + '"><span style="width:' + (known ? clamp(UI.updateBusy.pct, 0, 100) : 35) + '%"></span></span>';
    }
    return '<span>Version ' + esc(S.update.version) + ' disponible</span>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="update" title="' + esc(S.update.notes || '') + '">Mettre à jour</button>';
  }

  function refreshUpdateBanner() {
    var el = $('#update-banner');
    if (!el) { return; }
    var html = updateBannerHtml();
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
  }

  function langsHtml() {
    var langs = '';
    for (var i = 0; i < S.languages.length; i++) {
      var l = S.languages[i];
      langs += '<button type="button" class="btn lang-btn" data-act="lang" data-code="' + esc(l.code) + '" aria-pressed="' + (l.code === S.language ? 'true' : 'false') + '">' + esc(l.name) + '</button>';
    }
    return langs;
  }

  function viewHome() {
    return S.path ? viewHub() : viewHomeLegacy();
  }

  // Home without a learning path (backend without lessons).
  function viewHomeLegacy() {
    var p = S.progress;
    var n = S.next_session_number;
    var pending = (S.challenges || []).filter(function (c) { return !c.done; });
    var first = n <= 1;
    var langs = langsHtml();
    var banner = updateBannerHtml();

    var html = '<div class="view">' + topbar({ lang: false }) +
      '<div class="update-banner" id="update-banner"' + (banner ? '' : ' style="display:none"') + '>' + banner + '</div>' +
      '<div class="scroll"><div class="home"><div class="wrap home-grid">';

    html += '<div class="home-main"><section class="hero">' +
      '<div class="hero-top">' + ICON.avatar(84) + '<div><span class="hero-kicker">' + (first ? 'Bienvenue' : 'Bon retour') + '</span>' +
      '<h1>' + (first ? 'Prêt pour ta première séance ?' : 'Prêt pour la séance ' + n + ' ?') + '</h1></div></div>' +
      '<p>Tu parles, ton tuteur te répond. À la fin, il te donne un bilan et des défis pour la prochaine fois.</p>' +
      '<div><span class="card-kicker" id="lang-label">Je veux parler</span><div class="langs" role="group" aria-labelledby="lang-label" style="margin-top:8px">' + langs + '</div></div>' +
      '<div class="start-row"><button type="button" class="btn btn-primary btn-lg" data-act="start" id="start-btn">' + ICON.mic(26) + 'Commencer la séance ' + n + '</button>';
    if (S.has_briefing) {
      html += '<label class="check"><input type="checkbox" id="followup"' + (UI.followup ? ' checked' : '') + '><span class="box">' + ICON.check(18, '#23330A', 4) + '</span>Reprendre à partir du dernier bilan</label>';
    }
    html += '</div></section>';

    html += '<section class="card"><span class="card-kicker">' + esc(langName(S.language)) + '</span><h2>Tes défis en attente</h2>';
    if (pending.length) {
      html += '<ul class="quests">';
      for (var j = 0; j < pending.length; j++) { html += '<li>' + questHtml(pending[j], false) + '</li>'; }
      html += '</ul>';
    } else {
      html += '<p class="empty-note">' + (S.has_briefing ? 'Tous tes défis sont réussis. Le prochain bilan t\'en donnera de nouveaux.' : 'Pas encore de défi : ils arrivent avec ton premier bilan, à la fin d\'une séance.') + '</p>';
    }
    html += '</section></div>';

    var into = Math.max(0, p.xp - p.level_floor_xp);
    var span = Math.max(1, p.level_next_xp - p.level_floor_xp);
    var chestLeft = Math.max(0, p.chest_every - p.chest_count);
    html += '<aside class="home-side"><div class="tiles">' +
      '<div class="tile tile-wide">' + levelBadge(p.level, 76) + '<div class="tile-col"><span class="tile-num">Niveau ' + p.level + '</span>' +
      '<span class="bar bar-lg" role="img" aria-label="' + into + ' XP sur ' + span + ' avant le niveau suivant"><span style="width:' + pct(into, span) + '%"></span></span>' +
      '<span class="tile-line"><span>' + fmt(p.xp) + ' XP</span><span>Niveau ' + (p.level + 1) + ' à ' + fmt(p.level_next_xp) + ' XP</span></span></div></div>' +
      '<div class="tile tile-streak"><span class="tile-top">' + ICON.flame(26) + '<span class="tile-num">' + streakText(p.streak) + '</span></span><span class="tile-label">' + (p.streak > 0 ? 'd\'affilée' : 'Lance ta série aujourd\'hui') + '</span></div>' +
      '<div class="tile"><span class="tile-top">' + ICON.check(26, '#8DB81F', 4) + '<span class="tile-num">' + p.sessions_done + '</span></span><span class="tile-label">' + (p.sessions_done > 1 ? 'séances terminées' : 'séance terminée') + '</span></div>' +
      '<div class="tile tile-chest tile-wide"><span class="chest-ico">' + ICON.chest(26, true) + '</span><div class="tile-col"><span class="tile-num" style="font-size:19px">' + (chestLeft <= 1 ? 'Plus qu\'une séance' : 'Encore ' + chestLeft + ' séances') + '</span>' +
      '<span class="bar bar-lg bar-pink" role="img" aria-label="Coffre : ' + p.chest_count + ' séances sur ' + p.chest_every + '"><span style="width:' + pct(p.chest_count, p.chest_every) + '%"></span></span>' +
      '<span class="tile-line"><span>avant d\'ouvrir le coffre</span><span>' + p.chest_count + ' / ' + p.chest_every + '</span></span></div></div>' +
      '</div></aside>';

    html += '</div></div></div></div>';
    return html;
  }

  // ------------------------------------------------------------------
  // View: conversation
  // ------------------------------------------------------------------

  function stripHtml() {
    var ses = S.session;
    // Once the bilan exists, S.challenges holds the NEXT session's challenges:
    // they are shown on the bilan, not as today's.
    var list = (ses.followup && S.challenges && !UI.feedback) ? S.challenges : [];
    var goal = Math.max(1, ses.goal || 5);
    var html = '<div class="strip-title"><h1>Séance ' + ses.number + '</h1><span>' +
      (list.length ? 'Tes défis du jour · ' + Math.min(ses.replies, goal) + ' / ' + goal + ' répliques' : 'Objectif de la séance') + '</span></div>';
    if (list.length) {
      for (var i = 0; i < Math.min(list.length, 3); i++) { html += questHtml(list[i], true); }
    } else {
      html += '<div class="strip-goal"><span class="tile-line"><span>' + (ses.replies >= goal ? 'Objectif atteint, bravo !' : 'Parle pour remplir la barre') + '</span><span>' + ses.replies + ' / ' + goal + ' répliques</span></span>' +
        '<span class="bar bar-lg' + (ses.replies >= goal ? ' bar-green' : '') + '" role="img" aria-label="' + ses.replies + ' répliques sur ' + goal + '"><span style="width:' + pct(ses.replies, goal) + '%"></span></span></div>';
    }
    return html;
  }

  function rowHtml(turn) {
    if (turn.role === 'user') {
      return '<div class="row row-user"><div class="bubble">' + esc(turn.text) + '</div></div>';
    }
    return '<div class="row row-tutor">' + ICON.avatar(52) + '<div class="bubble">' + esc(turn.text) + '</div></div>';
  }

  function typingHtml() {
    return '<div class="row row-tutor is-last" id="typing">' + ICON.avatar(52) + '<div class="bubble"><span class="typing" role="status" aria-label="Ton tuteur réfléchit"><i></i><i></i><i></i></span></div></div>';
  }

  function threadHtml() {
    var turns = S.session.turns || [];
    if (!turns.length && !UI.typing) {
      return '<div class="thread-empty">' + ICON.avatar(84) + '<strong>À toi de lancer la conversation</strong>' +
        '<span>Appuie sur « Parler », dis quelques phrases en ' + esc(langName(S.language)) + ', puis appuie à nouveau quand tu as fini.</span></div>';
    }
    var html = '';
    for (var i = 0; i < turns.length; i++) { html += rowHtml(turns[i]); }
    if (UI.typing) { html += typingHtml(); }
    return html;
  }

  function markLastTutor() {
    var rows = $all('#thread .row-tutor');
    for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('is-last'); }
    var all = $all('#thread .row');
    var last = all[all.length - 1];
    if (last && last.classList.contains('row-tutor')) { last.classList.add('is-last'); }
    else if (rows.length) { rows[rows.length - 1].classList.add('is-last'); }
  }

  function scrollThread(smooth) {
    var sc = $('#thread-scroll');
    if (!sc) { return; }
    if (smooth && sc.scrollTo && !reducedMotion()) { sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); }
    else { sc.scrollTop = sc.scrollHeight; }
  }

  function refreshThread() {
    var el = $('#thread');
    if (!el) { return; }
    el.innerHTML = threadHtml();
    markLastTutor();
    scrollThread(false);
  }

  function appendRow(html) {
    var el = $('#thread');
    if (!el) { return; }
    var empty = $('.thread-empty', el);
    if (empty) { el.innerHTML = ''; }
    var t = $('#typing');
    if (t) { t.parentNode.removeChild(t); }
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    el.appendChild(tmp.firstChild);
    markLastTutor();
    scrollThread(true);
  }

  function chrono() {
    var s = Math.max(0, Math.floor((Date.now() - UI.recStart) / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function dockHtml() {
    var ses = S.session;
    var busy = UI.rec !== 'ready';
    var left = '';
    if (UI.feedback) {
      if (ses.replies > UI.fbReplies) {
        left += '<button type="button" class="btn" data-act="finish"' + (busy ? ' disabled' : '') + '>Mettre à jour mon bilan</button>';
      } else {
        left += '<button type="button" class="btn" data-act="back-bilan"' + (busy ? ' disabled' : '') + '>' + ICON.back() + 'Retour au bilan</button>';
      }
    } else {
      left += '<button type="button" class="btn" data-act="finish"' + (busy ? ' disabled' : '') + '>Terminer et voir mon bilan</button>' +
        '<button type="button" class="btn btn-ghost" data-act="quit"' + (busy ? ' disabled' : '') + '>Quitter</button>';
    }
    var talk, hint;
    if (UI.rec === 'rec') {
      talk = '<button type="button" class="btn btn-lg btn-talk is-rec" id="talk" data-act="talk">' + ICON.stop(24) + 'J\'ai fini' +
        '<span class="meter" id="meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="chrono" id="chrono">' + chrono() + '</span></button>';
      hint = '<kbd>Échap</kbd> annuler';
    } else if (UI.rec === 'starting') {
      talk = '<button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" disabled><span class="spinner"></span>Micro…</button>';
      hint = '';
    } else if (UI.rec === 'transcribing') {
      talk = '<button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" disabled><span class="spinner"></span>Je transcris…</button>';
      hint = '';
    } else if (UI.rec === 'thinking') {
      talk = '<button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" disabled>Ton tuteur réfléchit…</button>';
      hint = '';
    } else {
      talk = '<button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" data-act="talk">' + ICON.mic(26) + 'Parler</button>';
      hint = '<kbd>Entrée</kbd>';
    }
    return '<div class="dock-left">' + left + '</div><div class="dock-right"><span class="dock-hint">' + hint + '</span>' + talk + '</div>';
  }

  function refreshDock() {
    var el = $('#dock');
    if (!el) { return; }
    var hadFocus = document.activeElement && document.activeElement.id === 'talk';
    el.innerHTML = dockHtml();
    var talk = $('#talk');
    if (talk && !talk.disabled && (hadFocus || UI.rec === 'rec') && !UI.modal) { talk.focus(); }
  }

  function refreshStrip() {
    var el = $('#strip-in');
    if (el) { el.innerHTML = stripHtml(); }
  }

  function viewConversation() {
    return '<div class="view">' + topbar({ lang: true }) +
      '<section class="strip"><div class="wrap wrap-narrow strip-in" id="strip-in">' + stripHtml() + '</div></section>' +
      '<div class="scroll" id="thread-scroll"><div class="thread-wrap"><div class="wrap wrap-narrow thread" id="thread" aria-live="polite">' + threadHtml() + '</div></div></div>' +
      '<footer class="dock" id="dock">' + dockHtml() + '</footer></div>';
  }

  function setRec(state) {
    UI.rec = state;
    if (UI.recTimer) { clearInterval(UI.recTimer); UI.recTimer = null; }
    if (state === 'rec') {
      UI.recStart = Date.now();
      UI.recTimer = setInterval(function () {
        var c = $('#chrono');
        if (c) { c.textContent = chrono(); }
      }, 500);
    }
    refreshDock();
    if (UI.view === 'lesson') { refreshLessonFoot(); }
    else if (UI.view === 'meet') { refreshMeetFoot(); }
  }

  function toggleTalk() {
    if (!S || !S.session || UI.view !== 'conversation') { return; }
    if (UI.rec === 'ready') {
      setRec('starting');
      call('start_recording').then(function (res) {
        if (UI.rec !== 'starting') { return; }
        setRec(res.ok === false ? 'ready' : 'rec');
      });
    } else if (UI.rec === 'rec') {
      setRec('transcribing');
      call('stop_recording').then(function (res) {
        if (res.ok === false && UI.rec === 'transcribing') { setRec('ready'); }
      });
    }
  }

  function cancelTalk() {
    if (UI.rec !== 'rec') { return; }
    setRec('ready');
    call('cancel_recording').then(function () { toast('Enregistrement annulé.', 'soft'); });
  }

  function setMeter(value) {
    var talk = $('#talk');
    if (!talk || UI.rec !== 'rec') { return; }
    var v = clamp(+value || 0, 0, 1);
    talk.style.setProperty('--lvl', v.toFixed(2));
    var bars = $all('#meter i');
    var shape = [0.45, 0.8, 1, 0.7, 0.4];
    for (var i = 0; i < bars.length; i++) { bars[i].style.height = Math.round(6 + v * 20 * shape[i]) + 'px'; }
  }

  // ------------------------------------------------------------------
  // Markdown (LLM output = untrusted: everything is escaped first)
  // ------------------------------------------------------------------

  function mdInline(text) {
    var s = esc(text);
    var codes = [];
    s = s.replace(/`([^`]+)`/g, function (m, c) { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    s = s.replace(/\*\*([^*\s](?:[^*]*?[^*\s])?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^\w])__([^_\s](?:[^_]*?[^_\s])?)__(?![\w])/g, '$1<strong>$2</strong>');
    s = s.replace(/~~([^~]+?)~~/g, '<del>$1</del>');
    s = s.replace(/(^|[\s(;>«“])\*([^*\s](?:[^*]*?[^*\s])?)\*(?=$|[\s).,;:!?&<»”])/g, '$1<em>$2</em>');
    s = s.replace(/(^|[\s(;>«“])_([^_\s](?:[^_]*?[^_\s])?)_(?=$|[\s).,;:!?&<»”])/g, '$1<em>$2</em>');
    s = s.replace(/\u0001(\d+)\u0001/g, function (m, i) { return '<code>' + codes[+i] + '</code>'; });
    return s;
  }

  function cleanHeading(text) {
    var t = String(text).trim();
    t = t.replace(/^\d+[.)]\s+/, '');
    t = t.replace(/^\*\*(.+?)\*\*$/, '$1').replace(/^__(.+?)__$/, '$1');
    t = t.replace(/\s*:\s*$/, '');
    t = t.replace(/^\*\*(.+?)\*\*$/, '$1');
    return t;
  }

  var RE_NUM = /^\s*(\d+)[.)]\s+(.*)$/;
  var RE_BULLET = /^(\s*)([-*+•])\s+(.*)$/;
  var RE_LIST = /^(\s*)(?:[-*+•]|(\d+)[.)])\s+(.*)$/;

  function renderMarkdown(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var sections = [];
    var cur = { title: null, html: [] };
    var olNext = -1; // next expected number of the ordered list just emitted

    function nextNonEmpty(k) {
      while (k < lines.length && !lines[k].trim()) { k++; }
      return k;
    }

    function hashHeading(t) {
      var m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(t);
      return m ? { level: m[1].length, text: m[2] } : null;
    }

    function boldHeading(t) {
      var m = /^(?:\*\*(.+?)\*\*|__(.+?)__)\s*:?$/.exec(t);
      if (!m) { return null; }
      var inner = m[1] || m[2];
      if (inner.indexOf('**') >= 0 || inner.length > 90) { return null; }
      return { level: 2, text: inner };
    }

    function headingAt(idx) {
      var t = lines[idx].trim();
      var h = hashHeading(t) || boldHeading(t);
      if (h) { return h; }
      var m = RE_NUM.exec(lines[idx]);
      if (!m || /^\s+/.test(lines[idx])) { return null; }
      var n = +m[1];
      var plain = m[2].replace(/\*\*/g, '').trim();
      if (n === olNext) { return null; }
      if (idx > 0 && RE_NUM.test(lines[idx - 1])) { return null; }
      if (idx + 1 < lines.length && RE_NUM.test(lines[idx + 1])) { return null; }
      var nn = nextNonEmpty(idx + 1);
      if (nn >= lines.length) { return null; }
      var nt = lines[nn].trim();
      if (RE_NUM.test(lines[nn]) && !/^\s+/.test(lines[nn])) {
        // "1. Title" directly followed by "2. Title": headings only when the
        // following one has a body, otherwise it is a loose list.
        return null;
      }
      if (hashHeading(nt) || boldHeading(nt)) { return null; }
      if (plain.length > 70 || /[.!?…]$/.test(plain)) { return null; }
      return { level: 2, text: m[2] };
    }

    function pushSection() {
      if (cur.title !== null || cur.html.length) { sections.push(cur); }
    }

    function indentOf(ws) { return ws.replace(/\t/g, '    ').length; }

    function buildList(items, start) {
      var base = items[start].indent;
      var ordered = items[start].ordered;
      var parts = [];
      var k = start;
      while (k < items.length && items[k].indent >= base) {
        if (items[k].indent > base && parts.length) {
          var sub = buildList(items, k);
          parts[parts.length - 1] += sub.html;
          k = sub.next;
          continue;
        }
        parts.push(mdInline(items[k].text));
        k++;
      }
      var open = ordered ? '<ol' + (items[start].num > 1 ? ' start="' + items[start].num + '"' : '') + '>' : '<ul>';
      return { html: open + '<li>' + parts.join('</li><li>') + '</li>' + (ordered ? '</ol>' : '</ul>'), next: k };
    }

    var i = 0;
    while (i < lines.length) {
      var raw = lines[i];
      var t = raw.trim();
      if (!t) { i++; continue; }

      var h = headingAt(i);
      if (h) {
        olNext = -1;
        if (h.level <= 3) {
          pushSection();
          cur = { title: cleanHeading(h.text), html: [] };
        } else {
          cur.html.push('<h4>' + mdInline(cleanHeading(h.text)) + '</h4>');
        }
        i++;
        continue;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { i++; continue; }

      if (/^>/.test(t)) {
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(mdInline(lines[i].replace(/^\s*>\s?/, '')));
          i++;
        }
        cur.html.push('<blockquote>' + quote.join('<br>') + '</blockquote>');
        olNext = -1;
        continue;
      }

      if (RE_LIST.test(raw)) {
        var items = [];
        while (i < lines.length) {
          var line = lines[i];
          if (!line.trim()) {
            var nn = nextNonEmpty(i);
            if (nn < lines.length && RE_LIST.test(lines[nn]) && !headingAt(nn)) { i = nn; continue; }
            break;
          }
          var m = RE_LIST.exec(line);
          if (m && !(items.length && headingAt(i) && !RE_BULLET.test(line))) {
            items.push({ indent: indentOf(m[1]), ordered: m[2] !== undefined, num: m[2] !== undefined ? +m[2] : 0, text: m[3] });
          } else if (m) {
            break;
          } else if (items.length && /^\s+\S/.test(line)) {
            items[items.length - 1].text += ' ' + line.trim();
          } else {
            break;
          }
          i++;
        }
        var k = 0;
        var lastTop = null;
        while (k < items.length) {
          var built = buildList(items, k);
          cur.html.push(built.html);
          k = built.next;
        }
        for (var q = items.length - 1; q >= 0; q--) {
          if (items[q].ordered && items[q].indent === items[0].indent) { lastTop = items[q]; break; }
        }
        olNext = lastTop ? lastTop.num + 1 : -1;
        continue;
      }

      var para = [];
      while (i < lines.length && lines[i].trim() && !RE_LIST.test(lines[i]) && !/^\s*>/.test(lines[i]) && !(para.length && headingAt(i))) {
        para.push(mdInline(lines[i].trim()));
        i++;
      }
      if (para.length) { cur.html.push('<p>' + para.join('<br>') + '</p>'); olNext = -1; }
      else { i++; }
    }
    pushSection();

    if (!sections.length) { return '<div class="md"><section class="md-sec"><p>Le bilan est vide.</p></section></div>'; }
    var out = '<div class="md">';
    for (var s = 0; s < sections.length; s++) {
      out += '<section class="md-sec">' + (sections[s].title !== null ? '<h3>' + mdInline(sections[s].title) + '</h3>' : '') + sections[s].html.join('') + '</section>';
    }
    return out + '</div>';
  }

  // ------------------------------------------------------------------
  // View: bilan
  // ------------------------------------------------------------------

  function viewBilanWaiting() {
    return '<div class="view">' + topbar({ lang: true }) + '<div class="waiting" role="status">' +
      '<span class="avatar-big">' + ICON.avatar(110) + '</span><h1>Ton tuteur relit la séance…</h1>' +
      '<p>Il prépare ton bilan et tes défis pour la prochaine fois. Ça peut prendre jusqu\'à une minute.</p>' +
      '<span class="bar bar-lg"><span></span></span></div></div>';
  }

  function viewBilan() {
    var fb = UI.feedback;
    var ses = S.session;
    var p = S.progress;
    var rw = fb.rewards || {};
    var number = ses ? ses.number : S.next_session_number - 1;
    var next = number + 1;
    var list = fb.challenges || [];

    var html = '<div class="view">' + topbar({ lang: true }) + '<div class="scroll">';

    html += '<section class="bilan-hero"><div class="wrap bilan-hero-in"><div class="bilan-title"><span class="done-mark">' + ICON.check(46) + '</span>' +
      '<div><span class="hero-kicker">' + esc(langName(S.language)) + '</span><h1>Séance ' + number + ' terminée !</h1></div></div><div class="rewards">' +
      '<div class="reward">' + ICON.bolt(26) + '<span><span class="reward-num">+' + fmt(rw.xp_gained || 0) + ' XP</span><span class="reward-label">gagnés pendant la séance</span></span></div>' +
      '<div class="reward">' + ICON.flame(28) + '<span><span class="reward-num">' + streakText(rw.streak != null ? rw.streak : p.streak) + '</span><span class="reward-label">d\'affilée</span></span></div>';
    if (rw.leveled_up) {
      html += '<div class="reward reward-level">' + levelBadge(rw.level || p.level, 46) + '<span><span class="reward-num">Niveau ' + (rw.level || p.level) + ' !</span><span class="reward-label">Tu montes de niveau</span></span></div>';
    }
    html += '</div></div></section>';

    html += '<div class="bilan-body"><div class="wrap bilan-grid"><article class="bilan-doc selectable">' + renderMarkdown(fb.markdown) + '</article><aside class="bilan-side">';

    if (fb.briefing_saved === false) {
      html += '<div class="warn"><div class="warn-row">' + ICON.warn() + '<span>Le résumé pour la prochaine séance n\'a pas pu être créé — tu peux redemander le bilan.</span></div>' +
        '<button type="button" class="btn btn-sm" data-act="regen">' + ICON.refresh() + 'Regénérer</button></div>';
    }

    html += '<section class="card-dark"><h2>Tes défis pour la séance ' + next + '</h2>';
    if (list.length) {
      html += '<ol>';
      for (var i = 0; i < list.length; i++) { html += '<li>' + esc(list[i].text) + '</li>'; }
      html += '</ol>';
    } else {
      html += '<p>Pas de défi cette fois. Continue sur ta lancée !</p>';
    }
    html += '<button type="button" class="btn btn-primary btn-block" data-act="next-session" style="min-height:60px;font-size:17px">Lancer la séance ' + next + '</button></section>';

    var every = p.chest_every;
    var count = rw.chest_count != null ? rw.chest_count : p.chest_count;
    var left = Math.max(0, every - count);
    if (rw.chest_opened) {
      html += '<section class="chest-card is-open"><div class="chest-row"><span class="chest-ico">' + ICON.chest(26, true) + '</span><div><h2>Coffre ouvert !</h2><span class="sub">' + every + ' séances terminées, bien joué.</span></div></div>' +
        '<span class="chest-bonus">+' + CHEST_BONUS + ' XP bonus</span>' +
        '<span class="bar bar-lg bar-pink" role="img" aria-label="Coffre ouvert"><span style="width:100%"></span></span></section>';
    } else {
      html += '<section class="chest-card"><div class="chest-row"><span class="chest-ico">' + ICON.chest(26, true) + '</span><div><h2>' + (left <= 1 ? 'Plus qu\'une séance' : 'Encore ' + left + ' séances') + '</h2><span class="sub">avant d\'ouvrir le coffre</span></div></div>' +
        '<span class="bar bar-lg bar-pink" role="img" aria-label="' + count + ' séances sur ' + every + '"><span id="chest-fill" style="width:' + pct(Math.max(0, count - 1), every) + '%" data-to="' + pct(count, every) + '"></span></span></section>';
    }

    html += '<div class="side-actions">' +
      '<button type="button" class="btn btn-sm btn-block" data-act="review">Revoir la conversation</button>' +
      '<button type="button" class="btn btn-sm btn-block" data-act="open-feedback">' + ICON.folder() + 'Ouvrir le fichier du bilan</button>' +
      '<button type="button" class="btn btn-ghost btn-sm btn-block" data-act="home">Retour à l\'accueil</button></div>';

    html += '</aside></div></div></div></div>';
    return html;
  }

  function afterBilanShown(celebrate) {
    var fill = $('#chest-fill');
    if (fill) { setTimeout(function () { fill.style.width = fill.getAttribute('data-to') + '%'; }, 350); }
    if (celebrate) {
      var rw = (UI.feedback && UI.feedback.rewards) || {};
      confetti(rw.leveled_up || rw.chest_opened ? 70 : 36);
    }
  }

  // ------------------------------------------------------------------
  // View: home hub (learning path)
  // ------------------------------------------------------------------

  var KIND_LABEL = { vocab: 'Vocabulaire', grammar: 'Grammaire', pron: 'Prononciation', review: 'Révision', conversation: 'Conversation' };

  function kindIcon(kind, size) {
    if (kind === 'vocab') { return ICON.cards(size); }
    if (kind === 'grammar') { return ICON.puzzle(size); }
    if (kind === 'pron') { return ICON.wave(size); }
    if (kind === 'review') { return ICON.loop(size); }
    return ICON.mic(size);
  }

  function kindPitch(kind) {
    if (kind === 'vocab') { return 'De nouveaux mots à découvrir, puis des exercices pour les retenir.'; }
    if (kind === 'grammar') { return 'Une règle expliquée simplement, puis de la pratique.'; }
    if (kind === 'pron') {
      return S.voice ? 'Un son à travailler : tu écoutes, tu répètes, et ton tuteur te dit ce qu\'il a compris.'
        : 'Un son à travailler : tu lis à voix haute, et ton tuteur te dit ce qu\'il a compris.';
    }
    if (kind === 'review') { return 'Tes points à consolider, pour qu\'ils restent pour de bon.'; }
    return 'Tu parles, ton tuteur te répond, et tu repars avec un bilan et des défis.';
  }

  function starsHtml(n, size) {
    n = clamp(n | 0, 0, 3);
    var h = '<span class="stars" role="img" aria-label="' + n + (n > 1 ? ' étoiles' : ' étoile') + ' sur 3">';
    for (var i = 1; i <= 3; i++) { h += ICON.star(size || 18, i <= n); }
    return h + '</span>';
  }

  function actTile(kind, unit, isNext) {
    var stars = unit.lessons[kind] | 0;
    return '<button type="button" class="act-tile' + (stars ? ' is-done' : '') + (isNext ? ' is-next' : '') + '" data-act="lesson" data-kind="' + kind + '" data-unit="' + esc(unit.id) + '">' +
      '<span class="act-ico">' + kindIcon(kind, 28) + '</span><span class="act-name">' + KIND_LABEL[kind] + '</span>' + starsHtml(stars, 18) +
      '<span class="act-state">' + (stars ? 'Rejouer' : (isNext ? 'À faire maintenant' : 'À faire')) + '</span></button>';
  }

  function viewHub() {
    var p = S.progress;
    var path = S.path;
    var n = S.next_session_number;
    var rec = path.recommended || { kind: 'conversation', unit_id: null, label: 'Conversation libre' };
    var pending = (S.challenges || []).filter(function (c) { return !c.done; });
    var cur = null;
    var i;
    for (i = 0; i < path.units.length; i++) { if (path.units[i].current) { cur = path.units[i]; } }
    var banner = updateBannerHtml();

    var html = '<div class="view">' + topbar({ lang: false }) +
      '<div class="update-banner" id="update-banner"' + (banner ? '' : ' style="display:none"') + '>' + banner + '</div>' +
      '<div class="scroll"><div class="home"><div class="wrap home-grid"><div class="home-main">';

    // What to do next.
    html += '<section class="hero hub-next"><div class="hero-top">' + ICON.avatar(84) + '<div class="hub-next-head">' +
      '<span class="hero-kicker">Parcours : ' + esc(path.level_name) + ' · ' + esc(langName(S.language)) + '</span>' +
      '<h1>' + esc(rec.label) + '</h1></div></div>' +
      '<p>' + kindPitch(rec.kind) + '</p>' +
      '<div class="start-row"><button type="button" class="btn btn-primary btn-lg" data-act="continue" id="start-btn">' + kindIcon(rec.kind, 26) + 'Continuer</button>' +
      '<span class="dock-hint"><kbd>Entrée</kbd></span></div></section>';

    html += '<div id="voice-card">' + voiceCardHtml() + '</div>';

    if (path.level_complete) {
      html += '<section class="card level-done"><div class="level-done-row"><span class="done-mark done-mark-sm">' + ICON.check(30) + '</span><div><h2>Parcours ' + esc(path.level_name) + ' terminé !</h2>' +
        '<p>' + (path.next_level ? 'Tu as fini toutes les unités. Prêt pour la suite ?' : 'Tu as fini toutes les unités : continue à pratiquer en conversation.') + '</p></div></div>';
      if (path.next_level) {
        html += '<button type="button" class="btn btn-green" data-act="pick-level" data-code="' + esc(path.next_level) + '">Passer au parcours ' + esc(levelName(path.next_level)) + '</button>';
      }
      html += '</section>';
    }

    // Unit in progress: its three lessons + the conversation.
    if (cur) {
      var nextKind = rec.unit_id === cur.id ? rec.kind : null;
      html += '<section class="card unit-card"><span class="card-kicker">Unité ' + cur.number + ' · en cours</span><h2>' + esc(cur.title) + '</h2><div class="acts">' +
        actTile('vocab', cur, nextKind === 'vocab') + actTile('grammar', cur, nextKind === 'grammar') + actTile('pron', cur, nextKind === 'pron') +
        '<button type="button" class="act-tile act-talk" data-act="start"><span class="act-ico">' + ICON.mic(28) + '</span><span class="act-name">Conversation</span>' +
        '<span class="act-sub">Séance ' + n + '</span><span class="act-state">Parler librement</span></button></div>';
      if (S.has_briefing) {
        html += '<label class="check"><input type="checkbox" id="followup"' + (UI.followup ? ' checked' : '') + '><span class="box">' + ICON.check(18, '#23330A', 4) + '</span>Conversation : reprendre à partir du dernier bilan</label>';
      }
      html += '</section>';
    } else {
      html += '<section class="card unit-card"><span class="card-kicker">Conversation</span><h2>Parler librement</h2><div class="start-row" style="margin-top:12px">' +
        '<button type="button" class="btn" data-act="start">' + ICON.mic(22) + 'Commencer la séance ' + n + '</button>';
      if (S.has_briefing) {
        html += '<label class="check"><input type="checkbox" id="followup"' + (UI.followup ? ' checked' : '') + '><span class="box">' + ICON.check(18, '#23330A', 4) + '</span>Reprendre à partir du dernier bilan</label>';
      }
      html += '</div></section>';
    }

    if (path.review_due > 0) {
      html += '<section class="card review-card"><span class="review-ico">' + ICON.loop(28) + '</span><div class="review-body"><h2>' + path.review_due + (path.review_due > 1 ? ' points à revoir' : ' point à revoir') + '</h2>' +
        '<p>Les exercices qui t\'ont résisté reviennent ici, jusqu\'à ce qu\'ils soient acquis.</p></div>' +
        '<button type="button" class="btn btn-green btn-sm" data-act="lesson" data-kind="review">Réviser</button></section>';
    }

    // The whole level, as plain cards.
    html += '<section class="card"><span class="card-kicker">Parcours : ' + esc(path.level_name) + '</span><h2>Toutes les unités</h2><ul class="units">';
    for (i = 0; i < path.units.length; i++) {
      var u = path.units[i];
      var open = u.done || u.current || !u.locked;
      var cls = 'unit-row' + (u.done ? ' is-done' : (u.current ? ' is-current' : (open ? '' : ' is-locked')));
      var mark = u.done ? ICON.check(20, '#23330A', 4) : (open ? String(u.number) : ICON.lock(18));
      var sub = u.done ? 'Terminée' : (u.current ? 'En cours' : (open ? 'Disponible' : 'Se débloque après l\'unité ' + (u.number - 1)));
      html += '<li class="' + cls + '"><span class="unit-num">' + mark + '</span><div class="unit-body"><span class="unit-title">' + esc(u.title) + '</span><span class="unit-sub">' + sub + '</span></div>';
      if (open) {
        html += '<div class="unit-acts">';
        var kinds = ['vocab', 'grammar', 'pron'];
        for (var k = 0; k < kinds.length; k++) {
          var st = u.lessons[kinds[k]] | 0;
          html += '<button type="button" class="mini" data-act="lesson" data-kind="' + kinds[k] + '" data-unit="' + esc(u.id) + '" title="' + KIND_LABEL[kinds[k]] + ' — ' + (st ? 'rejouer' : 'commencer') + '">' +
            '<span>' + KIND_LABEL[kinds[k]] + '</span>' + starsHtml(st, 14) + '</button>';
        }
        html += '</div>';
      }
      html += '</li>';
    }
    html += '</ul></section></div>';

    // Side column: game progress, language, pending challenges.
    var into = Math.max(0, p.xp - p.level_floor_xp);
    var span = Math.max(1, p.level_next_xp - p.level_floor_xp);
    var chestLeft = Math.max(0, p.chest_every - p.chest_count);
    html += '<aside class="home-side"><div class="tiles">' +
      '<div class="tile tile-wide">' + levelBadge(p.level, 76) + '<div class="tile-col"><span class="tile-num">Niveau ' + p.level + '</span>' +
      '<span class="bar bar-lg" role="img" aria-label="' + into + ' XP sur ' + span + ' avant le niveau suivant"><span style="width:' + pct(into, span) + '%"></span></span>' +
      '<span class="tile-line"><span>' + fmt(p.xp) + ' XP</span><span>Niveau ' + (p.level + 1) + ' à ' + fmt(p.level_next_xp) + ' XP</span></span></div></div>' +
      '<div class="tile tile-streak"><span class="tile-top">' + ICON.flame(26) + '<span class="tile-num">' + streakText(p.streak) + '</span></span><span class="tile-label">' + (p.streak > 0 ? 'd\'affilée' : 'Lance ta série aujourd\'hui') + '</span></div>' +
      '<div class="tile"><span class="tile-top">' + ICON.check(26, '#8DB81F', 4) + '<span class="tile-num">' + p.sessions_done + '</span></span><span class="tile-label">' + (p.sessions_done > 1 ? 'conversations terminées' : 'conversation terminée') + '</span></div>' +
      '<div class="tile tile-chest tile-wide"><span class="chest-ico">' + ICON.chest(26, true) + '</span><div class="tile-col"><span class="tile-num" style="font-size:18px;white-space:normal">' + (chestLeft <= 1 ? 'Plus qu\'une conversation' : 'Encore ' + chestLeft + ' conversations') + '</span>' +
      '<span class="bar bar-lg bar-pink" role="img" aria-label="Coffre : ' + p.chest_count + ' sur ' + p.chest_every + '"><span style="width:' + pct(p.chest_count, p.chest_every) + '%"></span></span>' +
      '<span class="tile-line"><span>avant d\'ouvrir le coffre</span><span>' + p.chest_count + ' / ' + p.chest_every + '</span></span></div></div></div>';

    html += '<section class="card"><span class="card-kicker" id="lang-label">Je veux parler</span><div class="langs" role="group" aria-labelledby="lang-label" style="margin-top:10px">' + langsHtml() + '</div></section>';

    html += '<section class="card"><span class="card-kicker">' + esc(langName(S.language)) + '</span><h2>Tes défis en attente</h2>';
    if (pending.length) {
      html += '<ul class="quests">';
      for (i = 0; i < pending.length; i++) { html += '<li>' + questHtml(pending[i], false) + '</li>'; }
      html += '</ul>';
    } else {
      html += '<p class="empty-note">' + (S.has_briefing ? 'Tous tes défis sont réussis. Le prochain bilan t\'en donnera de nouveaux.' : 'Pas encore de défi : ils arrivent avec ton premier bilan, à la fin d\'une conversation.') + '</p>';
    }
    html += '</section></aside></div></div></div></div>';
    return html;
  }

  function levelName(code) {
    var list = (S && S.levels) || [];
    for (var i = 0; i < list.length; i++) { if (list[i].code === code) { return list[i].name; } }
    return code || '';
  }

  // ------------------------------------------------------------------
  // Tutor voice + practice recording (shared by lessons and first use)
  // ------------------------------------------------------------------

  var AUDIO = { cache: {}, el: null };

  function say(text) {
    if (!S || !S.voice || !text) { return Promise.resolve(false); }
    var key = S.language + '|' + text;
    function play(url) {
      try {
        if (AUDIO.el) { AUDIO.el.pause(); }
        AUDIO.el = new Audio(url);
        var pr = AUDIO.el.play();
        if (pr && pr['catch']) { pr['catch'](function () {}); }
      } catch (e) { return false; }
      return true;
    }
    if (AUDIO.cache[key]) { return Promise.resolve(play(AUDIO.cache[key])); }
    return call('speak', text).then(function (res) {
      if (res.ok === false || !res.audio) { return false; }
      AUDIO.cache[key] = res.audio;
      return play(res.audio);
    });
  }

  // Offer to download the tutor's voice while it is missing for this language.
  function voiceCardHtml() {
    var offer = S.voice_offer;
    if (S.voice || !offer || !offer.supported) { return ''; }
    var busy = UI.setupBusy.download_voice;
    var html = '<section class="card review-card voice-card"><span class="review-ico">' + ICON.speaker(28) + '</span><div class="review-body"><h2>Donne une voix à ton tuteur</h2>' +
      '<p>Il prononce les mots, te fait écouter la bonne version quand c\'est presque ça, et débloque les exercices d\'écoute. ' + offer.megabytes + ' Mo à télécharger une seule fois, puis tout fonctionne hors ligne.</p>';
    if (busy) {
      var known = typeof busy.pct === 'number';
      html += '<div class="step-progress"><span class="bar' + (known ? '' : ' indet') + '"><span style="width:' + (known ? clamp(busy.pct, 0, 100) : 35) + '%"></span></span><small>' + busyLabel(busy) + '</small></div>';
    }
    html += '</div>';
    if (!busy) { html += '<button type="button" class="btn btn-green btn-sm" data-act="voice">Activer la voix</button>'; }
    return html + '</section>';
  }

  function refreshVoiceCard() {
    var el = $('#voice-card');
    if (el) { el.innerHTML = voiceCardHtml(); }
  }

  function stopAudio() {
    try { if (AUDIO.el) { AUDIO.el.pause(); } } catch (e) { /* nothing playing */ }
  }

  function sayBtn(text, label) {
    if (!S.voice) { return ''; }
    return '<button type="button" class="say' + (label ? ' say-wide' : '') + '" data-act="say" data-text="' + esc(text) + '" aria-label="Écouter : ' + esc(text) + '" title="Écouter">' + ICON.speaker(20) + (label ? '<span>' + label + '</span>' : '') + '</button>';
  }

  // Same button and states as the conversation's « Parler », for one answer.
  function practiceTalkHtml(label) {
    if (UI.rec === 'rec') {
      return '<span class="dock-hint"><kbd>Échap</kbd> annuler</span><button type="button" class="btn btn-lg btn-talk is-rec" id="talk" data-act="ptalk">' + ICON.stop(24) + 'J\'ai fini' +
        '<span class="meter" id="meter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="chrono" id="chrono">' + chrono() + '</span></button>';
    }
    if (UI.rec === 'starting') {
      return '<button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" disabled><span class="spinner"></span>Micro…</button>';
    }
    if (UI.rec === 'transcribing') {
      return '<button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" disabled><span class="spinner"></span>Je t\'écoute…</button>';
    }
    return '<span class="dock-hint"><kbd>Entrée</kbd></span><button type="button" class="btn btn-primary btn-lg btn-talk" id="talk" data-act="ptalk">' + ICON.mic(26) + (label || 'Parler') + '</button>';
  }

  function practiceToggle(target, onResult) {
    if (UI.rec === 'ready') {
      stopAudio();
      setRec('starting');
      call('practice_record_start').then(function (res) {
        if (UI.rec !== 'starting') { return; }
        setRec(res.ok === false ? 'ready' : 'rec');
      });
    } else if (UI.rec === 'rec') {
      var view = UI.view;
      setRec('transcribing');
      var done = function (res) {
        if (UI.view !== view || UI.rec !== 'transcribing') { return; }
        UI.rec = 'ready';
        if (UI.recTimer) { clearInterval(UI.recTimer); UI.recTimer = null; }
        onResult(res);
      };
      if (target) { call('practice_record_stop', target).then(done); }
      else { call('practice_record_stop').then(done); }
    }
  }

  function practiceCancel(quiet) {
    if (UI.rec !== 'rec' && UI.rec !== 'starting') { return; }
    setRec('ready');
    call('practice_record_cancel').then(function () { if (!quiet) { toast('Enregistrement annulé.', 'soft'); } });
  }

  // ------------------------------------------------------------------
  // View: first use — « Faisons connaissance »
  // ------------------------------------------------------------------

  function meetBody() {
    var m = UI.meet;
    var lang = esc(langName(S.language));
    var html = '';
    var i;
    if (m.step === 'intro') {
      html += '<div class="meet-card"><div class="setup-head">' + ICON.avatar(72) + '<div><span class="hero-kicker">' + lang + '</span><h1>Faisons connaissance</h1></div></div>' +
        '<p class="setup-sub">Pour te proposer des leçons à ta mesure, trouvons ensemble ton point de départ. Ça prend deux minutes, et tu pourras le changer quand tu veux.</p>' +
        '<div class="meet-choices">' +
        '<button type="button" class="choice-card is-main" data-act="meet-chat" data-autofocus><span class="choice-ico">' + ICON.mic(30) + '</span><span class="choice-body"><strong>On discute deux minutes</strong>' +
        '<span>Trois petites questions, tu réponds à voix haute, et ton tuteur trouve ton point de départ.</span></span></button>' +
        '<button type="button" class="choice-card" data-act="meet-pick"><span class="choice-ico choice-ico-plain">' + ICON.gear() + '</span><span class="choice-body"><strong>Je choisis moi-même</strong>' +
        '<span>Tu sais déjà où tu en es : choisis ton parcours directement.</span></span></button></div>' +
        '<div class="meet-lang"><span class="card-kicker" id="lang-label">Je veux parler</span><div class="langs" role="group" aria-labelledby="lang-label">' + langsHtml() + '</div></div></div>';
    } else if (m.step === 'loading') {
      html += '<div class="meet-card meet-center" role="status"><span class="spinner"></span><p class="setup-sub">Ton tuteur prépare ses questions…</p></div>';
    } else if (m.step === 'questions') {
      var q = m.questions[m.idx];
      html += '<div class="meet-card"><div class="meet-progress"><span class="card-kicker">Question ' + (m.idx + 1) + ' / ' + m.questions.length + '</span>' +
        '<span class="bar bar-lg" role="img" aria-label="Question ' + (m.idx + 1) + ' sur ' + m.questions.length + '"><span style="width:' + pct(m.idx, m.questions.length) + '%"></span></span></div>' +
        '<div class="row row-tutor is-last meet-q">' + ICON.avatar(52) + '<div class="bubble">' + esc(q.text) + sayBtnInline(q.text) + '</div></div>';
      if (m.showTr) {
        html += '<p class="meet-tr selectable">' + esc(q.translation) + '</p>';
      } else if (q.translation && q.translation !== q.text) {
        html += '<button type="button" class="link" data-act="meet-tr">Voir la traduction</button>';
      }
      if (m.heard) {
        html += '<div class="row row-user meet-a"><div class="bubble">' + esc(m.heard) + '</div></div>' +
          '<p class="meet-note">C\'est bien ce que tu as dit ? Sinon, tu peux recommencer.</p>';
      } else {
        html += '<p class="meet-note">Réponds à voix haute, comme tu peux. Il n\'y a pas de mauvaise réponse.</p>';
      }
      html += '</div>';
    } else if (m.step === 'assessing') {
      html += '<div class="meet-card meet-center" role="status"><span class="avatar-big">' + ICON.avatar(96) + '</span><h1>Ton tuteur t\'a écouté…</h1>' +
        '<p class="setup-sub">Il cherche le meilleur point de départ pour toi. Quelques secondes.</p><span class="bar bar-lg indet-bar"><span></span></span></div>';
    } else if (m.step === 'result') {
      var hint = '';
      for (i = 0; i < S.levels.length; i++) { if (S.levels[i].code === m.result.level) { hint = S.levels[i].hint; } }
      html += '<div class="meet-card meet-center"><span class="done-mark">' + ICON.check(46) + '</span><span class="hero-kicker">Ton point de départ en ' + lang + '</span>' +
        '<h1 class="meet-level">' + esc(levelName(m.result.level)) + '</h1>' +
        '<p class="meet-reason selectable">' + esc(m.result.reason || hint) + '</p>' +
        '<div class="meet-actions"><button type="button" class="btn btn-primary btn-lg" data-act="pick-level" data-code="' + esc(m.result.level) + '" id="meet-main" data-autofocus>C\'est parti</button>' +
        '<button type="button" class="btn btn-ghost" data-act="meet-pick">Choisir un autre point de départ</button></div></div>';
    } else {
      html += '<div class="meet-card"><div class="setup-head">' + ICON.avatar(64) + '<div><span class="hero-kicker">' + lang + '</span><h1>Où en es-tu ?</h1></div></div>' +
        '<p class="setup-sub">Choisis ce qui te ressemble le plus. Tu pourras changer de parcours dans les réglages.</p><div class="level-cards">';
      for (i = 0; i < S.levels.length; i++) {
        var lv = S.levels[i];
        html += '<button type="button" class="choice-card' + (m.result && m.result.level === lv.code ? ' is-main' : '') + '" data-act="pick-level" data-code="' + esc(lv.code) + '">' +
          '<span class="choice-ico choice-num">' + (i + 1) + '</span><span class="choice-body"><strong>' + esc(lv.name) + '</strong><span>' + esc(lv.hint) + '</span></span></button>';
      }
      html += '</div><div class="meet-actions"><button type="button" class="btn btn-ghost" data-act="meet-intro">' + ICON.back() + 'Retour</button></div></div>';
    }
    return html;
  }

  function sayBtnInline(text) { return S.voice ? ' ' + sayBtn(text) : ''; }

  function meetFootHtml() {
    var m = UI.meet;
    if (!m || m.step !== 'questions') { return ''; }
    if (m.heard) {
      return '<div class="dock-left"><button type="button" class="btn btn-ghost" data-act="meet-redo">' + ICON.refresh() + 'Recommencer</button></div>' +
        '<div class="dock-right"><span class="dock-hint"><kbd>Entrée</kbd></span><button type="button" class="btn btn-primary btn-lg" data-act="meet-next" id="meet-main">' +
        (m.idx + 1 >= m.questions.length ? 'Terminer' : 'Question suivante') + '</button></div>';
    }
    var busy = UI.rec !== 'ready';
    return '<div class="dock-left"><button type="button" class="btn btn-ghost" data-act="meet-skip"' + (busy ? ' disabled' : '') + '>Je ne comprends pas encore</button></div>' +
      '<div class="dock-right">' + practiceTalkHtml('Répondre') + '</div>';
  }

  function refreshMeetFoot() {
    var el = $('#meet-foot');
    if (!el) { return; }
    var html = meetFootHtml();
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
    var b = $('#meet-main') || $('#talk');
    if (b && !b.disabled && !UI.modal) { b.focus(); }
  }

  function viewMeet() {
    if (!UI.meet) { UI.meet = { step: 'intro', questions: [], idx: 0, answers: [], heard: null, showTr: false, result: null }; }
    var foot = meetFootHtml();
    return '<div class="view">' + topbar({ lang: true }) + '<div class="scroll"><div class="meet">' + meetBody() + '</div></div>' +
      '<footer class="dock" id="meet-foot"' + (foot ? '' : ' style="display:none"') + '>' + foot + '</footer></div>';
  }

  function refreshMeet() {
    if (UI.view !== 'meet') { return; }
    show('meet', true);
    var b = $('#meet-main') || $('#talk') || $('#app [data-autofocus]');
    if (b && !b.disabled && !UI.modal) { b.focus(); }
    if (UI.meet && UI.meet.step === 'questions' && !UI.meet.heard && !UI.meet.played) {
      UI.meet.played = true;
      say(UI.meet.questions[UI.meet.idx].text);
    }
  }

  function meetAssess() {
    var m = UI.meet;
    m.step = 'assessing';
    refreshMeet();
    call('assess_level', m.answers).then(function (res) {
      if (UI.view !== 'meet' || UI.meet !== m) { return; }
      if (res.ok === false || !res.level) { m.step = 'pick'; refreshMeet(); return; }
      m.result = { level: res.level, reason: res.reason };
      m.step = 'result';
      refreshMeet();
      confetti(30);
    });
  }

  function meetAnswer(transcript) {
    var m = UI.meet;
    m.answers.push({ id: m.questions[m.idx].id, transcript: transcript || '' });
    // A question the learner cannot understand ends the chat: harder ones would not help.
    if (!transcript) {
      for (var i = m.idx + 1; i < m.questions.length; i++) { m.answers.push({ id: m.questions[i].id, transcript: '' }); }
      meetAssess();
      return;
    }
    m.idx++;
    m.heard = null;
    m.showTr = false;
    m.played = false;
    if (m.idx >= m.questions.length) { meetAssess(); } else { refreshMeet(); }
  }

  function meetTalk() {
    var m = UI.meet;
    if (!m || m.step !== 'questions' || m.heard) { return; }
    practiceToggle(null, function (res) {
      if (res.ok !== false && res.heard) { m.heard = res.heard; }
      else if (res.ok !== false) { toast('Je n\'ai rien entendu. Réessaie en parlant un peu plus près du micro.', 'soft', 4200); }
      refreshMeet();
    });
  }

  function chooseLevel(code, el) {
    if (el) { el.disabled = true; }
    call('set_level', code).then(function (res) {
      if (!applyState(res)) { if (el) { el.disabled = false; } return; }
      var first = !!UI.meet;
      UI.meet = null;
      route();
      toast(first ? 'Ton parcours est prêt. C\'est parti !' : 'Parcours changé : ' + levelName(S.level) + '.', 'ok');
    });
  }

  // ------------------------------------------------------------------
  // View: lesson player
  // ------------------------------------------------------------------

  function lessonItem() { return UI.lesson.data.items[UI.lesson.pos]; }

  function enterItem() {
    UI.lesson.x = { phase: 'answer', sel: -1, built: [], tries: 0, res: null, correct: null, skipped: false };
    UI.rec = 'ready';
    if (UI.recTimer) { clearInterval(UI.recTimer); UI.recTimer = null; }
  }

  function startLesson(kind, unitId) {
    UI.lesson = null;
    UI.lessonEnd = null;
    UI.lessonLoading = { kind: kind };
    show('lesson');
    return call('get_lesson', kind, unitId || null, false).then(function (res) {
      if (UI.view !== 'lesson' || !UI.lessonLoading) { return; }
      UI.lessonLoading = null;
      if (res.ok === false || !res.lesson || !res.lesson.items || !res.lesson.items.length) {
        if (res.ok !== false) { toast('Cette leçon est vide. Réessaie dans un instant.', 'error'); }
        show('home');
        return;
      }
      UI.lesson = { data: res.lesson, pos: 0, results: {}, x: null };
      enterItem();
      show('lesson');
      afterItemShown();
    });
  }

  function blankHtml(sentence, fill, state) {
    var parts = String(sentence).split('___');
    if (parts.length < 2) { return esc(sentence); }
    var gap = fill ? '<span class="blank is-filled' + (state ? ' is-' + state : '') + '">' + esc(fill) + '</span>' : '<span class="blank" aria-label="mot manquant"></span>';
    return esc(parts[0]) + gap + esc(parts.slice(1).join('___'));
  }

  function optionsHtml(item, x) {
    var done = x.phase === 'done';
    var html = '<div class="options" role="radiogroup" aria-label="Réponses possibles">';
    for (var i = 0; i < item.options.length; i++) {
      var cls = 'opt';
      if (done && i === item.answer) { cls += ' is-right'; }
      else if (done && i === x.sel) { cls += ' is-wrong'; }
      else if (!done && i === x.sel) { cls += ' is-sel'; }
      html += '<button type="button" class="' + cls + '" data-act="opt" data-i="' + i + '" role="radio" aria-checked="' + (i === x.sel ? 'true' : 'false') + '"' + (done ? ' disabled' : '') + '>' +
        '<span class="opt-key">' + (i + 1) + '</span><span class="opt-text">' + esc(item.options[i]) + '</span></button>';
    }
    return html + '</div>';
  }

  function speakWordsHtml(item, x) {
    var res = x.res;
    if (!res || !res.words || !res.words.length) { return '<span class="speak-text selectable">' + esc(item.text) + '</span>'; }
    var html = '<span class="speak-text selectable">';
    for (var i = 0; i < res.words.length; i++) {
      var w = res.words[i];
      html += '<span class="w w-' + esc(w.status) + '">' + esc(w.word) + '</span> ';
    }
    return html + '</span>';
  }

  function itemHtml() {
    var L = UI.lesson;
    var item = lessonItem();
    var x = L.x;
    var i;
    var html = '<span class="card-kicker lesson-kicker">' + esc(L.data.title) + '</span>';
    if (L.data.source === 'generated' && L.pos === 0) {
      html += '<p class="gen-note">' + ICON.warn() + '<span>Leçon préparée par l\'IA de ton PC : elle peut contenir des erreurs.</span></p>';
    }
    if (item.kind === 'info') {
      html += '<h1 class="ex-title">' + esc(item.title) + '</h1><p class="ex-text selectable">' + esc(item.text).replace(/\n/g, '<br>') + '</p>';
      if (item.examples && item.examples.length) {
        html += '<ul class="examples">';
        for (i = 0; i < item.examples.length; i++) {
          var e = item.examples[i];
          html += '<li>' + sayBtn(e.text) + '<span class="ex-pair"><span class="ex-target selectable">' + esc(e.text) + '</span><span class="ex-tr selectable">' + esc(e.translation) + '</span></span></li>';
        }
        html += '</ul>';
      }
    } else if (item.kind === 'choice') {
      html += '<h1 class="ex-prompt">' + esc(item.prompt) + '</h1>';
      if (item.sentence) {
        var fill = x.phase === 'done' ? item.options[item.answer] : (x.sel >= 0 ? item.options[x.sel] : '');
        var state = x.phase === 'done' ? 'right' : '';
        html += '<p class="ex-sentence selectable">' + (item.sentence.indexOf('___') >= 0 ? blankHtml(item.sentence, fill, state) : esc(item.sentence)) + '</p>';
      }
      html += optionsHtml(item, x);
    } else if (item.kind === 'listen') {
      html += '<h1 class="ex-prompt">' + esc(item.prompt) + '</h1>' +
        '<div class="listen-box"><button type="button" class="btn btn-primary listen-btn" data-act="say" data-text="' + esc(item.audio_text) + '">' + ICON.speaker(26, '#062A45') + 'Écouter</button></div>' +
        optionsHtml(item, x);
    } else if (item.kind === 'order') {
      var done = x.phase === 'done';
      html += '<h1 class="ex-prompt">' + esc(item.prompt) + '</h1><p class="ex-tr-line selectable">' + esc(item.translation) + '</p>' +
        '<div class="order-line' + (done ? (x.correct ? ' is-right' : ' is-wrong') : '') + '" aria-label="Ta phrase">';
      for (i = 0; i < x.built.length; i++) {
        html += '<button type="button" class="tok" data-act="tok-rm" data-i="' + i + '"' + (done ? ' disabled' : '') + '>' + esc(item.tokens[x.built[i]]) + '</button>';
      }
      if (!x.built.length) { html += '<span class="order-hint">Clique sur les mots ci-dessous</span>'; }
      html += '</div><div class="order-bank" aria-label="Mots disponibles">';
      for (i = 0; i < item.tokens.length; i++) {
        var used = x.built.indexOf(i) >= 0;
        html += '<button type="button" class="tok' + (used ? ' is-used' : '') + '" data-act="tok-add" data-i="' + i + '"' + (used || done ? ' disabled' : '') + (used ? ' aria-hidden="true" tabindex="-1"' : '') + '>' + esc(item.tokens[i]) + '</button>';
      }
      html += '</div>';
    } else if (item.kind === 'speak') {
      html += '<h1 class="ex-prompt">' + esc(item.prompt) + '</h1><div class="speak-card">' +
        '<div class="speak-row">' + sayBtn(item.text) + speakWordsHtml(item, x) + '</div>' +
        '<span class="ex-tr selectable">' + esc(item.translation) + '</span></div>';
      if (x.res) {
        var res = x.res;
        var weak = false;
        var miss = false;
        for (i = 0; i < (res.words || []).length; i++) {
          if (res.words[i].status === 'weak') { weak = true; }
          if (res.words[i].status === 'miss') { miss = true; }
        }
        html += '<p class="heard selectable">' + (res.heard ? 'Tu as dit : « ' + esc(res.heard) + ' »' : 'Je n\'ai rien entendu.') + '</p>';
        if (weak || miss) {
          html += '<p class="legend">' + (weak ? '<span><i class="dot dot-weak"></i>à préciser</span>' : '') + (miss ? '<span><i class="dot dot-miss"></i>pas reconnu</span>' : '') + '</p>';
        }
      }
    } else {
      html += '<h1 class="ex-prompt">Exercice non pris en charge</h1>';
    }
    return html;
  }

  function fbHtml(ok, title, detail) {
    return '<div class="fb ' + (ok ? 'fb-ok' : 'fb-ko') + '" role="status"><span class="fb-mark">' + (ok ? ICON.check(22, '#23330A', 4) : ICON.close()) + '</span>' +
      '<div class="fb-body"><strong>' + title + '</strong>' + (detail ? '<span class="selectable">' + detail + '</span>' : '') + '</div></div>';
  }

  function nextBtn(ok) {
    var last = UI.lesson.pos + 1 >= UI.lesson.data.items.length;
    return '<span class="dock-hint"><kbd>Entrée</kbd></span><button type="button" class="btn btn-lg ' + (ok === false ? 'btn-pink' : (ok ? 'btn-green' : 'btn-primary')) + '" data-act="lesson-next" id="lesson-main">' + (last ? 'Terminer' : 'Continuer') + '</button>';
  }

  var PRAISE = ['Bien joué !', 'Exact !', 'Parfait !', 'Bravo !'];

  function lessonFootHtml() {
    var L = UI.lesson;
    if (!L || UI.lessonEnd) { return ''; }
    var item = lessonItem();
    var x = L.x;
    var praise = PRAISE[L.pos % PRAISE.length];
    if (item.kind === 'info') {
      return '<div class="dock-left"></div><div class="dock-right">' + nextBtn(null) + '</div>';
    }
    if (item.kind === 'speak') {
      if (x.phase === 'done') {
        if (x.correct) { return fbHtml(true, x.tries > 1 ? 'Tu l\'as !' : praise, 'Ton tuteur t\'a bien compris.') + '<div class="dock-right">' + nextBtn(true) + '</div>'; }
        return fbHtml(false, x.skipped ? 'Pas de souci' : 'On y reviendra', x.skipped ? 'Cet exercice reviendra en révision.' : 'Tu le retravailleras en révision : ça finit toujours par venir.') + '<div class="dock-right">' + nextBtn(false) + '</div>';
      }
      var busy = UI.rec !== 'ready';
      if (x.res && UI.rec === 'ready') {
        var near = x.res.score >= 0.5;
        var detail = S.voice ? 'Écoute : voilà comment le dire. Puis réessaie.' : (near ? 'Regarde les mots en couleur, puis réessaie.' : 'Prends ton temps, articule bien, et réessaie.');
        return fbHtml(false, near ? 'C\'est presque ça' : 'On réessaie', detail) + '<div class="dock-right">' + practiceTalkHtml('Réessayer') + '</div>';
      }
      return '<div class="dock-left"><button type="button" class="btn btn-ghost btn-sm" data-act="speak-skip"' + (busy ? ' disabled' : '') + '>Je ne peux pas parler maintenant</button></div>' +
        '<div class="dock-right">' + practiceTalkHtml('Parler') + '</div>';
    }
    if (x.phase === 'done') {
      if (x.correct) { return fbHtml(true, praise, item.explanation ? esc(item.explanation) : '') + '<div class="dock-right">' + nextBtn(true) + '</div>'; }
      var right = item.kind === 'order' ? item.sentence : item.options[item.answer];
      var more = 'Bonne réponse : <b>' + esc(right) + '</b>' + (item.explanation ? '<br>' + esc(item.explanation) : '');
      return fbHtml(false, 'Pas tout à fait', more) + '<div class="dock-right">' + nextBtn(false) + '</div>';
    }
    var ready = item.kind === 'order' ? x.built.length === item.tokens.length : x.sel >= 0;
    return '<div class="dock-left"></div><div class="dock-right"><span class="dock-hint"><kbd>Entrée</kbd></span>' +
      '<button type="button" class="btn btn-primary btn-lg" data-act="lesson-check" id="lesson-main"' + (ready ? '' : ' disabled') + '>Vérifier</button></div>';
  }

  function refreshLessonFoot() {
    var el = $('#lesson-foot');
    if (!el) { return; }
    el.innerHTML = lessonFootHtml();
    var x = UI.lesson && UI.lesson.x;
    el.className = 'dock lesson-foot' + (x && x.phase === 'done' ? (x.correct === false ? ' is-ko' : (x.correct ? ' is-ok' : '')) : '');
    if (UI.rec === 'rec' && !UI.modal) {
      var talk = $('#talk');
      if (talk) { talk.focus(); }
    }
  }

  function focusLessonMain() {
    if (UI.modal) { return; }
    var b = $('#lesson-main') || $('#talk');
    if (b && !b.disabled) { b.focus(); }
  }

  function refreshLesson(focus) {
    var body = $('#lesson-body');
    if (!body || !UI.lesson) { return; }
    body.innerHTML = itemHtml();
    refreshLessonFoot();
    if (focus) { focusLessonMain(); }
  }

  function lessonProgress() {
    var L = UI.lesson;
    return pct(L.pos, L.data.items.length);
  }

  function viewLesson() {
    if (UI.lessonLoading) {
      var kind = UI.lessonLoading.kind;
      return '<div class="view"><div class="waiting" role="status"><span class="avatar-big">' + ICON.avatar(110) + '</span>' +
        '<h1>' + (kind === 'review' ? 'Ton tuteur rassemble tes révisions…' : 'Ton tuteur prépare ta leçon…') + '</h1>' +
        '<p>C\'est presque prêt. Si la leçon est écrite à la demande, ça peut prendre jusqu\'à une minute.</p>' +
        '<span class="bar bar-lg"><span></span></span>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="lesson-cancel">Annuler</button></div></div>';
    }
    if (UI.lessonEnd) { return viewLessonEnd(); }
    var L = UI.lesson;
    if (!L) { return viewHome(); }
    var x = L.x;
    return '<div class="view lesson"><header class="lesson-top">' +
      '<button type="button" class="btn btn-ghost btn-icon" data-act="lesson-quit" aria-label="Quitter la leçon" title="Quitter la leçon">' + ICON.close() + '</button>' +
      '<span class="bar bar-lg bar-green lesson-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + lessonProgress() + '" aria-label="Avancement de la leçon"><span id="lesson-fill" style="width:' + lessonProgress() + '%"></span></span>' +
      '<span class="lesson-count" id="lesson-count">' + (L.pos + 1) + ' / ' + L.data.items.length + '</span></header>' +
      '<div class="scroll" id="lesson-scroll"><div class="lesson-wrap"><div class="lesson-body" id="lesson-body">' + itemHtml() + '</div></div></div>' +
      '<footer class="dock lesson-foot' + (x.phase === 'done' ? (x.correct === false ? ' is-ko' : (x.correct ? ' is-ok' : '')) : '') + '" id="lesson-foot">' + lessonFootHtml() + '</footer></div>';
  }

  function afterItemShown() {
    if (!UI.lesson || UI.lessonEnd) { return; }
    var item = lessonItem();
    focusLessonMain();
    if (item.kind === 'listen') { say(item.audio_text); }
    else if (item.kind === 'speak') { say(item.text); }
  }

  function lessonCheck() {
    var L = UI.lesson;
    var item = lessonItem();
    var x = L.x;
    if (x.phase !== 'answer') { return; }
    var correct;
    if (item.kind === 'order') {
      if (x.built.length !== item.tokens.length) { return; }
      var built = x.built.map(function (i) { return item.tokens[i]; }).join(' ');
      correct = built.replace(/\s+/g, ' ').trim() === String(item.sentence).replace(/\s+/g, ' ').trim();
    } else {
      if (x.sel < 0) { return; }
      correct = x.sel === item.answer;
    }
    x.phase = 'done';
    x.correct = correct;
    L.results[item.index] = { index: item.index, correct: correct, tries: 1 };
    refreshLesson(true);
  }

  function lessonSpeakResult(res) {
    var L = UI.lesson;
    if (!L) { return; }
    var item = lessonItem();
    var x = L.x;
    if (res.ok === false) { refreshLesson(true); return; }
    if (!res.heard && !(res.words && res.words.length)) {
      toast('Je n\'ai rien entendu. Réessaie en parlant un peu plus près du micro.', 'soft', 4200);
      refreshLesson(true);
      return;
    }
    x.tries++;
    x.res = res;
    if (res.passed) {
      x.phase = 'done';
      x.correct = true;
      L.results[item.index] = { index: item.index, correct: true, tries: x.tries };
    } else if (x.tries >= 3) {
      x.phase = 'done';
      x.correct = false;
      L.results[item.index] = { index: item.index, correct: false, tries: x.tries };
    } else {
      say(item.text);
    }
    refreshLesson(true);
  }

  function lessonTalk() {
    var L = UI.lesson;
    if (!L || UI.lessonEnd) { return; }
    var item = lessonItem();
    if (item.kind !== 'speak' || L.x.phase !== 'answer') { return; }
    practiceToggle(item.text, lessonSpeakResult);
  }

  function lessonNext() {
    var L = UI.lesson;
    if (!L || UI.lessonEnd || UI.lessonFinishing) { return; }
    var item = lessonItem();
    if (item.kind !== 'info' && L.x.phase !== 'done') { return; }
    stopAudio();
    L.pos++;
    if (L.pos >= L.data.items.length) { finishLesson(); return; }
    enterItem();
    var fill = $('#lesson-fill');
    var count = $('#lesson-count');
    if (fill) { fill.style.width = lessonProgress() + '%'; }
    if (count) { count.textContent = (L.pos + 1) + ' / ' + L.data.items.length; }
    var body = $('#lesson-body');
    if (body) {
      body.classList.remove('slide-in');
      void body.offsetWidth;
      body.classList.add('slide-in');
    }
    refreshLesson(false);
    var sc = $('#lesson-scroll');
    if (sc) { sc.scrollTop = 0; }
    afterItemShown();
  }

  function finishLesson() {
    var L = UI.lesson;
    var results = [];
    for (var i = 0; i < L.data.items.length; i++) {
      var it = L.data.items[i];
      if (it.kind === 'info') { continue; }
      results.push(L.results[it.index] || { index: it.index, correct: false, tries: 1 });
    }
    UI.lessonFinishing = true;
    var fill = $('#lesson-fill');
    if (fill) { fill.style.width = '100%'; }
    var main = $('#lesson-main');
    if (main) { main.disabled = true; }
    call('finish_lesson', L.data.id, results).then(function (res) {
      UI.lessonFinishing = false;
      if (UI.view !== 'lesson' || UI.lesson !== L) { return; }
      if (res.ok === false) { leaveLesson(); return; }
      if (res.progress) { S.progress = res.progress; }
      if (res.path) { S.path = res.path; }
      UI.lessonEnd = res;
      show('lesson');
      confetti(res.stars >= 3 ? 70 : (res.stars === 2 ? 40 : 20));
      var b = $('#start-btn');
      if (b) { b.focus(); }
    });
  }

  function viewLessonEnd() {
    var r = UI.lessonEnd;
    var L = UI.lesson;
    var stars = clamp(r.stars | 0, 1, 3);
    var title = stars === 3 ? 'Sans faute ou presque, bravo !' : (stars === 2 ? 'Bien joué !' : 'Leçon terminée !');
    var rec = (S.path && S.path.recommended) || null;
    var html = '<div class="view"><div class="scroll"><div class="lesson-end"><div class="end-card">' +
      '<div class="end-stars" role="img" aria-label="' + stars + (stars > 1 ? ' étoiles' : ' étoile') + ' sur 3">';
    for (var i = 1; i <= 3; i++) { html += '<span class="end-star' + (i <= stars ? ' is-on' : '') + '" style="animation-delay:' + (0.15 + i * 0.18) + 's">' + ICON.star(i === 2 ? 92 : 72, i <= stars) + '</span>'; }
    html += '</div><h1>' + title + '</h1><p class="end-sub">' + esc(L ? L.data.title : '') + '</p><div class="rewards end-rewards">' +
      '<div class="reward">' + ICON.bolt(26) + '<span><span class="reward-num">+' + fmt(r.xp_gained || 0) + ' XP</span><span class="reward-label">gagnés</span></span></div>' +
      '<div class="reward">' + ICON.check(28, '#8DB81F', 4) + '<span><span class="reward-num">' + (r.correct | 0) + ' / ' + (r.total | 0) + '</span><span class="reward-label">du premier coup</span></span></div>';
    if (r.leveled_up) {
      html += '<div class="reward reward-level">' + levelBadge(S.progress.level, 46) + '<span><span class="reward-num">Niveau ' + S.progress.level + ' !</span><span class="reward-label">Tu montes de niveau</span></span></div>';
    }
    html += '</div>';
    if ((r.total | 0) > (r.correct | 0)) { html += '<p class="end-note">Ce qui t\'a résisté reviendra en révision, pour bien l\'ancrer.</p>'; }
    html += '<div class="end-actions"><button type="button" class="btn btn-primary btn-lg" data-act="continue" id="start-btn">Continuer</button>';
    if (rec) { html += '<span class="end-next">À suivre : <b>' + esc(rec.label) + '</b></span>'; }
    html += '<button type="button" class="btn btn-ghost" data-act="lesson-home">Retour à l\'accueil</button></div></div></div></div></div>';
    return html;
  }

  function leaveLesson() {
    practiceCancel(true);
    stopAudio();
    UI.lesson = null;
    UI.lessonEnd = null;
    UI.lessonLoading = null;
    UI.lessonFinishing = false;
    UI.rec = 'ready';
    return call('get_state').then(function (res) {
      applyState(res);
      route();
    });
  }

  function runRecommended() {
    var rec = (S.path && S.path.recommended) || { kind: 'conversation' };
    practiceCancel(true);
    UI.lesson = null;
    UI.lessonEnd = null;
    if (rec.kind === 'conversation') { return startSession(S.has_briefing && UI.followup); }
    if (rec.kind === 'review') { return startLesson('review', null); }
    return startLesson(rec.kind, rec.unit_id);
  }

  // ------------------------------------------------------------------
  // Modals
  // ------------------------------------------------------------------

  function openModal(html, kind) {
    UI.lastFocus = document.activeElement;
    UI.modal = { kind: kind };
    $('#modal-root').innerHTML = '<div class="overlay" data-act="overlay">' + html + '</div>';
    var first = $('#modal-root [data-autofocus]') || $('#modal-root .modal');
    if (first) { first.focus(); }
  }

  function closeModal() {
    if (!UI.modal) { return; }
    UI.modal = null;
    UI.draft = null;
    $('#modal-root').innerHTML = '';
    if (UI.lastFocus && document.body.contains(UI.lastFocus)) { UI.lastFocus.focus(); }
    UI.lastFocus = null;
  }

  function confirmModal(title, text, yesLabel, act) {
    openModal('<div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="m-title">' +
      '<div class="modal-head"><h2 id="m-title">' + title + '</h2></div>' +
      '<div class="modal-body"><p class="modal-text">' + text + '</p></div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="modal-close">Annuler</button>' +
      '<button type="button" class="btn btn-pink btn-sm" data-act="' + act + '" data-autofocus>' + yesLabel + '</button></div></div>', 'confirm');
  }

  var PROVIDERS = [
    { id: 'ollama', label: 'Local (Ollama)', url: 'http://127.0.0.1:11434/v1' },
    { id: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1' },
    { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1' },
    { id: 'opencode', label: 'OpenCode', url: 'https://opencode.ai/inference/go/openai/v1' }
  ];

  function providerUrl(id) {
    for (var i = 0; i < PROVIDERS.length; i++) { if (PROVIDERS[i].id === id) { return PROVIDERS[i].url; } }
    return '';
  }

  function isDefaultUrl(url) {
    if (!url) { return true; }
    for (var i = 0; i < PROVIDERS.length; i++) { if (PROVIDERS[i].url === url) { return true; } }
    return /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url);
  }

  var WHISPER_MODELS = [
    { id: 'tiny', label: 'tiny — très rapide, moins précis' },
    { id: 'base', label: 'base — rapide' },
    { id: 'small', label: 'small — équilibré (recommandé)' },
    { id: 'medium', label: 'medium — précis, plus lent' }
  ];

  function readDraft() {
    var d = UI.draft;
    if (!d) { return; }
    var el;
    if ((el = $('#set-mic'))) { d.mic = el.value === '' ? null : el.value; }
    if ((el = $('#set-base-url'))) { d.base_url = el.value.trim(); }
    if ((el = $('#set-api-key'))) { d.api_key = el.value; }
    if ((el = $('#set-model'))) { d.model = el.value.trim(); }
    if ((el = $('#set-whisper'))) { d.whisper_model = el.value; }
    if ((el = $('#set-hq'))) { d.high_quality = el.checked; }
    if ((el = $('#set-goal'))) { d.goal = clamp(parseInt(el.value, 10) || 5, 1, 50); }
  }

  function settingsBodyHtml() {
    var d = UI.draft;
    var external = d.api !== 'ollama';
    var i;
    var mics = '<option value=""' + (d.mic == null || d.mic === '' ? ' selected' : '') + '>Micro par défaut du système</option>';
    for (i = 0; i < d.mics.length; i++) {
      var mc = d.mics[i];
      mics += '<option value="' + esc(mc.id) + '"' + (String(d.mic) === String(mc.id) ? ' selected' : '') + '>' + esc(mc.name) + (mc['default'] ? ' (par défaut)' : '') + '</option>';
    }
    var provs = '';
    for (i = 0; i < PROVIDERS.length; i++) {
      provs += '<button type="button" class="btn" data-act="provider" data-val="' + PROVIDERS[i].id + '" aria-pressed="' + (d.api === PROVIDERS[i].id ? 'true' : 'false') + '">' + PROVIDERS[i].label + '</button>';
    }
    var wm = '';
    var known = false;
    for (i = 0; i < WHISPER_MODELS.length; i++) {
      if (WHISPER_MODELS[i].id === d.whisper_model) { known = true; }
      wm += '<option value="' + WHISPER_MODELS[i].id + '"' + (WHISPER_MODELS[i].id === d.whisper_model ? ' selected' : '') + '>' + WHISPER_MODELS[i].label + '</option>';
    }
    if (!known && d.whisper_model) { wm = '<option value="' + esc(d.whisper_model) + '" selected>' + esc(d.whisper_model) + '</option>' + wm; }

    var html = '';
    if (S.levels && S.levels.length && S.level) {
      var lv = '';
      for (i = 0; i < S.levels.length; i++) {
        lv += '<button type="button" class="btn" data-act="set-level" data-code="' + esc(S.levels[i].code) + '" title="' + esc(S.levels[i].hint) + '" aria-pressed="' + (S.levels[i].code === S.level ? 'true' : 'false') + '">' + esc(S.levels[i].name) + '</button>';
      }
      html += '<div class="field"><span class="label" id="lvl-label">Ton parcours en ' + esc(langName(S.language)) + '</span><div class="seg" role="group" aria-labelledby="lvl-label">' + lv + '</div>' +
        '<span class="hint">Change de parcours si les leçons te semblent trop faciles ou trop difficiles. Tes étoiles sont conservées.</span></div>';
    }
    html += '<div class="field"><label for="set-mic">Micro</label><select class="select" id="set-mic">' + mics + '</select></div>';

    html += '<div class="field"><span class="label" id="prov-label">Où tourne le tuteur</span><div class="seg" role="group" aria-labelledby="prov-label">' + provs + '</div>';
    if (external) {
      html += '<div class="warn" style="margin-top:6px"><div class="warn-row">' + ICON.warn() + '<span><strong>Tes conversations quittent ce PC.</strong> Avec un fournisseur externe, ce que tu dis (une fois transcrit) est envoyé à ses serveurs et soumis à ses conditions. Lis sa politique de confidentialité avant de l\'utiliser.</span></div></div>';
    } else {
      html += '<span class="hint">En local, rien ne quitte ton PC.</span>';
    }
    html += '</div>';

    if (external) {
      html += '<div class="field-row"><div class="field"><label for="set-base-url">URL de base de l\'API</label><input class="input" id="set-base-url" type="url" spellcheck="false" autocomplete="off" value="' + esc(d.base_url || '') + '" placeholder="https://…/v1"></div>' +
        '<div class="field"><label for="set-api-key">Clé API</label><input class="input" id="set-api-key" type="password" autocomplete="off" value="' + esc(d.api_key || '') + '" placeholder="' + (d.api_key_set ? 'Déjà enregistrée — laisse vide pour la garder' : 'Colle ta clé ici') + '"></div></div>';
    }

    html += '<div class="field"><label for="set-model">Modèle de langue</label><input class="input" id="set-model" type="text" spellcheck="false" autocomplete="off" value="' + esc(d.model || '') + '" placeholder="llama3.1:8b">';
    if (!external && d.models.length) {
      html += '<div class="pills" aria-label="Modèles installés">';
      for (i = 0; i < d.models.length; i++) { html += '<button type="button" class="pill" data-act="pick-model" data-val="' + esc(d.models[i]) + '">' + esc(d.models[i]) + '</button>'; }
      html += '</div><span class="hint">Modèles déjà installés dans Ollama. Un autre nom sera téléchargé au besoin.</span>';
    }
    html += '</div>';

    html += '<div class="field-row"><div class="field"><label for="set-whisper">Modèle de transcription (Whisper)</label><select class="select" id="set-whisper">' + wm + '</select></div>' +
      '<div class="field"><label for="set-goal">Objectif de répliques par séance</label><input class="input" id="set-goal" type="number" min="1" max="50" step="1" value="' + esc(d.goal) + '"></div></div>';

    html += '<label class="check"><input type="checkbox" id="set-hq"' + (d.high_quality ? ' checked' : '') + '><span class="box">' + ICON.check(18, '#23330A', 4) + '</span>Transcription haute qualité (plus lente)</label>';

    html += '<div><button type="button" class="btn btn-sm" data-act="open-logs">' + ICON.folder() + 'Ouvrir le dossier des séances</button></div>';

    html += '<div class="settings-about"><span>Language Tutor · version ' + esc(S.version || '?') + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-act="check-update">' + ICON.refresh() + 'Vérifier les mises à jour</button></div>';
    return html;
  }

  function openSettings() {
    if (!S) { return; }
    var st = S.settings;
    UI.draft = {
      api: st.api || 'ollama', base_url: st.base_url || '', api_key: '', api_key_set: !!st.api_key_set,
      model: st.model || '', whisper_model: st.whisper_model || 'small', high_quality: !!st.high_quality,
      mic: st.mic, goal: st.goal || 5, mics: [], models: []
    };
    openModal('<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title" tabindex="-1">' +
      '<div class="modal-head"><h2 id="m-title">Réglages</h2><button type="button" class="btn btn-ghost btn-icon" data-act="modal-close" aria-label="Fermer">' + ICON.close() + '</button></div>' +
      '<div class="modal-body" id="settings-body">' + settingsBodyHtml() + '</div>' +
      '<div class="modal-foot"><button type="button" class="btn btn-ghost btn-sm" data-act="modal-close">Annuler</button>' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="save-settings">Enregistrer</button></div></div>', 'settings');
    Promise.all([call('list_mics'), call('list_models')]).then(function (r) {
      if (!UI.draft) { return; }
      readDraft();
      UI.draft.mics = (r[0] && r[0].mics) || [];
      UI.draft.models = (r[1] && r[1].models) || [];
      var body = $('#settings-body');
      if (body) { body.innerHTML = settingsBodyHtml(); }
    });
  }

  function refreshSettingsBody() {
    var body = $('#settings-body');
    if (body) {
      var top = body.scrollTop;
      body.innerHTML = settingsBodyHtml();
      body.scrollTop = top;
    }
  }

  function saveSettings() {
    readDraft();
    var d = UI.draft;
    if (!d.model) { toast('Indique un modèle de langue.', 'error'); return; }
    var payload = { api: d.api, model: d.model, whisper_model: d.whisper_model, high_quality: d.high_quality, mic: d.mic, goal: d.goal };
    if (d.api !== 'ollama') {
      if (!d.base_url) { toast('Indique l\'URL de base de l\'API.', 'error'); return; }
      payload.base_url = d.base_url;
      if (d.api_key) { payload.api_key = d.api_key; }
    } else if (d.api !== S.settings.api) {
      // Back to local: restore the local address.
      payload.base_url = isDefaultUrl(d.base_url) ? providerUrl('ollama') : d.base_url;
    }
    call('save_settings', payload).then(function (res) {
      if (!applyState(res)) { return; }
      closeModal();
      toast('Réglages enregistrés.', 'ok');
      if (!S.session && !S.setup.ready) { show('setup'); }
      else if (!S.session && UI.view === 'setup' && S.setup.ready) { route(); }
      else { show(UI.view, true); }
    });
  }

  // ------------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------------

  function show(view, keep) {
    UI.view = view;
    var html;
    if (view === 'setup') { html = viewSetup(); }
    else if (view === 'home') { html = viewHome(); }
    else if (view === 'conversation') { html = viewConversation(); }
    else if (view === 'bilan') { html = UI.feedbackLoading || !UI.feedback ? viewBilanWaiting() : viewBilan(); }
    else if (view === 'meet') { html = viewMeet(); }
    else if (view === 'lesson') { html = viewLesson(); }
    else { html = '<div class="boot" role="status"><div class="boot-dot"></div><span>Chargement…</span></div>'; }
    $('#app').innerHTML = html;
    if (keep) {
      var v = $('#app .view');
      if (v) { v.style.animation = 'none'; }
    }
    if (view === 'conversation') { markLastTutor(); scrollThread(false); }
    if (view === 'bilan' && UI.feedback && !UI.feedbackLoading) { afterBilanShown(false); }
  }

  function route() {
    if (S.session) {
      UI.typing = false;
      UI.rec = 'ready';
      show(S.session.feedback_done && UI.feedback ? 'bilan' : 'conversation');
    } else if (!S.setup.ready) {
      show('setup');
    } else if (S.levels && S.levels.length && !S.level) {
      // No starting point yet for this language: first-use flow.
      if (UI.view !== 'meet') { UI.meet = null; }
      UI.rec = 'ready';
      show('meet');
      var first = $('#app [data-autofocus]');
      if (first) { first.focus(); }
    } else {
      UI.meet = null;
      show('home');
    }
  }

  function resetSessionUi() {
    UI.feedback = null;
    UI.feedbackLoading = false;
    UI.fbReplies = 0;
    UI.typing = false;
    if (UI.recTimer) { clearInterval(UI.recTimer); UI.recTimer = null; }
    UI.rec = 'ready';
  }

  function startSession(followup) {
    resetSessionUi();
    return call('start_session', !!followup).then(function (res) {
      if (res.ok === false || !res.session) { return; }
      S.session = res.session;
      show('conversation');
      var talk = $('#talk');
      if (talk) { talk.focus(); }
    });
  }

  function goHome() {
    return call('end_session').then(function (res) {
      resetSessionUi();
      if (applyState(res)) { route(); }
    });
  }

  function requestFeedback() {
    UI.feedbackLoading = true;
    show('bilan');
    call('request_feedback').then(function (res) {
      if (res.ok === false) {
        UI.feedbackLoading = false;
        show(UI.feedback ? 'bilan' : 'conversation');
      }
    });
  }

  // ------------------------------------------------------------------
  // Actions (event delegation on [data-act])
  // ------------------------------------------------------------------

  var ACT = {
    settings: function () { openSettings(); },
    'modal-close': function () { closeModal(); },
    overlay: function (el, ev) { if (ev.target === el) { closeModal(); } },
    recheck: function (el) {
      el.disabled = true;
      call('recheck_setup').then(function (res) {
        if (applyState(res)) {
          if (S.setup.ready) { toast('Tout est prêt !', 'ok'); route(); }
          else { show('setup', true); }
        } else { el.disabled = false; }
      });
    },
    voice: function () {
      UI.setupBusy.download_voice = { pct: null, label: 'Démarrage…' };
      refreshVoiceCard();
      call('setup_action', 'download_voice').then(function (res) {
        if (res.ok === false) { delete UI.setupBusy.download_voice; refreshVoiceCard(); }
      });
    },
    setup: function (el) {
      var step = el.getAttribute('data-step');
      UI.setupBusy[step] = { pct: null, label: 'Démarrage…' };
      refreshSetup();
      call('setup_action', step).then(function (res) {
        if (res.ok === false) { delete UI.setupBusy[step]; refreshSetup(); }
      });
    },
    lang: function (el) {
      var code = el.getAttribute('data-code');
      if (code === S.language) { return; }
      practiceCancel(true);
      call('set_language', code).then(function (res) {
        if (!applyState(res)) { return; }
        UI.meet = null;
        if (S.levels && S.levels.length && !S.level) { route(); } else { UI.view = 'home'; show('home', true); }
      });
    },
    'continue': function (el) {
      el.disabled = true;
      var cb = $('#followup');
      if (cb) { UI.followup = cb.checked; }
      var p = runRecommended();
      if (p && p.then) { p.then(function () { var b = $('#start-btn'); if (b) { b.disabled = false; } }); }
    },
    lesson: function (el) {
      startLesson(el.getAttribute('data-kind'), el.getAttribute('data-unit'));
    },
    'lesson-cancel': function () { leaveLesson(); },
    'lesson-quit': function () {
      if (UI.rec === 'rec') { practiceCancel(true); }
      confirmModal('Quitter la leçon ?', 'Ta progression dans cette leçon ne sera pas enregistrée.', 'Quitter', 'lesson-quit-yes');
    },
    'lesson-quit-yes': function () { closeModal(); leaveLesson(); },
    'lesson-home': function () { leaveLesson(); },
    'lesson-check': function () { lessonCheck(); },
    'lesson-next': function () { lessonNext(); },
    opt: function (el) {
      var L = UI.lesson;
      if (!L || L.x.phase !== 'answer') { return; }
      L.x.sel = parseInt(el.getAttribute('data-i'), 10);
      refreshLesson(true);
    },
    'tok-add': function (el) {
      var L = UI.lesson;
      if (!L || L.x.phase !== 'answer') { return; }
      var i = parseInt(el.getAttribute('data-i'), 10);
      if (L.x.built.indexOf(i) < 0) { L.x.built.push(i); }
      refreshLesson(L.x.built.length === lessonItem().tokens.length);
    },
    'tok-rm': function (el) {
      var L = UI.lesson;
      if (!L || L.x.phase !== 'answer') { return; }
      L.x.built.splice(parseInt(el.getAttribute('data-i'), 10), 1);
      refreshLesson(false);
    },
    'speak-skip': function () {
      var L = UI.lesson;
      if (!L || UI.rec !== 'ready') { return; }
      var item = lessonItem();
      L.x.phase = 'done';
      L.x.correct = false;
      L.x.skipped = true;
      L.results[item.index] = { index: item.index, correct: false, tries: Math.max(1, L.x.tries) };
      refreshLesson(true);
    },
    say: function (el) { say(el.getAttribute('data-text')); },
    ptalk: function () {
      if (UI.view === 'lesson') { lessonTalk(); }
      else if (UI.view === 'meet') { meetTalk(); }
    },
    'meet-chat': function (el) {
      el.disabled = true;
      var m = UI.meet;
      m.step = 'loading';
      refreshMeet();
      call('starter_questions').then(function (res) {
        if (UI.view !== 'meet' || UI.meet !== m) { return; }
        if (res.ok === false || !res.questions || !res.questions.length) { m.step = 'pick'; refreshMeet(); return; }
        m.questions = res.questions;
        m.idx = 0;
        m.answers = [];
        m.heard = null;
        m.showTr = false;
        m.played = false;
        m.step = 'questions';
        refreshMeet();
      });
    },
    'meet-pick': function () { practiceCancel(true); UI.meet.step = 'pick'; refreshMeet(); },
    'meet-intro': function () { UI.meet.step = 'intro'; UI.meet.result = null; refreshMeet(); },
    'meet-tr': function () { UI.meet.showTr = true; refreshMeet(); },
    'meet-redo': function () { UI.meet.heard = null; refreshMeet(); },
    'meet-next': function () { if (UI.meet.heard) { meetAnswer(UI.meet.heard); } },
    'meet-skip': function () { if (UI.rec === 'ready') { meetAnswer(''); } },
    'pick-level': function (el) { chooseLevel(el.getAttribute('data-code'), el); },
    'set-level': function (el) {
      var code = el.getAttribute('data-code');
      if (code === S.level) { return; }
      readDraft();
      call('set_level', code).then(function (res) {
        if (!applyState(res)) { return; }
        refreshSettingsBody();
        if (UI.view === 'home') { show('home', true); }
        toast('Parcours changé : ' + levelName(S.level) + '.', 'ok');
      });
    },
    start: function (el) {
      el.disabled = true;
      var cb = $('#followup');
      if (cb) { UI.followup = cb.checked; }
      startSession(S.has_briefing && UI.followup).then(function () {
        var b = $('#start-btn');
        if (b) { b.disabled = false; }
        el.disabled = false;
      });
    },
    talk: function () { toggleTalk(); },
    challenge: function (el) {
      var id = el.getAttribute('data-id');
      call('toggle_challenge', id).then(function (res) {
        if (res.ok === false) { return; }
        if (res.challenges) { S.challenges = res.challenges; }
        if (res.progress) { S.progress = res.progress; }
        refreshStrip();
        refreshTopbar();
        if (res.xp_gained > 0) { flyXp(res.xp_gained); }
      });
    },
    finish: function () {
      if (UI.rec !== 'ready') { return; }
      if (!S.session.replies) {
        confirmModal('Terminer la séance ?', 'Tu n\'as encore rien dit : il n\'y aura pas de bilan pour cette séance.', 'Terminer', 'quit-yes');
        return;
      }
      requestFeedback();
    },
    regen: function () { requestFeedback(); },
    quit: function () {
      if (!S.session.replies) { goHome(); return; }
      confirmModal('Quitter sans bilan ?', 'La conversation est enregistrée, mais tu ne recevras ni bilan ni défis pour cette séance.', 'Quitter', 'quit-yes');
    },
    'quit-yes': function () { closeModal(); goHome(); },
    'back-bilan': function () { show('bilan'); },
    review: function () { show('conversation'); },
    home: function () { goHome(); },
    'next-session': function (el) {
      el.disabled = true;
      call('end_session').then(function (res) {
        if (!applyState(res)) { el.disabled = false; return; }
        if (!S.setup.ready) { resetSessionUi(); route(); return; }
        startSession(S.has_briefing);
      });
    },
    'open-feedback': function () { call('open_feedback_file'); },
    'open-logs': function () { call('open_logs_folder'); },
    provider: function (el) {
      readDraft();
      UI.draft.api = el.getAttribute('data-val');
      // Swap in the provider's usual address unless the user typed their own.
      if (isDefaultUrl(UI.draft.base_url)) { UI.draft.base_url = providerUrl(UI.draft.api); }
      refreshSettingsBody();
    },
    'pick-model': function (el) {
      var input = $('#set-model');
      if (input) { input.value = el.getAttribute('data-val'); input.focus(); }
    },
    'save-settings': function () { saveSettings(); },
    'check-update': function (el) {
      el.disabled = true;
      call('check_update').then(function (res) {
        el.disabled = false;
        if (res.ok === false) { return; }
        S.update = res.update || null;
        refreshUpdateBanner();
        if (S.update) { toast('Version ' + S.update.version + ' disponible : tu peux la lancer depuis l\'accueil.', 'ok', 5000); }
        else { toast('Tu as déjà la dernière version.', 'ok'); }
      });
    },
    update: function () {
      UI.updateBusy = { pct: null, label: 'Préparation de la mise à jour…' };
      refreshUpdateBanner();
      call('install_update').then(function (res) {
        if (res.ok === false) { UI.updateBusy = null; refreshUpdateBanner(); }
      });
    }
  };

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-act')) { break; }
      el = el.parentNode;
    }
    if (!el || el === document.body || !el.getAttribute) { return; }
    if (el.disabled) { return; }
    var fn = ACT[el.getAttribute('data-act')];
    if (fn) { fn(el, ev); }
  });

  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.id === 'followup') { UI.followup = ev.target.checked; }
  });

  document.addEventListener('keydown', function (ev) {
    var key = ev.key;
    var tag = ev.target && ev.target.tagName;
    if (UI.modal) {
      if (key === 'Escape') { ev.preventDefault(); closeModal(); }
      else if (key === 'Tab') {
        var focusables = $all('#modal-root button:not([disabled]), #modal-root input, #modal-root select');
        if (!focusables.length) { return; }
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      } else if (key === 'Enter' && UI.modal.kind === 'settings' && tag === 'INPUT') {
        ev.preventDefault();
        saveSettings();
      }
      return;
    }
    if (UI.view === 'conversation') {
      if (key === 'Escape' && UI.rec === 'rec') { ev.preventDefault(); cancelTalk(); return; }
      if (key === 'Enter') {
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { return; }
        if (tag === 'BUTTON' && ev.target.id !== 'talk') { return; }
        ev.preventDefault();
        if (!ev.repeat) { toggleTalk(); }
      }
    } else if (UI.view === 'home' && key === 'Enter' && (!tag || tag === 'BODY')) {
      var b = $('#start-btn');
      if (b && !b.disabled) { ev.preventDefault(); b.click(); }
    } else if (UI.view === 'lesson') {
      lessonKey(ev, key, tag);
    } else if (UI.view === 'meet') {
      if (key === 'Escape' && UI.rec === 'rec') { ev.preventDefault(); practiceCancel(); return; }
      if (key === 'Enter' && UI.meet && UI.meet.step === 'questions') {
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { return; }
        if (tag === 'BUTTON' && ev.target.id !== 'talk' && ev.target.id !== 'meet-main') { return; }
        ev.preventDefault();
        if (ev.repeat) { return; }
        if (UI.meet.heard) { meetAnswer(UI.meet.heard); } else { meetTalk(); }
      }
    }
  });

  function lessonKey(ev, key, tag) {
    if (UI.lessonLoading) { return; }
    if (UI.lessonEnd) {
      if (key === 'Enter' && (!tag || tag === 'BODY' || ev.target.id === 'start-btn')) {
        var go = $('#start-btn');
        if (go && !go.disabled && !ev.repeat) { ev.preventDefault(); go.click(); }
      }
      return;
    }
    var L = UI.lesson;
    if (!L || UI.lessonFinishing) { return; }
    var item = lessonItem();
    var x = L.x;
    if (!item || !x) { return; }
    if (key === 'Escape' && UI.rec === 'rec') { ev.preventDefault(); practiceCancel(); return; }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') { return; }
    if ((item.kind === 'choice' || item.kind === 'listen') && x.phase === 'answer' && /^[1-9]$/.test(key)) {
      var n = parseInt(key, 10) - 1;
      if (n < item.options.length) { ev.preventDefault(); x.sel = n; refreshLesson(true); }
      return;
    }
    if (key === 'Backspace' && item.kind === 'order' && x.phase === 'answer' && x.built.length) {
      ev.preventDefault();
      x.built.pop();
      refreshLesson(false);
      return;
    }
    if (key !== 'Enter') { return; }
    if (tag === 'BUTTON' && ev.target.id !== 'talk' && ev.target.id !== 'lesson-main') { return; }
    ev.preventDefault();
    if (ev.repeat) { return; }
    if (item.kind === 'speak' && x.phase === 'answer') { lessonTalk(); return; }
    var main = $('#lesson-main');
    if (main && !main.disabled) { main.click(); }
  }

  // ------------------------------------------------------------------
  // Events pushed by the backend
  // ------------------------------------------------------------------

  function onEvent(evt) {
    if (typeof evt === 'string') {
      try { evt = JSON.parse(evt); } catch (e) { return; }
    }
    if (!evt || !evt.type || !S) { return; }
    switch (evt.type) {
      case 'level':
        setMeter(evt.value);
        break;
      case 'transcribing':
        if (UI.rec !== 'transcribing') { setRec('transcribing'); }
        break;
      case 'no_speech':
        setRec('ready');
        toast('Je n\'ai rien entendu. Réessaie en parlant un peu plus près du micro.', 'soft', 4200);
        break;
      case 'user_turn':
        if (evt.session) { S.session = evt.session; }
        if (evt.progress) { S.progress = evt.progress; }
        if (UI.view === 'conversation') {
          appendRow(rowHtml({ role: 'user', text: evt.text }));
          refreshStrip();
          refreshTopbar();
          flyXp(evt.xp_gained);
        }
        UI.typing = true;
        setRec('thinking');
        if (UI.view === 'conversation') { appendRow(typingHtml()); }
        break;
      case 'thinking':
        if (!UI.typing) {
          UI.typing = true;
          setRec('thinking');
          if (UI.view === 'conversation') { appendRow(typingHtml()); }
        }
        break;
      case 'tutor_turn':
        UI.typing = false;
        if (evt.session) { S.session = evt.session; }
        if (UI.view === 'conversation') { appendRow(rowHtml({ role: 'tutor', text: evt.text })); }
        setRec('ready');
        break;
      case 'feedback_started':
        UI.feedbackLoading = true;
        if (UI.view !== 'bilan') { show('bilan'); }
        break;
      case 'feedback':
        UI.feedbackLoading = false;
        UI.feedback = evt;
        if (evt.session) { S.session = evt.session; }
        if (evt.progress) { S.progress = evt.progress; }
        if (evt.challenges) { S.challenges = evt.challenges; }
        UI.fbReplies = S.session ? S.session.replies : 0;
        show('bilan');
        afterBilanShown(true);
        break;
      case 'error':
        toast(evt.message || 'Une erreur est survenue.', 'error');
        UI.typing = false;
        if (UI.feedbackLoading) {
          UI.feedbackLoading = false;
          show(UI.feedback ? 'bilan' : 'conversation');
        } else if (UI.view === 'conversation') {
          var t = $('#typing');
          if (t) { t.parentNode.removeChild(t); markLastTutor(); }
          if (UI.rec !== 'ready') { setRec('ready'); }
        }
        break;
      case 'setup_progress':
        UI.setupBusy[evt.step] = { pct: typeof evt.pct === 'number' ? evt.pct : null, label: evt.label };
        if (evt.step === 'download_voice') { refreshVoiceCard(); break; }
        updateSetupProgress(evt.step);
        break;
      case 'setup_done':
        delete UI.setupBusy[evt.step];
        if (evt.ok === false) { toast(evt.error || 'Cette étape a échoué.', 'error'); }
        if (evt.step === 'download_voice') {
          call('recheck_setup').then(function (res) {
            if (!applyState(res)) { refreshVoiceCard(); return; }
            if (S.voice) { toast('Ton tuteur a trouvé sa voix !', 'ok'); }
            refreshVoiceCard();
          });
          break;
        }
        call('recheck_setup').then(function (res) {
          if (!applyState(res)) { refreshSetup(); return; }
          if (UI.view !== 'setup') { return; }
          if (S.setup.ready) { toast('Tout est prêt !', 'ok'); confetti(24); route(); }
          else { refreshSetup(); }
        });
        break;
      case 'update_progress':
        UI.updateBusy = { pct: typeof evt.pct === 'number' ? evt.pct : null, label: evt.label };
        refreshUpdateBanner();
        break;
      case 'update_available':
        S.update = { version: evt.version, notes: evt.notes };
        refreshUpdateBanner();
        break;
      case 'update_error':
        UI.updateBusy = null;
        refreshUpdateBanner();
        toast(evt.message || 'La mise à jour a échoué.', 'error');
        break;
      default:
        break;
    }
  }

  window.LT = { onEvent: onEvent };

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  var booted = false;

  function boot(api, demo) {
    if (booted) { return; }
    booted = true;
    API = api;
    UI.demo = !!demo;
    call('get_state').then(function (res) {
      if (applyState(res)) { route(); return; }
      $('#app').innerHTML = '<div class="boot" role="alert"><span>Impossible de démarrer l\'application.</span>' +
        '<button type="button" class="btn btn-primary" onclick="location.reload()">Réessayer</button></div>';
    });
  }

  function realApiReady() { return !!(window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_state === 'function'); }

  window.addEventListener('pywebviewready', function () { boot(window.pywebview.api, false); });
  if (realApiReady()) { boot(window.pywebview.api, false); }
  setTimeout(function () {
    if (booted) { return; }
    if (realApiReady()) { boot(window.pywebview.api, false); return; }
    if (!window.pywebview) { boot(createDemoApi(), true); }
  }, 800);

  // ==================================================================
  // DEMO API — only used when the page is opened without the backend.
  // Same methods and events as the real one, with fake data and delays.
  // Options: ?ready=1 (skip setup), ?level=N (game level) or ?level=none (first-use
  // flow), ?voice=1 (tutor voice = a beep), ?gen=1 (lesson marked as generated),
  // ?review=N (points to review), ?done=1 (path finished), ?update=1, ?chest=0..4,
  // ?nobriefing=1 (bilan without briefing), ?nospeech=1 (first take is silent)
  // ==================================================================

  function createDemoApi() {
    var params = {};
    (location.search || '').replace(/^\?/, '').split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) { params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }
    });

    var LANGS = [
      { code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }, { code: 'es', name: 'Español' },
      { code: 'de', name: 'Deutsch' }, { code: 'it', name: 'Italiano' }, { code: 'pt', name: 'Português' }
    ];
    var ready = params.ready === '1';
    var startLevel = parseInt(params.level, 10) || 3;

    function floorXp(level) { return 50 * (level - 1) * level; }
    function levelOf(xp) { var l = 1; while (floorXp(l + 1) <= xp) { l++; } return l; }

    var db = {
      language: 'en',
      voice: params.voice === '1',
      settings: { api: 'ollama', base_url: 'http://127.0.0.1:11434/v1', api_key_set: false, model: 'llama3.1:8b', whisper_model: 'small', high_quality: false, mic: null, goal: 5 },
      setup: { ollama_installed: ready, ollama_running: ready, model_ok: ready, whisper_bin_ok: true, whisper_model_ok: ready, mic_ok: true, platform: 'windows', needs_ollama: true },
      xp: floorXp(startLevel) + 40,
      streak: 4,
      sessions_done: 3,
      chest_count: params.chest !== undefined ? clamp(parseInt(params.chest, 10) || 0, 0, 4) : 3,
      chest_every: 5,
      challenges: [
        { id: 'c1', text: 'Tell a story in the past tense.', done: false },
        { id: 'c2', text: 'Ask your tutor two questions.', done: false }
      ],
      has_briefing: true,
      session: null,
      sessionXp: 0,
      update: params.update === '1' ? { version: '1.1.0', notes: 'Corrections et nouveaux badges.' } : null
    };

    var USER_LINES = [
      'Hello! Yesterday I go to the cinema with my sister.',
      'We saw a science fiction movie. It was very long but I liked the end.',
      'The hero come back to his family after a long travel in the space.',
      'Yes, I think I will see it again with my friends.',
      'I prefer comedies, because I like to laugh after work.'
    ];
    var TUTOR_LINES = [
      'How was the movie? What did you see?',
      'Long movies can be worth it when the ending pays off. What happened at the end — without spoiling too much?',
      'That sounds like a touching ending! Would you watch it a second time?',
      'Nice. Do you usually prefer science fiction, or another kind of film?',
      'Comedies are perfect for that. Which one made you laugh the most recently?'
    ];
    var FEEDBACK_MD = [
      '## Overall assessment',
      'You communicate your ideas clearly and you keep the conversation going. The main thing to work on is the **past tense** when you tell a story.',
      '',
      '**What was done well**',
      '- You answered follow-up questions with details instead of one-word replies.',
      '- Good use of "but" to contrast two ideas: *very long but I liked the end*.',
      '',
      '3. Mistakes and corrections',
      '> "Yesterday I go to the cinema with my sister."',
      'Corrected: "Yesterday I **went** to the cinema with my sister."',
      '"Yesterday" places the action in the past, so the verb takes the past simple: `go` → `went`.',
      '',
      '## More natural English',
      '"I liked the end" is understandable; for films and books, "the ending" sounds more natural. Try saying these out loud:',
      '1. "I really liked the ending."',
      '2. "I didn\'t expect that ending at all."',
      '3. "The ending made the whole movie worth it."',
      '',
      '### Vocabulary',
      '- **the plot** — the story of a film or a book',
      '- **worth it** — good enough to justify the time or effort',
      '- **sci-fi** — the everyday word for science fiction',
      '',
      '## Priority for improvement',
      '1. Retell your cinema story while keeping every verb in the past tense.',
      '2. Use "the ending" when you talk about films and books.',
      '',
      '<script>window.__xss = 1</script> <img src=x onerror="window.__xss=1">'
    ].join('\n');

    var recTimer = null;

    function emit(evt) { setTimeout(function () { window.LT.onEvent(evt); }, 0); }
    function later(ms, fn) { return setTimeout(fn, ms); }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    function reply(obj, ms) {
      return new Promise(function (resolve) { setTimeout(function () { resolve(copy(obj)); }, ms == null ? 120 : ms); });
    }

    function progress() {
      var level = levelOf(db.xp);
      return { xp: db.xp, level: level, level_floor_xp: floorXp(level), level_next_xp: floorXp(level + 1), streak: db.streak, sessions_done: db.sessions_done, chest_count: db.chest_count, chest_every: db.chest_every };
    }

    function setup() {
      var s = copy(db.setup);
      s.needs_ollama = db.settings.api === 'ollama';
      s.ready = (!s.needs_ollama || (s.ollama_installed && s.ollama_running)) && s.model_ok && s.whisper_bin_ok && s.whisper_model_ok && s.mic_ok;
      return s;
    }

    function state() {
      return {
        ok: true, version: '1.0.0', language: db.language, languages: LANGS, settings: db.settings, setup: setup(),
        progress: progress(), next_session_number: db.sessions_done + 1, challenges: db.challenges,
        has_briefing: db.has_briefing, session: db.session, update: db.update,
        levels: LEVELS, level: db.levels[db.language] || null, path: pathState(), voice: db.voice, voice_offer: { supported: true, megabytes: db.voice ? 0 : 86 }
      };
    }

    // --- Lessons (demo) ----------------------------------------------------

    var LEVELS = [
      { code: 'A1', name: 'Débutant', hint: 'Je connais quelques mots, ou rien du tout.' },
      { code: 'A2', name: 'Élémentaire', hint: 'Je me débrouille avec des phrases simples.' },
      { code: 'B1', name: 'Intermédiaire', hint: 'Je tiens une conversation, avec des erreurs.' },
      { code: 'B2', name: 'Avancé', hint: 'Je parle avec aisance et je veux gagner en précision.' }
    ];
    var UNIT_TITLES = {
      A1: ['Se présenter', 'La famille et les proches', 'Le quotidien', 'Manger et boire', 'Poser des questions', 'Chez soi'],
      A2: ['Raconter au passé', 'Faire des projets', 'Comparer', 'Au restaurant et en courses', 'Donner des conseils', 'Habitudes passées'],
      B1: ['Expériences de vie', 'Si… alors', 'Donner son avis', 'Rapporter des paroles', 'Décrire précisément', 'La voix passive'],
      B2: ['Nuancer', 'Regrets et hypothèses', 'Convaincre', 'Expressions idiomatiques', 'Registres', 'Raconter avec style']
    };
    var KINDS = ['vocab', 'grammar', 'pron'];
    var KIND_NAMES = { vocab: 'Vocabulaire', grammar: 'Grammaire', pron: 'Prononciation' };
    db.levels = { en: params.level === 'none' ? null : 'A2' };
    // stars per language, unit and kind
    db.stars = { en: { 'A2-1': { vocab: 3, grammar: 2, pron: 0 } } };
    if (params.done === '1') {
      db.stars.en = {};
      UNIT_TITLES.A2.forEach(function (t, i) { db.stars.en['A2-' + (i + 1)] = { vocab: 3, grammar: 2, pron: 3 }; });
    }
    db.review_due = params.review !== undefined ? (parseInt(params.review, 10) || 0) : 3;
    var activeLesson = null;
    var speakTries = {};
    var practiceTimer = null;
    var chatAnswers = 0;

    function pathState() {
      var code = db.levels[db.language];
      if (!code) { return null; }
      var stars = db.stars[db.language] || {};
      var units = [];
      var current = null;
      UNIT_TITLES[code].forEach(function (title, i) {
        var id = code + '-' + (i + 1);
        var s = stars[id] || {};
        var lessons = { vocab: s.vocab || 0, grammar: s.grammar || 0, pron: s.pron || 0 };
        var done = !!(lessons.vocab && lessons.grammar && lessons.pron);
        var entry = { id: id, number: i + 1, title: title, lessons: lessons, done: done, current: false, locked: current !== null };
        if (!done && current === null) { current = entry; entry.current = true; }
        units.push(entry);
      });
      var rec;
      if (db.review_due >= 6) { rec = { kind: 'review', unit_id: null, label: 'Révision' }; }
      else if (current) {
        var kind = KINDS.filter(function (k) { return !current.lessons[k]; })[0];
        rec = { kind: kind, unit_id: current.id, label: KIND_NAMES[kind] + ' · ' + current.title };
      } else { rec = { kind: 'conversation', unit_id: null, label: 'Conversation libre' }; }
      var pos = ['A1', 'A2', 'B1', 'B2'].indexOf(code);
      return {
        level: code, level_name: LEVELS[pos].name, units: units, recommended: rec, review_due: db.review_due,
        level_complete: current === null, next_level: current === null && pos < 3 ? LEVELS[pos + 1].code : null
      };
    }

    function shuffled(list) {
      var a = list.slice();
      for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    function choice(prompt, sentence, options, right, explanation) {
      var o = shuffled(options);
      return { kind: 'choice', prompt: prompt, sentence: sentence, options: o, answer: o.indexOf(right), explanation: explanation || '' };
    }
    function listen(options, right) {
      var o = shuffled(options);
      return { kind: 'listen', prompt: 'Écoute et choisis ce que tu entends.', audio_text: right, options: o, answer: o.indexOf(right) };
    }
    function order(sentence, translation) {
      var t = sentence.split(' ');
      var m = shuffled(t);
      if (m.join(' ') === sentence) { m = t.slice(1).concat(t.slice(0, 1)); }
      return { kind: 'order', prompt: 'Remets les mots dans l\'ordre.', translation: translation, sentence: sentence, tokens: m };
    }
    function speakEx(text, translation) {
      return { kind: 'speak', prompt: db.voice ? 'Écoute, puis répète à voix haute.' : 'Lis à voix haute.', text: text, translation: translation };
    }

    function demoLesson(kind) {
      var voice = db.voice;
      var items;
      var title;
      if (kind === 'vocab') {
        title = 'Vocabulaire · Raconter au passé';
        items = [
          { kind: 'info', title: 'Les mots du jour', text: voice ? 'Écoute chaque mot, puis on s\'entraîne.' : 'Lis chaque mot, puis on s\'entraîne.', examples: [
            { text: 'the weekend', translation: 'le week-end' }, { text: 'to relax', translation: 'se détendre' },
            { text: 'a hike', translation: 'une randonnée' }, { text: 'a museum', translation: 'un musée' },
            { text: 'to visit', translation: 'rendre visite, visiter' }, { text: 'a party', translation: 'une fête' }] },
          choice('Que veut dire ce mot ?', 'a hike', ['une randonnée', 'un musée', 'une fête'], 'une randonnée'),
          choice('Que veut dire ce mot ?', 'to relax', ['se détendre', 'rendre visite, visiter', 'le week-end'], 'se détendre'),
          listen(['a party', 'a hike', 'a museum'], 'a party'),
          order('We visited a museum on Saturday.', 'Nous avons visité un musée samedi.'),
          order('I relaxed at home last weekend.', 'Je me suis détendu à la maison le week-end dernier.'),
          speakEx('a museum', 'un musée'),
          speakEx('We went on a hike yesterday.', 'Nous avons fait une randonnée hier.')
        ];
      } else if (kind === 'grammar') {
        title = 'Grammaire · Raconter au passé';
        items = [
          { kind: 'info', title: 'La règle', text: 'Pour une action terminée dans le passé, l\'anglais utilise le prétérit (past simple).\nPour les verbes réguliers, on ajoute -ed : play → played.\nBeaucoup de verbes courants sont irréguliers : go → went, see → saw, eat → ate.', examples: [
            { text: 'I watched a film last night.', translation: 'J\'ai regardé un film hier soir.' },
            { text: 'She went to London in May.', translation: 'Elle est allée à Londres en mai.' },
            { text: 'We ate pizza on Friday.', translation: 'Nous avons mangé une pizza vendredi.' }] },
          choice('Complète la phrase.', 'Yesterday I ___ to the cinema with my sister.', ['go', 'went', 'gone'], 'went', '« Yesterday » situe l\'action dans le passé : go devient went.'),
          choice('Complète la phrase.', 'We ___ a great film last weekend.', ['see', 'saw', 'seen'], 'saw', 'See est irrégulier : son prétérit est saw.'),
          choice('Complète la phrase.', 'She ___ tennis on Saturday.', ['played', 'plays', 'playing'], 'played', 'Verbe régulier : on ajoute -ed.'),
          order('They visited their friends last night.', 'Ils ont rendu visite à leurs amis hier soir.'),
          speakEx('I went to the park on Sunday.', 'Je suis allé au parc dimanche.')
        ];
      } else if (kind === 'pron') {
        title = 'Prononciation · la terminaison -ed';
        items = [
          { kind: 'info', title: 'La terminaison -ed', text: 'Le -ed du passé ne se prononce presque jamais « èd ».\nAprès un son sourd (k, p, s, ch), il se dit « t » : walked. Après un son sonore, il se dit « d » : played.\nIl ne forme une syllabe « id » qu\'après t ou d : wanted, needed.', examples: [
            { text: 'walked', translation: 'a marché' }, { text: 'played', translation: 'a joué' }, { text: 'wanted', translation: 'a voulu' }] }
        ];
        if (voice) { items.push(listen(['walk', 'walked'], 'walked')); }
        items.push(speakEx('walked', 'a marché'), speakEx('wanted', 'a voulu'), speakEx('We played and then we walked home.', 'Nous avons joué puis nous sommes rentrés à pied.'));
      } else {
        title = 'Révision · tes points à consolider';
        items = [
          choice('Complète la phrase.', 'Last summer we ___ to Spain.', ['go', 'went', 'gone'], 'went', 'Action terminée dans le passé : went.'),
          order('I saw a good film yesterday.', 'J\'ai vu un bon film hier.'),
          speakEx('I visited my grandparents.', 'J\'ai rendu visite à mes grands-parents.')
        ];
        if (voice) { items.splice(1, 0, listen(['thin', 'tin'], 'thin')); }
      }
      if (!voice) { items = items.filter(function (it) { return it.kind !== 'listen'; }); }
      items.forEach(function (it, i) { it.index = i; });
      return { id: 'demo-' + Date.now(), kind: kind, unit_id: null, title: title, source: params.gen === '1' ? 'generated' : 'bundled', items: items };
    }

    // Short beep as a WAV data URL, standing in for the tutor's voice.
    function beep() {
      var rate = 8000;
      var n = Math.floor(rate * 0.28);
      var bytes = new Uint8Array(44 + n);
      var view = new DataView(bytes.buffer);
      var put = function (off, s) { for (var i = 0; i < s.length; i++) { bytes[off + i] = s.charCodeAt(i); } };
      put(0, 'RIFF'); view.setUint32(4, 36 + n, true); put(8, 'WAVEfmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
      put(36, 'data'); view.setUint32(40, n, true);
      for (var i = 0; i < n; i++) {
        var fade = Math.min(1, i / 200, (n - i) / 400);
        bytes[44 + i] = 128 + Math.round(60 * fade * Math.sin(2 * Math.PI * 520 * i / rate));
      }
      var bin = '';
      for (var k = 0; k < bytes.length; k++) { bin += String.fromCharCode(bytes[k]); }
      return 'data:audio/wav;base64,' + btoa(bin);
    }

    var CHAT_ANSWERS = [
      'My name is Paul and I live in Lyon.',
      'Last weekend I go to the cinema with my sister and we eat a pizza.',
      'I think I would change the traffic because there is too much cars.'
    ];

    function simulate(step, label, seconds, done) {
      var t = 0;
      var total = seconds * 10;
      var timer = setInterval(function () {
        t++;
        emit({ type: 'setup_progress', step: step, pct: step === 'start_ollama' ? null : Math.round((t / total) * 100), label: label });
        if (t >= total) {
          clearInterval(timer);
          done();
          emit({ type: 'setup_done', step: step, ok: true });
        }
      }, 100);
    }

    return {
      get_state: function () { return reply(state(), 250); },
      set_language: function (code) {
        db.language = code;
        var en = code === 'en';
        db.has_briefing = en;
        db.challenges = en ? [
          { id: 'c1', text: 'Tell a story in the past tense.', done: false },
          { id: 'c2', text: 'Ask your tutor two questions.', done: false }
        ] : [];
        return reply(state());
      },
      save_settings: function (obj) {
        for (var k in obj) {
          if (!Object.prototype.hasOwnProperty.call(obj, k)) { continue; }
          if (k === 'api_key') { db.settings.api_key_set = !!obj[k]; }
          else { db.settings[k] = obj[k]; }
        }
        if (db.session) { db.session.goal = db.settings.goal; }
        return reply(state(), 300);
      },
      list_mics: function () {
        return reply({ ok: true, mics: [
          { id: '1', name: 'Microphone (C922 Pro Stream Webcam)', 'default': false },
          { id: '2', name: 'INPUT (Volt 176)', 'default': true },
          { id: '3', name: 'Microphone (NVIDIA Broadcast)', 'default': false }
        ] }, 200);
      },
      list_models: function () { return reply({ ok: true, models: ['llama3.1:8b', 'llama3.2:3b'] }, 200); },
      recheck_setup: function () { return reply(state(), 400); },
      setup_action: function (step) {
        if (step === 'install_ollama') { simulate(step, 'Téléchargement d\'Ollama…', 3, function () { db.setup.ollama_installed = true; db.setup.ollama_running = true; }); }
        else if (step === 'start_ollama') { simulate(step, 'Démarrage d\'Ollama…', 1.5, function () { db.setup.ollama_running = true; }); }
        else if (step === 'pull_model') { simulate(step, 'Téléchargement de ' + db.settings.model + '…', 4, function () { db.setup.model_ok = true; }); }
        else if (step === 'download_whisper_bin') { simulate(step, 'Installation de Whisper…', 2, function () { db.setup.whisper_bin_ok = true; }); }
        else if (step === 'download_voice') { simulate(step, 'Téléchargement de la voix du tuteur…', 3, function () { db.voice = true; }); }
        else if (step === 'download_whisper_model') { simulate(step, 'Téléchargement du modèle ' + db.settings.whisper_model + '…', 3, function () { db.setup.whisper_model_ok = true; }); }
        else { return reply({ ok: false, error: 'Étape inconnue : ' + step }); }
        return reply({ ok: true });
      },
      start_session: function (followup) {
        db.session = { number: db.sessions_done + 1, followup: !!followup, replies: 0, goal: db.settings.goal, turns: [], feedback_done: false };
        db.sessionXp = 0;
        return reply({ ok: true, session: db.session }, 400);
      },
      start_recording: function () {
        if (!db.session) { return reply({ ok: false, error: 'Aucune séance en cours.' }); }
        clearInterval(recTimer);
        recTimer = setInterval(function () { emit({ type: 'level', value: 0.15 + Math.random() * 0.8 }); }, 70);
        return reply({ ok: true }, 250);
      },
      cancel_recording: function () { clearInterval(recTimer); return reply({ ok: true }); },
      stop_recording: function () {
        clearInterval(recTimer);
        var ses = db.session;
        emit({ type: 'transcribing' });
        later(1100, function () {
          if (params.nospeech === '1' && ses.replies === 0 && !ses._tried) {
            ses._tried = true;
            emit({ type: 'no_speech' });
            return;
          }
          var idx = ses.replies % USER_LINES.length;
          ses.turns.push({ role: 'user', text: USER_LINES[idx] });
          ses.replies++;
          db.xp += 10;
          db.sessionXp += 10;
          emit({ type: 'user_turn', text: USER_LINES[idx], xp_gained: 10, progress: progress(), session: copy(ses) });
          emit({ type: 'thinking' });
          later(1700, function () {
            ses.turns.push({ role: 'tutor', text: TUTOR_LINES[idx] });
            emit({ type: 'tutor_turn', text: TUTOR_LINES[idx], seconds: 1.7, session: copy(ses) });
          });
        });
        return reply({ ok: true }, 60);
      },
      toggle_challenge: function (id) {
        var gained = 0;
        db.challenges.forEach(function (c) {
          if (c.id === id) {
            c.done = !c.done;
            gained = c.done ? 50 : -50;
          }
        });
        db.xp = Math.max(0, db.xp + gained);
        db.sessionXp += gained;
        return reply({ ok: true, challenges: db.challenges, progress: progress(), xp_gained: gained });
      },
      request_feedback: function () {
        var ses = db.session;
        if (!ses) { return reply({ ok: false, error: 'Aucune séance en cours.' }); }
        emit({ type: 'feedback_started' });
        later(2600, function () {
          var before = levelOf(db.xp);
          var first = !ses.feedback_done;
          var opened = false;
          if (first) {
            db.xp += 50;
            db.sessionXp += 50;
            db.sessions_done++;
            db.streak++;
            db.chest_count++;
            if (db.chest_count >= db.chest_every) { opened = true; db.xp += 100; }
          }
          ses.feedback_done = true;
          db.has_briefing = params.nobriefing !== '1';
          db.challenges = [
            { id: 'n1', text: 'Retell your cinema story while keeping every verb in the past tense.', done: false },
            { id: 'n2', text: 'Use "the ending" when you talk about films and books.', done: false }
          ];
          var after = levelOf(db.xp);
          var shownChest = db.chest_count;
          if (opened) { db.chest_count = 0; }
          emit({
            type: 'feedback', markdown: FEEDBACK_MD, briefing_saved: params.nobriefing !== '1', challenges: copy(db.challenges),
            rewards: { xp_gained: db.sessionXp, streak: db.streak, level: after, leveled_up: after > before, chest_opened: opened, chest_count: opened ? db.chest_every : shownChest },
            progress: progress(), session: copy(ses)
          });
        });
        return reply({ ok: true }, 60);
      },
      end_session: function () { db.session = null; return reply(state(), 200); },
      starter_questions: function () {
        chatAnswers = 0;
        return reply({ ok: true, questions: [
          { id: 0, text: 'What is your name, and where do you live?', translation: 'Comment tu t\'appelles, et où habites-tu ?' },
          { id: 1, text: 'What did you do last weekend?', translation: 'Qu\'est-ce que tu as fait le week-end dernier ?' },
          { id: 2, text: 'If you could change one thing about your city, what would it be, and why?', translation: 'Si tu pouvais changer une chose dans ta ville, ce serait quoi, et pourquoi ?' }
        ] }, 500);
      },
      practice_record_start: function () {
        clearInterval(practiceTimer);
        practiceTimer = setInterval(function () { emit({ type: 'level', value: 0.15 + Math.random() * 0.8 }); }, 70);
        return reply({ ok: true }, 250);
      },
      practice_record_cancel: function () { clearInterval(practiceTimer); return reply({ ok: true }); },
      practice_record_stop: function (target) {
        clearInterval(practiceTimer);
        if (!target) {
          var heard = CHAT_ANSWERS[chatAnswers % CHAT_ANSWERS.length];
          chatAnswers++;
          return reply({ ok: true, heard: heard }, 1100);
        }
        var words = String(target).split(' ');
        speakTries[target] = (speakTries[target] || 0) + 1;
        // Sentences are missed once (to show the retry), single words pass.
        var miss = words.length > 3 && speakTries[target] === 1;
        var out = words.map(function (w, i) {
          var status = 'ok';
          if (miss && i === 1) { status = 'miss'; }
          else if (miss && i === words.length - 1) { status = 'weak'; }
          return { word: w, status: status };
        });
        var points = out.reduce(function (sum, w) { return sum + (w.status === 'ok' ? 1 : (w.status === 'weak' ? 0.5 : 0)); }, 0);
        var score = Math.round((points / out.length) * 100) / 100;
        var said = miss ? words.map(function (w, i) { return i === 1 ? 'go' : w; }).join(' ') : target;
        return reply({ ok: true, heard: said, words: out, score: score, passed: score >= 0.8 }, 1100);
      },
      assess_level: function (answers) {
        var spoken = (answers || []).filter(function (a) { return a.transcript; }).length;
        var level = spoken >= 3 ? 'A2' : (spoken === 2 ? 'A2' : 'A1');
        var reason = spoken >= 2 ? 'Tu te présentes facilement et tu racontes déjà ce que tu as fait : on va consolider le passé ensemble.'
          : 'On part des bases, tranquillement : tu vas vite prendre confiance.';
        return reply({ ok: true, level: level, reason: reason }, 2200);
      },
      set_level: function (code) {
        db.levels[db.language] = code;
        return reply(state(), 300);
      },
      get_lesson: function (kind) {
        if (kind === 'review' && db.review_due <= 0) { return reply({ ok: false, error: 'Rien à réviser pour l\'instant.' }, 300); }
        activeLesson = demoLesson(kind);
        activeLesson.unit_id = arguments[1] || null;
        return reply({ ok: true, lesson: activeLesson }, params.gen === '1' ? 2600 : 700);
      },
      speak: function () { return reply({ ok: true, audio: beep() }, 150); },
      finish_lesson: function (lessonId, results) {
        var lesson = activeLesson;
        if (!lesson || lesson.id !== lessonId) { return reply({ ok: false, error: 'Cette leçon n\'est plus en cours.' }); }
        activeLesson = null;
        var total = results.length;
        var first = results.filter(function (r) { return r.correct && r.tries <= 1; }).length;
        var solved = results.filter(function (r) { return r.correct; }).length;
        var ratio = total ? first / total : 1;
        var stars = ratio >= 0.9 ? 3 : (ratio >= 0.7 ? 2 : 1);
        var gained = solved * 5 + 20 + (stars === 3 ? 10 : 0);
        var before = levelOf(db.xp);
        db.xp += gained;
        if (lesson.kind === 'review') { db.review_due = Math.max(0, db.review_due - total); }
        else {
          db.review_due += total - first;
          var code = db.levels[db.language];
          var path = pathState();
          var unitId = lesson.unit_id;
          if (!unitId && path) {
            path.units.forEach(function (u) { if (u.current) { unitId = u.id; } });
          }
          if (unitId && code) {
            db.stars[db.language] = db.stars[db.language] || {};
            var s = db.stars[db.language][unitId] = db.stars[db.language][unitId] || {};
            s[lesson.kind] = Math.max(s[lesson.kind] || 0, stars);
          }
        }
        return reply({ ok: true, stars: stars, xp_gained: gained, correct: first, total: total, leveled_up: levelOf(db.xp) > before, progress: progress(), path: pathState() }, 500);
      },
      open_logs_folder: function () { toast('(Démo) Le dossier des séances s\'ouvrirait ici.', 'soft'); return reply({ ok: true }); },
      open_feedback_file: function () { toast('(Démo) Le fichier du bilan s\'ouvrirait ici.', 'soft'); return reply({ ok: true }); },
      check_update: function () { return reply({ ok: true, update: db.update }, 700); },
      install_update: function () {
        var t = 0;
        var timer = setInterval(function () {
          t += 4;
          emit({ type: 'update_progress', pct: Math.min(100, t), label: 'Téléchargement de la version ' + db.update.version + '…' });
          if (t >= 100) {
            clearInterval(timer);
            emit({ type: 'update_error', message: '(Démo) La mise à jour s\'installerait puis l\'appli redémarrerait.' });
          }
        }, 80);
        return reply({ ok: true });
      }
    };
  }
})();
