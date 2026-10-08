/*
 * The recommendation engine. No DOM in here, so it can be tested with Node.
 *
 * How it works, briefly:
 *   1. Every game becomes a vector of its tags, each weighted by how rare the tag is
 *      across the catalogue (inverse document frequency), then normalised.
 *   2. Your played games are added together into a taste profile: loved games count
 *      fully, "it was fine" a little, and "not for me" pulls the profile away.
 *   3. Anything you are "in the mood for" becomes a second profile, blended in with
 *      more pull than your history, so a craving can reshape the list.
 *   4. Each unplayed game you can actually run gets a score:
 *        taste match (cosine similarity)
 *      + how well its length fits the time you have
 *      + a small nudge for sequels or siblings of games you loved
 *   5. The top picks are spread across series so you don't get three Souls games.
 */
(function (root) {
  "use strict";

  // A console that can run games made for an older one
  var BACKWARD = { ps5: ["ps4"], xsx: ["xb1"], switch2: ["switch"] };

  var FEEL_WEIGHT = { loved: 1, fine: 0.35, disliked: -0.8 };

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
    starterCold: 0.12,
    starterWarm: 0.02
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

    return { data: data, idf: idf, vectors: vectors, byId: byId };
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

  // Which of your machines can play this game, and how
  function playableOn(game, machines) {
    var out = [];
    machines.forEach(function (m) {
      if (game.platforms.indexOf(m) !== -1) {
        out.push({ machine: m, via: null });
        return;
      }
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
    var moods = state.moods || [];
    var lengthKey = state.length || "any";

    var playedIds = {};
    played.forEach(function (p) { playedIds[p.id] = p.feel; });

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
    moods.forEach(function (t) { if (index.idf[t]) moodVec[t] = index.idf[t]; });
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
    played.forEach(function (p) {
      var g = index.byId[p.id];
      if (!g || !g.series) return;
      if (p.feel === "loved") lovedSeries[g.series] = true;
      if (p.feel === "disliked") dislikedSeries[g.series] = true;
    });

    var eligible = 0;
    var scored = [];
    games.forEach(function (g) {
      if (playedIds[g.id]) return;
      var on = playableOn(g, machines);
      if (!on.length) return;
      eligible++;

      var taste = dot(profile, index.vectors[g.id]);
      var fit = lengthFit(g.hours, lengthKey);
      var series = 0;
      if (g.series && lovedSeries[g.series]) series += WEIGHTS.sameSeriesLoved;
      if (g.series && dislikedSeries[g.series]) series += WEIGHTS.sameSeriesDisliked;
      var starter = g.starter ? (warm ? WEIGHTS.starterWarm : WEIGHTS.starterCold) : 0;

      scored.push({
        game: g,
        on: on,
        taste: taste,
        fit: fit,
        length: lengthVerdict(g.hours, lengthKey),
        score: taste + WEIGHTS.lengthFit * fit + series + starter
      });
    });

    scored.sort(function (a, b) {
      return b.score - a.score || a.game.title.localeCompare(b.game.title);
    });

    // Games that blow far past the time you have (or are far too short) only appear
    // once everything that fits has been shown; a 100-hour epic is no weekend pick
    scored = scored.filter(function (s) { return s.fit > 0; })
      .concat(scored.filter(function (s) { return s.fit === 0; }));

    // Keep the headline picks varied: one per series in the top few, two per series overall
    var picks = [];
    var deferred = [];
    var seriesCount = {};
    scored.forEach(function (s) {
      var key = s.game.series || s.game.id;
      var count = seriesCount[key] || 0;
      var cap = picks.length < topDistinct ? 1 : 2;
      if (count >= cap) {
        deferred.push(s);
        return;
      }
      if (picks.length < limit) {
        picks.push(s);
        seriesCount[key] = count + 1;
      }
    });
    for (var i = 0; i < deferred.length && picks.length < limit; i++) picks.push(deferred[i]);

    picks.forEach(function (s) { s.why = explain(index, s.game, played, moods, warm); });

    return { picks: picks, eligible: eligible, warm: warm };
  }

  // Build the "because you loved" reasoning for one game
  function explain(index, game, played, moods, warm) {
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
      cold: !warm
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
