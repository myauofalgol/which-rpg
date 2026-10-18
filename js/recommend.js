/*
 * The recommendation engine. No DOM in here, so it can be tested with Node.
 *
 * How it works, briefly:
 *   1. Every game becomes a vector of its tags, each weighted by how rare the tag is
 *      across the catalogue (inverse document frequency), then normalised.
 *   2. Your played games are added together into a taste profile: loved games count
 *      fully, "it was fine" a little, "not for me" pulls the profile away, and
 *      "it wasn't good" is for a game that fell short without blaming its genre,
 *      so it counts as played but leaves the profile alone.
 *   3. Anything you are "in the mood for" becomes a second profile, blended in with
 *      more pull than your history, so a craving can reshape the list.
 *   4. Each unplayed game you can actually run gets a score:
 *        taste match (cosine similarity)
 *      + how well its length fits the time you have
 *      + a small nudge for sequels or siblings of games you loved
 *      + a popularity nudge when the slider leans towards crowd-pleasers
 *        or hidden gems
 *   5. A game with several editions (an original and a remaster) is shown once - as the
 *      preferred edition by default, or the original when `preferOriginal` is set - and
 *      counts as one game for the "have you played it" and series-variety rules.
 *   6. The top picks are spread across series so you don't get three Souls games -
 *      unless you asked for a mood, in which case its games all come first, or
 *      unless the spread would leave the list short, in which case it is filled up.
 */
(function (root) {
  "use strict";

  // A console that can run games made for an older one
  var BACKWARD = {
    ps5: ["ps4"], xsx: ["xb1"], switch2: ["switch"],
    "3ds": ["ds"], wiiu: ["wii"], wii: ["gamecube"],
    ds: ["gba"], gba: ["gb", "gbc"], ps2: ["ps1"], ps3: ["ps1"], psvita: ["psp"]
  };

  // "bad" says the game fell short, not the genre: it counts as played but does
  // not move the taste profile
  var FEEL_WEIGHT = { loved: 1, fine: 0.35, bad: 0, disliked: -0.8 };

  var LENGTHS = {
    any: null,
    short: { min: 0, max: 20 },
    medium: { min: 20, max: 45 },
    long: { min: 45, max: 80 },
    epic: { min: 80, max: Infinity }
  };

  var WEIGHTS = {
    // A ticked mood pulls nearly twice as hard as your played history, so it
    // changes the shape of the list rather than just nudging it
    played: 0.5,
    mood: 0.9,
    lengthFit: 0.4,
    sameSeriesLoved: 0.08,
    sameSeriesDisliked: -0.15,
    // A poor game says less about its series than an outright bad fit does
    sameSeriesBad: -0.08,
    // The most the popularity slider can move a game at either extreme
    fame: 0.2,
    starterCold: 0.12,
    starterWarm: 0.02,
    // How hard "show me something different" pulls against your taste profile
    different: 1
  };

  function buildIndex(data) {
    var games = data.games;
    var n = games.length;
    var df = {};
    games.forEach(function (g) {
      g.tags.forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    });

    // Rarer tags say more about a game; damped so they don't drown everything else
    var idf = {};
    Object.keys(df).forEach(function (t) {
      idf[t] = 1 + 0.6 * Math.log(n / df[t]);
    });

    var vectors = {};
    var byId = {};
    games.forEach(function (g) {
      byId[g.id] = g;
      var v = {};
      g.tags.forEach(function (t) { v[t] = idf[t]; });
      vectors[g.id] = normalise(v);
    });

    // Hand-set fame tiers (1-4) become a centred score from -1 to 1, so the
    // popularity slider can lean on them; a missing tier stays neutral
    var fame = {};
    games.forEach(function (g) {
      var t = g.fame;
      fame[g.id] = (typeof t === "number" && t >= 1 && t <= 4) ? (t - 2.5) / 1.5 : 0;
    });

    // Where a game "lives": its oldest machine that isn't still growing, so a
    // SNES game ported up to the GBA still points back at the SNES. PC, phones
    // and the current consoles never count as the oldest, so a game on nothing
    // but those lives on all of them. A game may set `home` by hand to override.
    var era = {};
    var living = {};
    data.platforms.forEach(function (p) {
      era[p.key] = typeof p.era === "number" ? p.era : Infinity;
      if (p.coverage === "living") living[p.key] = true;
    });
    var home = {};
    games.forEach(function (g) {
      if (g.home && g.home.length) { home[g.id] = g.home.slice(); return; }
      var older = g.platforms.filter(function (k) { return !living[k]; });
      if (!older.length) { home[g.id] = g.platforms.slice(); return; }
      var min = Infinity;
      older.forEach(function (k) { if (era[k] < min) min = era[k]; });
      home[g.id] = older.filter(function (k) { return era[k] === min; });
    });

    // Editions of the same game share a "lineage": an entry with `of` points back at its
    // base game, and the base may name a `preferred` edition to show by default. Most
    // games are their own single-entry lineage.
    var baseOf = {};
    var editionsOf = {};
    games.forEach(function (g) {
      var base = (g.of && byId[g.of]) ? g.of : g.id;
      baseOf[g.id] = base;
      (editionsOf[base] = editionsOf[base] || []).push(g.id);
    });
    var preferredOf = {};
    Object.keys(editionsOf).forEach(function (base) {
      var b = byId[base];
      preferredOf[base] = (b && b.preferred && byId[b.preferred]) ? b.preferred : base;
    });

    return { data: data, idf: idf, vectors: vectors, byId: byId, fame: fame, home: home,
             baseOf: baseOf, editionsOf: editionsOf, preferredOf: preferredOf };
  }

  function normalise(v) {
    var sum = 0;
    Object.keys(v).forEach(function (k) { sum += v[k] * v[k]; });
    var len = Math.sqrt(sum);
    if (!len) return {};
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k] / len; });
    return out;
  }

  function dot(a, b) {
    var s = 0;
    Object.keys(a).forEach(function (k) { if (b[k]) s += a[k] * b[k]; });
    return s;
  }

  function addScaled(target, v, scale) {
    Object.keys(v).forEach(function (k) { target[k] = (target[k] || 0) + v[k] * scale; });
  }

  // Which of your machines can play this game, and how. With none chosen,
  // there is no constraint: every platform the game runs on counts, natively.
  // When nativeOnly is set, a game only counts if it was made for the machine
  // itself, so backward-compatible picks are left out.
  function playableOn(game, machines, nativeOnly) {
    if (!machines.length) {
      return game.platforms.map(function (k) { return { machine: k, via: null }; });
    }
    var out = [];
    machines.forEach(function (m) {
      if (game.platforms.indexOf(m) !== -1) {
        out.push({ machine: m, via: null });
        return;
      }
      if (nativeOnly) return;
      var older = BACKWARD[m] || [];
      for (var i = 0; i < older.length; i++) {
        if (game.platforms.indexOf(older[i]) !== -1) {
          out.push({ machine: m, via: older[i] });
          return;
        }
      }
    });
    return out;
  }

  // 1 inside the range, sliding to 0 at half or double the range edges
  function lengthFit(hours, lengthKey) {
    var range = LENGTHS[lengthKey];
    if (!range) return 1;
    if (hours >= range.min && hours <= range.max) return 1;
    var d = hours > range.max ? Math.log(hours / range.max) : Math.log(range.min / hours);
    return Math.max(0, 1 - d / Math.log(2));
  }

  function lengthVerdict(hours, lengthKey) {
    var range = LENGTHS[lengthKey];
    if (!range) return "any";
    if (hours > range.max) return "longer";
    if (hours < range.min) return "shorter";
    return "fits";
  }

  function recommend(index, state, opts) {
    opts = opts || {};
    var limit = opts.limit || 9;
    var topDistinct = opts.topDistinct || 3;
    var games = index.data.games;
    var played = state.played || [];
    var machines = state.machines || [];
    var nativeOnly = !!state.native;
    var homeOnly = !!state.home;
    var fanOn = !!state.fan;
    var different = !!state.different;
    var moods = state.moods || [];
    var lengthKey = state.length || "any";
    // 0 = hidden gems, 100 = crowd-pleasers; 50 leaves the ranking alone
    var fameRaw = typeof state.fame === "number" ? state.fame : 50;
    var fameLean = (Math.max(0, Math.min(100, fameRaw)) - 50) / 50;

    var playedIds = {};
    var playedBases = {};
    played.forEach(function (p) {
      playedIds[p.id] = p.feel;
      // Mark the whole lineage played, so loving the SNES Final Fantasy VI does not
      // bring its Pixel Remaster back as though it were a game you had not tried
      var b = index.baseOf[p.id];
      if (b) playedBases[b] = true;
    });

    // Taste profile from played games
    var playedVec = {};
    var hasPositive = false;
    played.forEach(function (p) {
      var v = index.vectors[p.id];
      var w = FEEL_WEIGHT[p.feel] || 0;
      if (!v || !w) return;
      if (w > 0) hasPositive = true;
      addScaled(playedVec, v, w);
    });

    var moodVec = {};
    var moodSet = {};
    moods.forEach(function (t) { if (index.idf[t]) { moodVec[t] = index.idf[t]; moodSet[t] = true; } });
    var hasMood = Object.keys(moodVec).length > 0;

    var profile = {};
    var pNorm = normalise(playedVec);
    var mNorm = normalise(moodVec);
    var hasPlayed = Object.keys(pNorm).length > 0;
    if (hasPlayed && hasMood) {
      addScaled(profile, pNorm, WEIGHTS.played);
      addScaled(profile, mNorm, WEIGHTS.mood);
    } else if (hasPlayed) {
      profile = pNorm;
    } else if (hasMood) {
      profile = mNorm;
    }
    var warm = hasPositive || hasMood;

    var lovedSeries = {};
    var dislikedSeries = {};
    var badSeries = {};
    played.forEach(function (p) {
      var g = index.byId[p.id];
      if (!g || !g.series) return;
      if (p.feel === "loved") lovedSeries[g.series] = true;
      if (p.feel === "disliked") dislikedSeries[g.series] = true;
      if (p.feel === "bad") badSeries[g.series] = true;
    });

    var preferOriginal = !!state.preferOriginal;

    // Group the playable, unplayed entries by lineage, then keep one per lineage: the
    // preferred edition by default, the original when "prefer originals" is on, and
    // whichever edition your machines can actually run when the favoured one cannot.
    var groups = {};
    games.forEach(function (g) {
      if (playedIds[g.id]) return;
      var lineage = index.baseOf[g.id] || g.id;
      if (playedBases[lineage]) return;
      // Japan-only games with English fan translations stay hidden unless asked
      // for: there is no official release to buy, so they are no ordinary pick
      if (g.fan && !fanOn) return;
      // "Hide ports": keep only games whose own machine is one you picked, so a
      // SNES game ported to the GBA drops out when you tick the GBA. It only
      // bites once a machine is ticked, like the native-only filter.
      if (homeOnly && machines.length) {
        var where = index.home[g.id] || [];
        if (!machines.some(function (m) { return where.indexOf(m) !== -1; })) return;
      }
      var on = playableOn(g, machines, nativeOnly);
      if (!on.length) return;
      (groups[lineage] = groups[lineage] || []).push({ game: g, on: on });
    });

    function firstById(list, id) {
      for (var i = 0; i < list.length; i++) if (list[i].game.id === id) return list[i];
      return null;
    }

    var eligible = 0;
    var scored = [];
    Object.keys(groups).forEach(function (lineage) {
      var group = groups[lineage];
      var chosen = group[0];
      if (group.length > 1) {
        var pref = index.preferredOf[lineage] || lineage;
        var order = preferOriginal ? [lineage, pref] : [pref, lineage];
        for (var k = 0; k < order.length; k++) {
          var hit = firstById(group, order[k]);
          if (hit) { chosen = hit; break; }
        }
      }
      eligible++;

      var g = chosen.game;
      var taste = dot(profile, index.vectors[g.id]);
      var fit = lengthFit(g.hours, lengthKey);
      // Series nudges reward staying near your history, so they are left out
      // when the whole point is to steer away from it
      var series = 0;
      if (!different) {
        if (g.series && lovedSeries[g.series]) series += WEIGHTS.sameSeriesLoved;
        if (g.series && dislikedSeries[g.series]) series += WEIGHTS.sameSeriesDisliked;
        if (g.series && badSeries[g.series]) series += WEIGHTS.sameSeriesBad;
      }
      var starter = g.starter ? (warm ? WEIGHTS.starterWarm : WEIGHTS.starterCold) : 0;
      var fameNudge = WEIGHTS.fame * fameLean * (index.fame[g.id] || 0);
      // Normally the closest match wins; "something different" rewards the least similar
      var baseScore = different ? WEIGHTS.different * -taste : taste;

      scored.push({
        game: g,
        on: chosen.on,
        taste: taste,
        fit: fit,
        moodMatch: !different && hasMood && g.tags.some(function (t) { return moodSet[t] === true; }),
        length: lengthVerdict(g.hours, lengthKey),
        score: baseScore + WEIGHTS.lengthFit * fit + series + starter + fameNudge
      });
    });

    scored.sort(function (a, b) {
      if (a.moodMatch !== b.moodMatch) return a.moodMatch ? -1 : 1;
      return b.score - a.score || a.game.title.localeCompare(b.game.title);
    });

    // Games that blow far past the time you have (or are far too short) only appear
    // once everything that fits has been shown; a 100-hour epic is no weekend pick
    scored = scored.filter(function (s) { return s.fit > 0; })
      .concat(scored.filter(function (s) { return s.fit === 0; }));

    // Keep the headline picks varied: one per series in the top few, two per series overall.
    // A mood switches this off: everything tagged with the mood comes before anything merely
    // related, even if that means three Castlevanias in a row.
    var picks = [];
    var deferred = [];
    var seriesCount = {};
    scored.forEach(function (s) {
      var key = s.game.series || index.baseOf[s.game.id] || s.game.id;
      var count = seriesCount[key] || 0;
      var cap = hasMood ? Infinity : (picks.length < topDistinct ? 1 : 2);
      if (count >= cap) {
        deferred.push(s);
        return;
      }
      if (picks.length < limit) {
        picks.push(s);
        seriesCount[key] = count + 1;
      }
    });

    // Second chances: a series runner-up that outranks the filler should still
    // make the list, displacing the lowest pick rather than being lost behind it
    function byScore(a, b) { return b.score - a.score || a.game.title.localeCompare(b.game.title); }
    for (var i = 0; i < deferred.length; i++) {
      var d = deferred[i];
      var dKey = d.game.series || index.baseOf[d.game.id] || d.game.id;
      if ((seriesCount[dKey] || 0) >= 2) continue;
      if (picks.length < limit) {
        picks.push(d);
        seriesCount[dKey] = (seriesCount[dKey] || 0) + 1;
        continue;
      }
      if (d.score > picks[picks.length - 1].score) {
        var out = picks.pop();
        var outKey = out.game.series || index.baseOf[out.game.id] || out.game.id;
        if (seriesCount[outKey]) seriesCount[outKey]--;
        picks.push(d);
        seriesCount[dKey] = (seriesCount[dKey] || 0) + 1;
        picks.sort(byScore);
      }
    }

    // The per-series cap keeps the list varied, but it should never shrink it:
    // if holding series-mates back left us short of a full set, top up with the
    // best of the rest, cap or no cap, so variety never costs a suggestion.
    if (picks.length < limit) {
      var chosen = {};
      picks.forEach(function (s) { chosen[s.game.id] = true; });
      for (var j = 0; j < scored.length && picks.length < limit; j++) {
        var cand = scored[j];
        if (chosen[cand.game.id]) continue;
        chosen[cand.game.id] = true;
        picks.push(cand);
      }
      picks.sort(function (a, b) {
        if (a.moodMatch !== b.moodMatch) return a.moodMatch ? -1 : 1;
        return b.score - a.score || a.game.title.localeCompare(b.game.title);
      });
    }

    picks.forEach(function (s) { s.why = explain(index, s.game, played, moods, warm, different); });

    return { picks: picks, eligible: eligible, warm: warm, different: different };
  }

  // Build the "because you loved" reasoning for one game
  function explain(index, game, played, moods, warm, different) {
    // In "something different" mode there is no shared-taste reason to give
    if (different) {
      return { because: [], like: [], shared: [], moods: [], cold: false, different: true };
    }
    var vec = index.vectors[game.id];
    var matches = [];
    played.forEach(function (p) {
      if (p.feel !== "loved" && p.feel !== "fine") return;
      var other = index.byId[p.id];
      var v = index.vectors[p.id];
      if (!other || !v) return;
      matches.push({ game: other, feel: p.feel, sim: dot(v, vec) });
    });
    matches.sort(function (a, b) {
      // Loved games make better reasons than "it was fine" ones
      var fa = a.feel === "loved" ? 0.1 : 0;
      var fb = b.feel === "loved" ? 0.1 : 0;
      return (b.sim + fb) - (a.sim + fa);
    });

    var because = matches.filter(function (m) { return m.sim >= 0.45; }).slice(0, 2);
    if (!because.length && matches.length && matches[0].sim >= 0.3) because = [matches[0]];
    // Read naturally: "you loved X and enjoyed Y", never the other way round
    because.sort(function (a, b) { return (a.feel === "loved" ? 0 : 1) - (b.feel === "loved" ? 0 : 1); });

    // Traits this game shares with every game named as a reason, rarest first.
    // If two reasons have little in common, describe the closer one only, so the
    // sentence never claims a trait for a game that doesn't have it.
    function sharedWith(list) {
      return game.tags.filter(function (t) {
        return list.every(function (m) { return m.game.tags.indexOf(t) !== -1; });
      }).sort(function (a, b) { return index.idf[b] - index.idf[a]; });
    }
    var like = because;
    var shared = sharedWith(like);
    if (like.length > 1 && shared.length < 2) {
      like = because.slice(0, 1);
      shared = sharedWith(like);
    }
    var moodHits = moods.filter(function (t) { return game.tags.indexOf(t) !== -1; });

    return {
      because: because.map(function (m) { return { title: m.game.title, feel: m.feel }; }),
      like: like.map(function (m) { return m.game.title; }),
      shared: shared.slice(0, 3),
      moods: moodHits,
      cold: !warm,
      different: false
    };
  }

  var api = {
    buildIndex: buildIndex,
    recommend: recommend,
    playableOn: playableOn,
    lengthFit: lengthFit,
    LENGTHS: LENGTHS,
    BACKWARD: BACKWARD
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RPGRecommend = api;
})(this);
