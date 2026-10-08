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

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
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

  DATA.platforms.forEach((p) => {
    const entries = entriesFor(p.key);
    const viaCount = entries.filter((e) => e.via).length;
    const id = "mach-" + p.key;

    nav.append(el("a", { href: "#" + id, text: p.short }));

    const count = entries.length + (entries.length === 1 ? " game" : " games") +
      (viaCount ? " \u00b7 " + viaCount + " via backward compatibility" : "");

    const list = entries.length
      ? el("ul", { class: "audit-list" }, entries.map((e) => el("li", null, [
        el("span", { class: "audit-title", text: e.game.title }),
        el("span", { class: "audit-meta", text: " " + e.game.year + " \u00b7 " + e.game.hours + " hours" }),
        e.via ? el("span", { class: "audit-meta audit-via", text: " \u00b7 " + shortName(e.via) + " version" }) : null,
        e.game.note ? el("p", { class: "audit-note", text: e.game.note }) : null
      ])))
      : el("p", { class: "hint", text: "Nothing listed for this machine yet." });

    main.append(el("section", { class: "window", id: id, "aria-labelledby": id + "-title" }, [
      el("h2", { class: "nameplate", id: id + "-title", text: p.label }),
      el("p", { class: "audit-count", text: count }),
      list
    ]));
  });

  document.querySelector("#audit-summary").textContent =
    DATA.games.length + " games across " + DATA.platforms.length + " machines. " +
    "Entries marked with another machine, like \u201cPS4 version\u201d, run through backward compatibility.";

  document.querySelector("#updated").textContent = DATA.updated;
  document.querySelector("#version").textContent = DATA.version;
})();
