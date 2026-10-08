/*
 * The audit page: every game in the catalogue, machine by machine.
 * Each machine lists its native games plus anything older it can still run
 * through backward compatibility, marked the same way the pick cards mark it.
 */
(function () {
  "use strict";

  const DATA = window.RPG_DATA;
  const Engine = window.RPGRecommend;

  const platformByKey = {};
  DATA.platforms.forEach((p) => { platformByKey[p.key] = p; });
  function shortName(key) { return platformByKey[key] ? platformByKey[key].short : key; }

  // The footer toggle flips the few games that were renamed between regions
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

  function entriesFor(platformKey) {
    const older = Engine.BACKWARD[platformKey] || [];
    const entries = [];
    DATA.games.forEach((g) => {
      if (g.platforms.indexOf(platformKey) !== -1) {
        entries.push({ game: g, via: null });
        return;
      }
      for (let i = 0; i < older.length; i++) {
        if (g.platforms.indexOf(older[i]) !== -1) {
          entries.push({ game: g, via: older[i] });
          return;
        }
      }
    });
    entries.sort((a, b) => a.game.title.localeCompare(b.game.title));
    return entries;
  }

  const nav = document.querySelector("#audit-nav");
  const main = document.querySelector("#audit");

  // Machines start collapsed; whatever the visitor opens stays open across redraws
  const openMachines = new Set();

  function setMachine(button, open) {
    const bodyId = button.getAttribute("aria-controls");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    const body = document.getElementById(bodyId);
    if (body) body.hidden = !open;
    if (open) openMachines.add(bodyId);
    else openMachines.delete(bodyId);
  }

  function toggleMachine(button) {
    setMachine(button, button.getAttribute("aria-expanded") !== "true");
  }

  function openMachine(id) {
    const section = document.getElementById(id);
    const button = section ? section.querySelector(".audit-toggle") : null;
    if (button) setMachine(button, true);
  }

  function render() {
    nav.textContent = "";
    main.textContent = "";
    DATA.platforms.forEach((p) => {
      const entries = entriesFor(p.key);
      const viaCount = entries.filter((e) => e.via).length;
      const id = "mach-" + p.key;

      nav.append(el("a", { href: "#" + id, text: p.short, class: "audit-chip" }));

      const count = entries.length + (entries.length === 1 ? " game" : " games") +
        (viaCount ? " \u00b7 " + viaCount + " via backward compatibility" : "");

      const list = entries.length
        ? el("ul", { class: "audit-list" }, entries.map((e) => el("li", null, [
          el("span", { class: "audit-title" }, [gameName(e.game), regionMark(e.game)]),
          el("span", { class: "audit-meta", text: " " + e.game.year + " \u00b7 " + e.game.hours + " hours" }),
          e.via ? el("span", { class: "audit-meta audit-via", text: " \u00b7 " + shortName(e.via) + " version" }) : null,
          e.game.note ? el("p", { class: "audit-note", text: e.game.note }) : null
        ])))
        : el("p", { class: "hint", text: "Nothing listed for this machine yet." });

      const bodyId = id + "-body";
      const open = openMachines.has(bodyId);

      main.append(el("section", { class: "window audit-machine", id: id, "aria-labelledby": id + "-title" }, [
        el("h2", { class: "nameplate", id: id + "-title" }, [
          el("button", {
            type: "button", class: "audit-toggle",
            "aria-expanded": open ? "true" : "false", "aria-controls": bodyId,
            onclick: (e) => toggleMachine(e.currentTarget)
          }, [
            el("span", { class: "audit-caret", "aria-hidden": "true" }),
            p.label
          ])
        ]),
        el("p", { class: "audit-count" }, [
          count,
          p.coverage === "complete" ? el("span", { class: "audit-complete", text: "Complete NA/EU list" }) : null
        ]),
        el("div", { class: "audit-body", id: bodyId, hidden: !open }, [list])
      ]));
    });
  }

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
    render();
  }

  document.querySelectorAll(".name-opt").forEach((btn) => {
    btn.addEventListener("click", () => setNameMode(btn.dataset.name));
  });

  nav.addEventListener("click", (e) => {
    const link = e.target.closest("a");
    if (link) openMachine(link.getAttribute("href").slice(1));
  });

  document.querySelector("#expand-all").addEventListener("click", () => {
    document.querySelectorAll(".audit-toggle").forEach((btn) => setMachine(btn, true));
  });
  document.querySelector("#collapse-all").addEventListener("click", () => {
    document.querySelectorAll(".audit-toggle").forEach((btn) => setMachine(btn, false));
  });

  document.querySelector("#audit-summary").textContent =
    DATA.games.length + " games across " + DATA.platforms.length + " machines. " +
    "Entries marked with another machine, like \u201cPS4 version\u201d, run through backward compatibility.";

  document.querySelector("#updated").textContent = DATA.updated;
  document.querySelector("#version").textContent = DATA.version;

  syncNameToggle();
  render();
  if (location.hash) openMachine(location.hash.slice(1));
})();
