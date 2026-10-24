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

  // A small marker for the games that were renamed between regions
  function regionMark(g) {
    const names = REGION_NAMES[g.title];
    if (!names) return null;
    const other = nameMode === "eu" ? names.na : names.eu;
    const where = nameMode === "eu" ? "North America" : "Europe";
    const note = "Also known as " + other + " in " + where;
    return el("span", { class: "region-mark", title: note }, [
      el("span", { "aria-hidden": "true", text: "\u21C4" }),
      el("span", { class: "sr-only", text: " (" + note + ")" })
    ]);
  }

  // A marker for the Japan-only games that only play in English once patched
  function fanChip(g) {
    if (!g.fan) return null;
    const note = "Japan-only; playable via an English fan translation patch, with an emulator or flashcart";
    return el("span", { class: "fan-chip", title: note }, [
      el("span", { "aria-hidden": "true", text: "Fan translation" }),
      el("span", { class: "sr-only", text: " (" + note + ")" })
    ]);
  }

  // Valve's Steam Deck rating, shown wherever a game carries one
  function deckChip(g) {
    if (g.deck !== 2 && g.deck !== 3) return null;
    const verified = g.deck === 3;
    const note = verified
      ? "Valve rates this game Steam Deck Verified: it works out of the box"
      : "Valve rates this game Steam Deck Playable: it runs, but may need manual tweaks";
    return el("span", {
      class: "deck-chip " + (verified ? "deck-verified" : "deck-playable"),
      title: note
    }, [
      el("span", { "aria-hidden": "true", text: verified ? "Deck Verified" : "Deck Playable" }),
      el("span", { class: "sr-only", text: " (" + note + ")" })
    ]);
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
    { key: "bad", label: "It wasn't good", code: "b" },
    { key: "disliked", label: "Not for me", code: "d" }
  ];
  const FEEL_BY_CODE = {};
  const CODE_BY_FEEL = {};
  FEELS.forEach((f) => { FEEL_BY_CODE[f.code] = f.key; CODE_BY_FEEL[f.key] = f.code; });

  const QUICK_IDS = ["witcher3", "skyrim", "elden-ring", "bg3", "p5r", "ff7r", "mass-effect",
    "cyberpunk", "clair-obscur", "dq11", "fe3h", "hogwarts"];

  const ORDINALS = ["Top pick", "Second pick", "Third pick"];
  const GAUGE_MAX = 120;

  const state = { played: [], skipped: [], machines: [], native: false, home: false, different: false, preferOriginal: false, fan: false, length: "any", moods: [], fame: 50 };

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

  // The 1-4 fame tier as a small chip, with its meaning in the tooltip
  function fameChip(g) {
    const lv = DATA.fameLevels && DATA.fameLevels[g.fame];
    if (!lv) return null;
    return el("span", {
      class: "fame-chip fame-" + g.fame,
      title: "Fame " + g.fame + " of 4: " + lv.label + " \u2014 " + lv.blurb,
      text: lv.label
    });
  }

  const REVIEW_LEVELS = DATA.reviewLevels || { mixedBelow: 75, floor: 50, mixedLabel: "Mixed reception" };

  function reviewInfo(g) {
    const r = g.review;
    if (!r || typeof r.score !== "number" || !isFinite(r.score) || r.score < 0 || r.score > 100) return null;
    return { score: r.score, source: r.source || "Metacritic" };
  }

  // A critic score below the mixed cut-off, kept separate from the fame chip
  function reviewChip(g) {
    const r = reviewInfo(g);
    if (!r || r.score >= REVIEW_LEVELS.mixedBelow) return null;
    const tone = r.score < REVIEW_LEVELS.floor ? "critics were negative" : "critics were mixed";
    const note = r.source + " score " + r.score + "/100: " + tone;
    return el("span", { class: "review-chip", title: note }, [
      el("span", { "aria-hidden": "true", text: REVIEW_LEVELS.mixedLabel }),
      el("span", { class: "sr-only", text: " (" + note + ")" })
    ]);
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
    const s = params.get("s");
    if (s) {
      s.split(",").forEach((id) => {
        if (byId[id] && !state.skipped.includes(id) && !state.played.some((p) => p.id === id)) {
          state.skipped.push(id);
        }
      });
    }
    const m = params.get("m");
    if (m) state.machines = m.split(",").filter((k) => platformByKey[k]);
    if (params.get("n") === "1") state.native = true;
    if (params.get("h") === "1") state.home = true;
    if (params.get("d") === "1") state.different = true;
    if (params.get("o") === "1") state.preferOriginal = true;
    if (params.get("f") === "1") state.fan = true;
    const t = params.get("t");
    if (t && LENGTH_OPTIONS.some((o) => o.key === t)) state.length = t;
    const v = params.get("v");
    if (v) state.moods = v.split(",").filter((k) => DATA.tags[k] && DATA.tags[k].mood);
    const w = params.get("w");
    if (w) {
      const n = Number(w);
      if (Number.isFinite(n) && n >= 0 && n <= 100) state.fame = n;
    }
  }

  function readHash() {
    applyState(location.hash.slice(1));
  }

  function hasState() {
    return !!(state.played.length || state.skipped.length || state.machines.length || state.native || state.home || state.different || state.preferOriginal || state.fan || state.moods.length || state.length !== "any" || state.fame !== 50);
  }

  // Built by hand so the commas stay readable rather than turning into %2C
  function encodeState() {
    const parts = [];
    if (state.played.length) parts.push("p=" + state.played.map((x) => x.id + "." + CODE_BY_FEEL[x.feel]).join(","));
    if (state.skipped.length) parts.push("s=" + state.skipped.join(","));
    if (state.machines.length) parts.push("m=" + state.machines.join(","));
    if (state.native) parts.push("n=1");
    if (state.home) parts.push("h=1");
    if (state.different) parts.push("d=1");
    if (state.preferOriginal) parts.push("o=1");
    if (state.fan) parts.push("f=1");
    if (state.length !== "any") parts.push("t=" + state.length);
    if (state.moods.length) parts.push("v=" + state.moods.join(","));
    if (state.fame !== 50) parts.push("w=" + state.fame);
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
    renderDifferentToggle();
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
      }, [el("span", null, [gameName(g), regionMark(g), fanChip(g)]), el("span", { class: "year", text: g.year })]);
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

  function addGame(id, feel) {
    if (!byId[id] || state.played.some((p) => p.id === id)) return;
    state.skipped = state.skipped.filter((x) => x !== id);
    state.played.push({ id: id, feel: feel || "loved" });
    search.value = "";
    closeOptions();
    renderPlayed();
    renderQuick();
    changed();
    const name = gameName(byId[id]);
    if (feel === "disliked") {
      announce("Marked " + name + " as not for me; it won't be suggested again.");
    } else if (feel === "bad") {
      announce("Marked " + name + " as not good; its style won't count against anything else.");
    } else if (feel === "fine") {
      announce("Added " + name + " as fine.");
    } else if (feel) {
      announce("Added " + name + " as loved.");
    } else {
      announce("Added " + name + " as loved. Change it in the list if it was only fine, not good, or not for you.");
    }
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
        el("span", { class: "played-title" }, [gameName(g), regionMark(g)]),
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
            renderNativeToggle();
          }
        }),
        el("span", { class: "mark", "aria-hidden": "true" }),
        el("span", { class: "label", text: p.label })
      ]));
    });
  }

  // The native-only filter only has meaning once a machine is ticked, so it is
  // hidden until then. It never clears a saved preference on its own.
  const nativeBox = $("#native-only");
  const nativeOpt = $("#native-opt");
  const nativeWrap = $("#machine-filter");

  function renderNativeToggle() {
    nativeBox.checked = state.native;
    const deckOnly = state.machines.length === 1 && state.machines[0] === "steamdeck";
    nativeOpt.hidden = deckOnly;
    nativeWrap.hidden = !state.machines.length;
  }

  nativeBox.addEventListener("change", (e) => {
    state.native = e.target.checked;
    changed();
    announce(state.native
      ? "Showing only games made for your machines."
      : "Including older games your machines can play.");
  });

  // "Hide ports" keeps games whose own machine is one you ticked, so a SNES game
  // ported to the GBA stops cluttering the GBA list. Like the native-only filter
  // it stays hidden until a machine is ticked, since without one it does nothing.
  const homeBox = $("#home-only");

  function renderHomeToggle() {
    homeBox.checked = state.home;
  }

  homeBox.addEventListener("change", (e) => {
    state.home = e.target.checked;
    changed();
    announce(state.home
      ? "Hiding ports of games from other machines."
      : "Including ports of games from other machines.");
  });

  // "Show me something different" flips the ranking away from your taste. It only
  // means anything once there is a profile to differ from, so it hides until then.
  const differentBox = $("#different-toggle");
  const differentSection = $("#different-section");

  function renderDifferentToggle() {
    differentBox.checked = state.different;
    differentSection.hidden = !(state.played.length || state.moods.length);
  }

  differentBox.addEventListener("change", (e) => {
    state.different = e.target.checked;
    changed();
    announce(state.different
      ? "Looking for something different from your usual taste."
      : "Back to the closest matches to your taste.");
  });

  // A game with both an original and a modern edition is shown once. By default
  // the modern one is shown; this prefers the original wherever it still runs.
  const preferOriginalBox = $("#prefer-original");

  function renderVersionToggle() {
    preferOriginalBox.checked = state.preferOriginal;
  }

  preferOriginalBox.addEventListener("change", (e) => {
    state.preferOriginal = e.target.checked;
    changed();
    announce(state.preferOriginal
      ? "Showing original releases where you can play them."
      : "Showing the modern edition of games where there is a choice.");
  });

  // Japan-only games with English fan translations are opt-in: they need a
  // patched ROM and an emulator or flashcart, so they are no ordinary machine
  // pick. The section hides itself when the catalogue lists none.
  const fanBox = $("#fan-toggle");
  const fanSection = $("#fan-section");
  const hasFanGames = DATA.games.some((g) => g.fan);

  function renderFanToggle() {
    fanBox.checked = state.fan;
    fanSection.hidden = !hasFanGames;
  }

  fanBox.addEventListener("change", (e) => {
    state.fan = e.target.checked;
    changed();
    announce(state.fan
      ? "Including Japan-only games with English fan translations."
      : "Hiding fan-translated games.");
  });

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

  const fameRange = $("#fame-range");

  function fameWords(v) {
    if (v === 50) return "An even mix";
    return v > 50 ? "Leaning towards crowd-pleasers" : "Leaning towards hidden gems";
  }

  function renderFame() {
    fameRange.value = state.fame;
    fameRange.setAttribute("aria-valuetext", fameWords(state.fame));
  }

  fameRange.addEventListener("input", () => {
    state.fame = Number(fameRange.value);
    renderFame();
    changed();
  });

  function renderMoods() {
    const box = $("#moods");
    box.textContent = "";
    const groups = [
      { key: "play", title: "How it plays" },
      { key: "feel", title: "How it feels" },
      { key: "origin", title: "Where it's from" }
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
    if (state.different) {
      lead = n
        ? "A departure from the " + n + " game" + (n === 1 ? "" : "s") + " you've played"
        : "A departure from what you're in the mood for";
    } else if (n) lead = "Matched against " + n + " game" + (n === 1 ? "" : "s") + " you've played";
    else if (state.moods.length) lead = "Matched to what you're in the mood for";
    else lead = "Well-loved starting points, since you haven't added any games yet";
    const len = state.length === "any" ? "of any length" : "aiming for " + lengthOption().detail;
    const fame = state.fame === 50 ? "" :
      (state.fame > 50 ? ", leaning towards crowd-pleasers" : ", leaning towards hidden gems");
    if (!state.machines.length) {
      return lead + ", from every machine, " + len + fame + ". " +
        result.eligible + " games in the list are in the running.";
    }
    if (state.machines.length === 1 && state.machines[0] === "steamdeck") {
      const homeNote = state.home ? ", with ports from other machines left out" : "";
      return lead + ", Steam Deck Verified or Playable games" + homeNote + ", " + len + fame + ". " +
        result.eligible + " games in the list are rated for Deck.";
    }
    const machines = listJoin(state.machines.map(shortName));
    if (state.home) {
      return lead + ", games of " + machines + " with ports from other machines left out, " + len + fame + ". " +
        result.eligible + " games in the list are games of your machines.";
    }
    if (state.native) {
      return lead + ", made for " + machines + ", " + len + fame + ". " +
        result.eligible + " games in the list were released for your machines.";
    }
    return lead + ", playable on " + machines + ", " + len + fame + ". " +
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
    if (why.different) return "Deliberately outside your usual taste";
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
    return on.map((o) => {
      if (o.via) return shortName(o.machine) + " (" + shortName(o.via) + " version)";
      if (o.machine === "steamdeck" && o.deck) {
        return "Steam Deck (" + (o.deck === 3 ? "Verified" : "Playable") + ")";
      }
      return shortName(o.machine);
    }).join(", ");
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

  // The card buttons are the same four verdicts as the played list; the hidden tail
  // names the game and the verdict for screen readers
  function lovedButtonChildren(g) {
    return ["Loved it", el("span", { class: "sr-only", text: ", mark " + g.title + " as loved" })];
  }

  function fineButtonChildren(g) {
    return ["It was fine", el("span", { class: "sr-only", text: ", mark " + g.title + " as fine" })];
  }

  function badButtonChildren(g) {
    return ["It wasn't good", el("span", { class: "sr-only", text: ", mark " + g.title + " as not good and stop suggesting it" })];
  }

  function dismissButtonChildren(g) {
    return ["Not for me", el("span", { class: "sr-only", text: ", mark " + g.title + " as not for me and stop suggesting it" })];
  }

  function skipButtonChildren(g) {
    return ["Skip", el("span", { class: "sr-only", text: " " + gameName(g) })];
  }

  function addFromCard(id, feel) {
    if (!byId[id]) return;
    addGame(id, feel);
    // addGame redraws the picks and throws away the button that was clicked,
    // so put focus somewhere sensible rather than dropping it on the body
    const target = $("#results");
    if (target) target.focus({ preventScroll: true });
  }

  // Skipping only hides the title for now; it never touches the taste profile
  function skipGame(id) {
    if (!byId[id] || state.skipped.includes(id) || state.played.some((p) => p.id === id)) return;
    state.skipped.push(id);
    changed();
    announce("Skipped " + gameName(byId[id]) + " without changing your taste profile.");
  }

  function skipFromCard(id) {
    if (!byId[id]) return;
    skipGame(id);
    const target = $("#results");
    if (target) target.focus({ preventScroll: true });
  }

  function pickCard(s, rank) {
    const g = s.game;
    const why = s.why;
    const verdict = verdictText(s);
    const fame = fameChip(g);
    const review = reviewInfo(g);
    const reception = reviewChip(g);
    const moodChips = why.moods.length
      ? el("div", { class: "why-moods" }, [
        el("span", { class: "why-moods-label", id: "mood-" + g.id, text: "Matches your mood:" }),
        el("ul", { "aria-labelledby": "mood-" + g.id }, why.moods.map((t) => el("li", { text: DATA.tags[t].mood })))
      ])
      : null;

    return el("article", { class: "pick window", "aria-labelledby": "pick-" + g.id }, [
      el("p", { class: "nameplate", text: ORDINALS[rank] }),
      el("h3", { class: "pick-title", id: "pick-" + g.id }, [
        gameName(g), regionMark(g), deckChip(g), fanChip(g), reception,
        el("span", { class: "pick-year", text: g.year })
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
        el("dd", { text: playLine(s.on) }),
        fame ? el("dt", { text: "Fame" }) : null,
        fame ? el("dd", null, [fame]) : null,
        review ? el("dt", { text: "Reviews" }) : null,
        review ? el("dd", { text: review.score + "/100 on " + review.source }) : null
      ]),
      g.note ? el("p", { class: "note", text: g.note }) : null,
      el("div", { class: "pick-actions" }, [
        el("button", {
          type: "button", class: "btn btn-quiet pick-add",
          onclick: () => addFromCard(g.id, "loved")
        }, lovedButtonChildren(g)),
        el("button", {
          type: "button", class: "btn btn-quiet pick-fine",
          onclick: () => addFromCard(g.id, "fine")
        }, fineButtonChildren(g)),
        el("button", {
          type: "button", class: "btn btn-quiet pick-bad",
          onclick: () => addFromCard(g.id, "bad")
        }, badButtonChildren(g)),
        el("button", {
          type: "button", class: "btn btn-quiet pick-dismiss",
          onclick: () => addFromCard(g.id, "disliked")
        }, dismissButtonChildren(g)),
        el("button", {
          type: "button", class: "btn btn-quiet pick-skip",
          title: "Hide this title without changing your taste profile",
          onclick: () => skipFromCard(g.id)
        }, skipButtonChildren(g))
      ])
    ]);
  }

  function moreItem(s) {
    const g = s.game;
    const why = s.why;
    let reason = null;
    if (why.because.length) reason = becauseText(why.because.slice(0, 1));
    else if (why.moods.length) reason = "Matches " + listJoin(why.moods.map((t) => DATA.tags[t].mood.toLowerCase()));
    const verdict = verdictText(s);
    const fame = fameChip(g);
    const review = reviewInfo(g);
    const reception = reviewChip(g);
    return el("li", { class: "more-item" }, [
      el("div", { class: "more-top" }, [
        el("span", { class: "more-title" }, [gameName(g), regionMark(g), deckChip(g), fanChip(g), reception]),
        el("span", { class: "more-meta" }, [
          "About " + g.hours + " hours" + (verdict && s.length !== "fits" ? ", " + verdict : "") + (fame ? " \u00b7 " : ""),
          fame,
          review ? " \u00b7 " + review.score + "/100 " + review.source : null
        ])
      ]),
      el("span", { class: "more-pitch", text: g.pitch }),
      reason ? el("span", { class: "more-why", text: reason }) : null,
      el("span", { class: "more-meta", text: "Play on " + playLine(s.on) }),
      el("div", { class: "more-actions" }, [
        el("button", {
          type: "button", class: "more-add",
          onclick: () => addFromCard(g.id, "loved")
        }, lovedButtonChildren(g)),
        el("button", {
          type: "button", class: "more-add more-fine",
          onclick: () => addFromCard(g.id, "fine")
        }, fineButtonChildren(g)),
        el("button", {
          type: "button", class: "more-add more-bad",
          onclick: () => addFromCard(g.id, "bad")
        }, badButtonChildren(g)),
        el("button", {
          type: "button", class: "more-add more-dismiss",
          onclick: () => addFromCard(g.id, "disliked")
        }, dismissButtonChildren(g)),
        el("button", {
          type: "button", class: "more-add more-skip",
          title: "Hide this title without changing your taste profile",
          onclick: () => skipFromCard(g.id)
        }, skipButtonChildren(g))
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

    const unskip = $("#unskip");
    unskip.hidden = !state.skipped.length;
    if (state.skipped.length) {
      unskip.textContent = "Bring back " + state.skipped.length + " skipped " +
        (state.skipped.length === 1 ? "title" : "titles");
    }

    if (!result.picks.length) {
      const skipped = state.skipped.length;
      const rest = skipped
        ? "You've skipped " + skipped + " title" + (skipped === 1 ? "" : "s") + ". Bring some back, add another machine, or remove a game from your played list."
        : state.home
        ? "Try turning off \u201cHide ports from other machines\u201d, adding another machine, or removing a game from your played list."
        : state.native
        ? "Try turning off \u201cOnly games made for these machines\u201d, adding another machine, or removing a game from your played list."
        : "Try adding another machine, or remove a game from your played list.";
      out.append(emptyState(
        state.machines.length ? "Nothing left to suggest for those machines." : "Nothing left to suggest.",
        rest
      ));
      announce(skipped ? "No picks left. Bring back a skipped title or change your filters." : "No picks for those machines.", 500);
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

  $("#unskip").addEventListener("click", () => {
    const n = state.skipped.length;
    if (!n) return;
    state.skipped = [];
    changed();
    announce("Brought back " + n + " skipped title" + (n === 1 ? "" : "s") + ".");
    $("#results").focus({ preventScroll: true });
  });

  $("#reset").addEventListener("click", () => {
    state.played = [];
    state.skipped = [];
    state.machines = [];
    state.native = false;
    state.home = false;
    state.different = false;
    state.preferOriginal = false;
    state.fan = false;
    state.length = "any";
    state.moods = [];
    state.fame = 50;
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
    renderNativeToggle();
    renderHomeToggle();
    renderDifferentToggle();
    renderVersionToggle();
    renderFanToggle();
    renderLengths();
    renderFame();
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
    state.played = []; state.skipped = []; state.machines = []; state.native = false; state.home = false; state.different = false; state.preferOriginal = false; state.fan = false; state.length = "any"; state.moods = []; state.fame = 50;
    search.value = "";
    closeOptions();
    readHash();
    renderAll();
  });
})();
