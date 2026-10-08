/*
 * Page wiring: renders the controls, keeps state in the URL so picks can be shared,
 * and redraws the results whenever something changes.
 */
(function () {
  "use strict";

  const DATA = window.RPG_DATA;
  const Engine = window.RPGRecommend;
  const index = Engine.buildIndex(DATA);
  const byId = index.byId;

  const platformByKey = {};
  DATA.platforms.forEach((p) => { platformByKey[p.key] = p; });

  // A handful of games were renamed between regions; the footer toggle flips them
  const NAME_KEY = "which-rpg-names";
  const REGION_NAMES = {};
  DATA.games.forEach((g) => {
    if (g.na || g.eu) REGION_NAMES[g.title] = { na: g.na || g.title, eu: g.eu || g.title };
  });
  let nameMode = "eu";
  try {
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName === "na" || savedName === "eu") nameMode = savedName;
  } catch (err) { /* storage refused; the default stands */ }

  function gameName(g) {
    const names = REGION_NAMES[g.title];
    return names ? names[nameMode] : g.title;
  }
  function nameForTitle(title) {
    const names = REGION_NAMES[title];
    return names ? names[nameMode] : title;
  }

  const LENGTH_OPTIONS = [
    { key: "short", label: "A weekend or two", detail: "under 20 hours" },
    { key: "medium", label: "A few weeks", detail: "20 to 45 hours" },
    { key: "long", label: "A month or more", detail: "45 to 80 hours" },
    { key: "epic", label: "Something to live in", detail: "80 hours or more" },
    { key: "any", label: "I don't mind", detail: "any length" }
  ];

  const FEELS = [
    { key: "loved", label: "Loved it", code: "l" },
    { key: "fine", label: "It was fine", code: "f" },
    { key: "disliked", label: "Not for me", code: "d" }
  ];
  const FEEL_BY_CODE = {};
  const CODE_BY_FEEL = {};
  FEELS.forEach((f) => { FEEL_BY_CODE[f.code] = f.key; CODE_BY_FEEL[f.key] = f.code; });

  const QUICK_IDS = ["witcher3", "skyrim", "elden-ring", "bg3", "p5r", "ff7r", "mass-effect",
    "cyberpunk", "clair-obscur", "dq11", "fe3h", "hogwarts"];

  const ORDINALS = ["Top pick", "Second pick", "Third pick"];
  const GAUGE_MAX = 120;

  const state = { played: [], machines: [], length: "any", moods: [] };

  // ---------- Small helpers ----------

  const $ = (sel) => document.querySelector(sel);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  // "A", "A and B", "A, B, and C" (Oxford comma, always)
  function listJoin(items) {
    if (items.length <= 1) return items.join("");
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function norm(s) {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function shortName(key) { return platformByKey[key] ? platformByKey[key].short : key; }

  let announceTimer = null;
  function announce(msg, delay) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => { $("#announcer").textContent = msg; }, delay || 0);
  }

  // ---------- URL state ----------

  const SAVED_KEY = "which-rpg-state";

  function applyState(encoded) {
    const params = new URLSearchParams(encoded);
    const p = params.get("p");
    if (p) {
      p.split(",").forEach((pair) => {
        const parts = pair.split(".");
        const id = parts[0];
        if (byId[id] && !state.played.some((x) => x.id === id)) {
          state.played.push({ id: id, feel: FEEL_BY_CODE[parts[1]] || "loved" });
        }
      });
    }
    const m = params.get("m");
    if (m) state.machines = m.split(",").filter((k) => platformByKey[k]);
    const t = params.get("t");
    if (t && LENGTH_OPTIONS.some((o) => o.key === t)) state.length = t;
    const v = params.get("v");
    if (v) state.moods = v.split(",").filter((k) => DATA.tags[k] && DATA.tags[k].mood);
  }

  function readHash() {
    applyState(location.hash.slice(1));
  }

  function hasState() {
    return !!(state.played.length || state.machines.length || state.moods.length || state.length !== "any");
  }

  // Built by hand so the commas stay readable rather than turning into %2C
  function encodeState() {
    const parts = [];
    if (state.played.length) parts.push("p=" + state.played.map((x) => x.id + "." + CODE_BY_FEEL[x.feel]).join(","));
    if (state.machines.length) parts.push("m=" + state.machines.join(","));
    if (state.length !== "any") parts.push("t=" + state.length);
    if (state.moods.length) parts.push("v=" + state.moods.join(","));
    return parts.join("&");
  }

  function writeHash() {
    const encoded = encodeState();
    const url = encoded ? "#" + encoded : location.pathname + location.search;
    history.replaceState(null, "", url);
  }

  // Selections are also remembered in localStorage, so a return visit picks up
  // where you left off. Private modes and some file:// setups refuse storage,
  // so the guard matters; the picker works either way.
  function saveState() {
    try {
      const encoded = encodeState();
      if (encoded) localStorage.setItem(SAVED_KEY, encoded);
      else localStorage.removeItem(SAVED_KEY);
    } catch (err) { /* nothing remembered, and nothing breaks */ }
  }

  function restoreSaved() {
    try {
      const saved = localStorage.getItem(SAVED_KEY);
      if (!saved) return false;
      applyState(saved);
      return hasState();
    } catch (err) {
      return false;
    }
  }

  function changed() {
    writeHash();
    saveState();
    renderResults();
  }

  // ---------- Played games: search box ----------

  const search = $("#game-search");
  const listbox = $("#game-options");
  let matches = [];
  let active = -1;

  const searchIndex = DATA.games.map((g) => ({
    game: g,
    hay: [norm(g.title)].concat((g.aka || []).map(norm))
  }));

  function findGames(query) {
    const q = norm(query);
    if (!q) return [];
    const words = q.split(" ");
    const taken = new Set(state.played.map((p) => p.id));
    const found = [];
    searchIndex.forEach(({ game, hay }) => {
      if (taken.has(game.id)) return;
      let best = Infinity;
      hay.forEach((h, i) => {
        let rank;
        if (h === q) rank = 0;
        else if (h.startsWith(q)) rank = 1;
        else if ((" " + h).includes(" " + q)) rank = 2;
        else if (h.includes(q)) rank = 3;
        else if (words.length > 1 && words.every((w) => h.includes(w))) rank = 4;
        else return;
        if (i > 0) rank += 0.5; // aliases rank just below title matches
        best = Math.min(best, rank);
      });
      if (best < Infinity) found.push({ game: game, rank: best });
    });
    found.sort((a, b) => a.rank - b.rank || a.game.title.localeCompare(b.game.title));
    return found.slice(0, 10).map((f) => f.game);
  }

  function openOptions() {
    listbox.hidden = false;
    search.setAttribute("aria-expanded", "true");
  }

  function closeOptions() {
    listbox.hidden = true;
    search.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function renderOptions() {
    const q = search.value;
    listbox.textContent = "";
    if (!norm(q)) { matches = []; closeOptions(); return; }
    matches = findGames(q);
    if (!matches.length) {
      listbox.append(el("li", { class: "option is-empty", role: "option", "aria-disabled": "true",
        text: "Not in the list yet. Try another spelling, or use the moods below." }));
      active = -1;
      search.removeAttribute("aria-activedescendant");
      openOptions();
      return;
    }
    if (active < 0 || active >= matches.length) active = 0;
    matches.forEach((g, i) => {
      const li = el("li", {
        class: "option" + (i === active ? " is-active" : ""),
        id: "game-opt-" + i,
        role: "option",
        "aria-selected": i === active ? "true" : "false",
        onmousedown: (e) => e.preventDefault(),
        onclick: () => addGame(g.id),
        onmousemove: () => { if (active !== i) { active = i; paintActive(); } }
      }, [el("span", { text: gameName(g) }), el("span", { class: "year", text: g.year })]);
      listbox.append(li);
    });
    search.setAttribute("aria-activedescendant", "game-opt-" + active);
    openOptions();
  }

  function paintActive() {
    Array.from(listbox.children).forEach((li, i) => {
      li.classList.toggle("is-active", i === active);
      li.setAttribute("aria-selected", i === active ? "true" : "false");
    });
    if (active >= 0) {
      search.setAttribute("aria-activedescendant", "game-opt-" + active);
      const node = listbox.children[active];
      if (node) node.scrollIntoView({ block: "nearest" });
    }
  }

  search.addEventListener("input", () => { active = 0; renderOptions(); });
  search.addEventListener("focus", () => { if (norm(search.value)) renderOptions(); });
  search.addEventListener("blur", () => setTimeout(closeOptions, 120));
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (listbox.hidden) renderOptions();
      if (!matches.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      active = (active + step + matches.length) % matches.length;
      paintActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!listbox.hidden && matches[active]) addGame(matches[active].id);
    } else if (e.key === "Escape") {
      if (!listbox.hidden) { e.preventDefault(); closeOptions(); }
      else search.value = "";
    }
  });

  $("#choices").addEventListener("submit", (e) => e.preventDefault());

  function addGame(id) {
    if (!byId[id] || state.played.some((p) => p.id === id)) return;
    state.played.push({ id: id, feel: "loved" });
    search.value = "";
    closeOptions();
    renderPlayed();
    renderQuick();
    changed();
    announce("Added " + gameName(byId[id]) + " as loved. Change it in the list if it was only fine or not for you.");
  }

  function removeGame(id) {
    const i = state.played.findIndex((p) => p.id === id);
    if (i === -1) return;
    state.played.splice(i, 1);
    renderPlayed();
    renderQuick();
    changed();
    // Keep keyboard users somewhere sensible
    const rows = document.querySelectorAll(".played-row .remove");
    if (rows.length) rows[Math.min(i, rows.length - 1)].focus();
    else search.focus();
    announce("Removed " + gameName(byId[id]) + ".");
  }

  // ---------- Played games: list and quick add ----------

  function renderPlayed() {
    const list = $("#played-list");
    list.textContent = "";
    state.played.forEach((p) => {
      const g = byId[p.id];
      const name = "feel-" + p.id;
      const feel = el("fieldset", { class: "feel" }, [
        el("legend", { class: "sr-only", text: "How did " + gameName(g) + " go?" })
      ].concat(FEELS.map((f) => el("label", { class: "feel-opt feel-" + f.key }, [
        el("input", {
          type: "radio", name: name, value: f.key, checked: p.feel === f.key,
          onchange: () => { p.feel = f.key; changed(); }
        }),
        el("span", { text: f.label })
      ]))));
      list.append(el("li", { class: "played-row" }, [
        el("span", { class: "played-title", text: gameName(g) }),
        feel,
        el("button", {
          type: "button", class: "remove", "aria-label": "Remove " + gameName(g),
          title: "Remove", onclick: () => removeGame(p.id)
        }, ["×"])
      ]));
    });
  }

  function renderQuick() {
    const wrap = $("#quick-wrap");
    const box = $("#quick-add");
    box.textContent = "";
    const taken = new Set(state.played.map((p) => p.id));
    const left = QUICK_IDS.filter((id) => byId[id] && !taken.has(id)).slice(0, 8);
    // Once you've added a handful, the shortcuts have done their job
    wrap.hidden = !left.length || state.played.length >= 4;
    left.forEach((id) => {
      box.append(el("button", { type: "button", class: "chip-btn", onclick: () => addGame(id) }, [byId[id].title]));
    });
  }

  // ---------- Machines, length, moods ----------

  function renderMachines() {
    const box = $("#machines");
    box.textContent = "";
    DATA.platforms.forEach((p) => {
      box.append(el("label", { class: "opt opt-check" }, [
        el("input", {
          type: "checkbox", value: p.key, checked: state.machines.includes(p.key),
          onchange: (e) => {
            if (e.target.checked) state.machines.push(p.key);
            else state.machines = state.machines.filter((k) => k !== p.key);
            // Keep machines in catalogue order so links and summaries are stable
            state.machines = DATA.platforms.map((x) => x.key).filter((k) => state.machines.includes(k));
            changed();
          }
        }),
        el("span", { class: "mark", "aria-hidden": "true" }),
        el("span", { class: "label", text: p.label })
      ]));
    });
  }

  function renderLengths() {
    const box = $("#lengths");
    box.textContent = "";
    LENGTH_OPTIONS.forEach((o) => {
      box.append(el("label", { class: "opt opt-radio" }, [
        el("input", {
          type: "radio", name: "length", value: o.key, checked: state.length === o.key,
          onchange: () => { state.length = o.key; changed(); }
        }),
        el("span", { class: "mark", "aria-hidden": "true" }),
        el("span", { class: "label", text: o.label }),
        el("span", { class: "detail", text: o.detail.charAt(0).toUpperCase() + o.detail.slice(1) })
      ]));
    });
  }

  function renderMoods() {
    const box = $("#moods");
    box.textContent = "";
    const groups = [
      { key: "play", title: "How it plays" },
      { key: "feel", title: "How it feels" }
    ];
    groups.forEach((grp) => {
      const keys = Object.keys(DATA.tags).filter((k) => DATA.tags[k].mood && DATA.tags[k].group === grp.key);
      const headingId = "mood-" + grp.key;
      box.append(el("div", { class: "mood-group", role: "group", "aria-labelledby": headingId }, [
        el("h3", { id: headingId, text: grp.title }),
        el("div", { class: "mood-list" }, keys.map((k) => el("label", { class: "toggle" }, [
          el("input", {
            type: "checkbox", value: k, checked: state.moods.includes(k),
            onchange: (e) => {
              if (e.target.checked) state.moods.push(k);
              else state.moods = state.moods.filter((x) => x !== k);
              changed();
            }
          }),
          el("span", { text: DATA.tags[k].mood })
        ])))
      ]));
    });
  }

  // ---------- Results ----------

  function lengthOption() { return LENGTH_OPTIONS.find((o) => o.key === state.length); }

  function summaryText(result) {
    const n = state.played.length;
    let lead;
    if (n) lead = "Matched against " + n + " game" + (n === 1 ? "" : "s") + " you've played";
    else if (state.moods.length) lead = "Matched to what you're in the mood for";
    else lead = "Well-loved starting points, since you haven't added any games yet";
    const len = state.length === "any" ? "of any length" : "aiming for " + lengthOption().detail;
    if (!state.machines.length) {
      return lead + ", from every machine, " + len + ". " +
        result.eligible + " games in the list are in the running.";
    }
    const machines = listJoin(state.machines.map(shortName));
    return lead + ", playable on " + machines + ", " + len + ". " +
      result.eligible + " games in the list run on your machines.";
  }

  // "Because you loved A and B" or "Because you loved A and enjoyed B"
  function becauseText(because) {
    const loved = because.filter((b) => b.feel === "loved").map((b) => nameForTitle(b.title));
    const fine = because.filter((b) => b.feel !== "loved").map((b) => nameForTitle(b.title));
    const parts = [];
    if (loved.length) parts.push("loved " + listJoin(loved));
    if (fine.length) parts.push("enjoyed " + listJoin(fine));
    return "Because you " + parts.join(" and ");
  }

  function becauseLine(why) {
    if (why.because.length) return becauseText(why.because);
    if (why.moods.length) return "Matches what you're in the mood for";
    if (why.cold) return "A widely loved place to start";
    return "A change of pace from what you've played";
  }

  function detailLine(why) {
    if (!why.because.length || !why.shared.length) return null;
    const names = listJoin(why.like.map(nameForTitle));
    const traits = listJoin(why.shared.map((t) => DATA.tags[t].label));
    return "Like " + names + ", it has " + traits + ".";
  }

  function verdictText(s) {
    if (s.length === "fits") return "fits your time";
    if (s.length === "longer") return "longer than you asked for";
    if (s.length === "shorter") return "shorter than you asked for";
    return null;
  }

  function playLine(on) {
    return on.map((o) => shortName(o.machine) + (o.via ? " (" + shortName(o.via) + " version)" : "")).join(", ");
  }

  function gauge(hours) {
    const range = Engine.LENGTHS[state.length];
    const pct = (h) => Math.min(100, (Math.min(h, GAUGE_MAX) / GAUGE_MAX) * 100);
    const kids = [];
    if (range) {
      const left = pct(range.min);
      const right = pct(range.max === Infinity ? GAUGE_MAX : range.max);
      kids.push(el("span", { class: "gauge-range", style: "left:" + left + "%;width:" + (right - left) + "%" }));
    }
    kids.push(el("span", { class: "gauge-mark", style: "left:" + pct(hours) + "%" }));
    return el("div", { class: "gauge", "aria-hidden": "true" }, kids);
  }

  // "I've played this" reads naturally; the hidden tail names the game for screen readers
  function playedButtonChildren(g) {
    return ["I've played this", el("span", { class: "sr-only", text: ", add " + g.title + " to games you've played" })];
  }

  function addFromCard(id) {
    if (!byId[id]) return;
    addGame(id);
    // addGame redraws the picks and throws away the button that was clicked,
    // so put focus somewhere sensible rather than dropping it on the body
    const target = $("#results");
    if (target) target.focus({ preventScroll: true });
  }

  function pickCard(s, rank) {
    const g = s.game;
    const why = s.why;
    const verdict = verdictText(s);
    const moodChips = why.moods.length
      ? el("div", { class: "why-moods" }, [
        el("span", { class: "why-moods-label", id: "mood-" + g.id, text: "Matches your mood:" }),
        el("ul", { "aria-labelledby": "mood-" + g.id }, why.moods.map((t) => el("li", { text: DATA.tags[t].mood })))
      ])
      : null;

    return el("article", { class: "pick window", "aria-labelledby": "pick-" + g.id }, [
      el("p", { class: "nameplate", text: ORDINALS[rank] }),
      el("h3", { class: "pick-title", id: "pick-" + g.id }, [
        gameName(g), el("span", { class: "pick-year", text: g.year })
      ]),
      el("p", { class: "pitch", text: g.pitch }),
      el("div", { class: "why" }, [
        el("p", { class: "because" }, [becauseLine(why)]),
        detailLine(why) ? el("p", { class: "why-detail", text: detailLine(why) }) : null,
        moodChips
      ]),
      el("dl", { class: "facts" }, [
        el("dt", { text: "Length" }),
        el("dd", null, [
          "About " + g.hours + " hours",
          verdict ? ", " : null,
          verdict ? el("span", { class: "verdict-" + s.length, text: verdict }) : null,
          gauge(g.hours)
        ]),
        el("dt", { text: "Play on" }),
        el("dd", { text: playLine(s.on) })
      ]),
      g.note ? el("p", { class: "note", text: g.note }) : null,
      el("button", {
        type: "button", class: "btn btn-quiet pick-add",
        onclick: () => addFromCard(g.id)
      }, playedButtonChildren(g))
    ]);
  }

  function moreItem(s) {
    const g = s.game;
    const why = s.why;
    let reason;
    if (why.because.length) reason = becauseText(why.because.slice(0, 1));
    else if (why.moods.length) reason = "Matches " + listJoin(why.moods.map((t) => DATA.tags[t].mood.toLowerCase()));
    else reason = g.pitch;
    const verdict = verdictText(s);
    return el("li", { class: "more-item" }, [
      el("div", { class: "more-top" }, [
        el("span", { class: "more-title", text: gameName(g) }),
        el("span", { class: "more-meta", text: "About " + g.hours + " hours" + (verdict && s.length !== "fits" ? ", " + verdict : "") })
      ]),
      el("span", { class: "more-why", text: reason }),
      el("span", { class: "more-meta", text: "Play on " + playLine(s.on) }),
      el("div", { class: "more-actions" }, [
        el("button", {
          type: "button", class: "more-add",
          onclick: () => addFromCard(g.id)
        }, playedButtonChildren(g))
      ])
    ]);
  }

  function emptyState(lead, rest) {
    return el("div", { class: "window empty-state" }, [
      el("p", { class: "nameplate", text: "Waiting" }),
      el("p", { class: "lead", text: lead }),
      rest ? el("p", { class: "hint", text: rest }) : null
    ]);
  }

  function renderResults() {
    const out = $("#picks");
    const summary = $("#results-summary");
    out.textContent = "";

    // No machines ticked means no constraint; the engine treats it that way
    const result = Engine.recommend(index, state, { limit: 9 });
    summary.textContent = summaryText(result);

    if (!result.picks.length) {
      out.append(emptyState(
        "Nothing left to suggest for those machines.",
        "Try adding another machine, or remove a game from your played list."
      ));
      announce("No picks for those machines.", 500);
      return;
    }

    result.picks.slice(0, 3).forEach((s, i) => out.append(pickCard(s, i)));

    const rest = result.picks.slice(3);
    if (rest.length) {
      out.append(el("section", { class: "more window", "aria-labelledby": "more-title" }, [
        el("h3", { class: "nameplate", id: "more-title", text: "Also worth a look" }),
        el("ol", { class: "more-list" }, rest.map(moreItem))
      ]));
    }

    announce("Top pick: " + gameName(result.picks[0].game) + ".", 600);
  }

  // ---------- Buttons ----------

  $("#copy-link").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const done = () => {
      btn.textContent = "Link copied";
      setTimeout(() => { btn.textContent = "Copy link to these picks"; }, 2000);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(location.href).then(done, () => window.prompt("Copy this link:", location.href));
    } else {
      window.prompt("Copy this link:", location.href);
    }
  });

  $("#reset").addEventListener("click", () => {
    state.played = [];
    state.machines = [];
    state.length = "any";
    state.moods = [];
    search.value = "";
    try { localStorage.removeItem(SAVED_KEY); } catch (err) { /* nothing to clear */ }
    renderAll();
    writeHash();
    search.focus();
    announce("Cleared. Start again whenever you're ready.");
  });

  function goToResults(e) {
    e.preventDefault();
    const target = $("#results");
    target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    target.focus({ preventScroll: true });
  }

  document.querySelector(".jump").addEventListener("click", goToResults);
  // The skip link is another in-page anchor; without this it would fire a
  // hashchange, which would wipe the state you are looking at
  document.querySelector(".skip-link").addEventListener("click", goToResults);

  function syncNameToggle() {
    document.querySelectorAll(".name-opt").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.name === nameMode ? "true" : "false");
    });
  }

  function setNameMode(mode) {
    if (mode !== "eu" && mode !== "na") return;
    if (mode === nameMode) return;
    nameMode = mode;
    try { localStorage.setItem(NAME_KEY, mode); } catch (err) { /* not remembered; still switched */ }
    syncNameToggle();
    renderAll();
    announce(mode === "eu" ? "Showing UK and European names." : "Showing North American names.");
  }

  document.querySelectorAll(".name-opt").forEach((btn) => {
    btn.addEventListener("click", () => setNameMode(btn.dataset.name));
  });

  // ---------- The one bit of theatre: the intro types itself out ----------

  function typeDialogue() {
    const p = $("#dialogue");
    const text = p.textContent.trim();
    const caret = el("span", { class: "caret", "aria-hidden": "true", text: "▼" });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      p.append(caret);
      return;
    }
    // Screen readers get the whole line at once; the typing is visual only
    const typed = el("span", { "aria-hidden": "true" });
    p.textContent = "";
    p.append(el("span", { class: "sr-only", text: text }), typed);
    let i = 0;
    const tick = () => {
      i += 2;
      typed.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(tick, 22);
      else p.append(caret);
    };
    setTimeout(tick, 250);
  }

  // ---------- Start ----------

  function renderAll() {
    renderPlayed();
    renderQuick();
    renderMachines();
    renderLengths();
    renderMoods();
    renderResults();
  }

  $("#updated").textContent = DATA.updated;
  $("#version").textContent = DATA.version;
  syncNameToggle();
  // A link with state in it wins for the visit; otherwise pick up where the
  // last visit left off, and show it in the URL so it can be shared
  if (location.hash.slice(1)) readHash();
  else if (restoreSaved()) writeHash();
  renderAll();
  typeDialogue();

  window.addEventListener("hashchange", () => {
    state.played = []; state.machines = []; state.length = "any"; state.moods = [];
    search.value = "";
    closeOptions();
    readHash();
    renderAll();
  });
})();
