/*
 * The audit page: every game in the catalogue, machine by machine.
 * A machine lists the games whose `platforms` name it; the picker's automatic
 * backward compatibility is not expanded here.
 */
(function () {
  "use strict";

  const DATA = window.RPG_DATA;

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

  // A marker for the Japan-only games that only play in English once patched
  function fanChip(g) {
    if (!g.fan) return null;
    const note = "Japan-only; playable via an English fan translation patch, with an emulator or flashcart";
    return el("span", { class: "fan-chip", title: note }, [
      el("span", { "aria-hidden": "true", text: "Fan translation" }),
      el("span", { class: "sr-only", text: " (" + note + ")" })
    ]);
  }

  function entriesFor(platformKey) {
    const entries = DATA.games.filter((g) => g.platforms.indexOf(platformKey) !== -1);
    entries.sort((a, b) => a.title.localeCompare(b.title));
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
      const fanCount = entries.filter((g) => g.fan).length;
      const id = "mach-" + p.key;

      nav.append(el("a", { href: "#" + id, text: p.short, class: "audit-chip" }));

      const count = entries.length + (entries.length === 1 ? " game" : " games") +
        (fanCount ? " \u00b7 " + fanCount + (fanCount === 1 ? " fan translation" : " fan translations") : "");

      const list = entries.length
        ? el("ul", { class: "audit-list" }, entries.map((g) => {
          const chip = fameChip(g);
          return el("li", null, [
            el("span", { class: "audit-title" }, [gameName(g), regionMark(g)]),
            el("span", { class: "audit-meta", text: " " + g.year + " \u00b7 " + g.hours + " hours" + (chip ? " \u00b7 " : "") }),
            chip,
            g.fan ? fanChip(g) : null,
            g.note ? el("p", { class: "audit-note", text: g.note }) : null
          ]);
        }))
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
    "Backward compatibility is left to the picker, though a few Xbox One games that run that way are kept and marked in their notes. " +
    "Games with a \u201cFan translation\u201d chip are Japan-only, playable via an English fan translation patch with an emulator or flashcart. " +
    "Each game carries a 1-4 fame tier, shown beside it, that the picker\u2019s slider leans on:";

  const fameKey = document.querySelector("#fame-key");
  if (fameKey && DATA.fameLevels) {
    [1, 2, 3, 4].forEach((n) => {
      const lv = DATA.fameLevels[n];
      if (!lv) return;
      fameKey.append(el("li", null, [
        el("span", { class: "fame-chip fame-" + n, text: lv.label }),
        el("span", { text: lv.blurb })
      ]));
    });
  }

  document.querySelector("#updated").textContent = DATA.updated;
  document.querySelector("#version").textContent = DATA.version;

  syncNameToggle();
  render();
  if (location.hash) openMachine(location.hash.slice(1));
})();
