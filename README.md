# Which RPG should I play next?

A small, static web page that suggests your next RPG. You tell it which RPGs you've played (and whether you loved them, thought they were fine, or bounced off them), which machines you own, and how long you want to sink into the next one, and it ranks a hand-curated catalogue of around 365 games with a short explanation for each pick. There's also an audit page at `catalogue.html` that lays every game out machine by machine.

There's no build step, no framework, and no server: just HTML, CSS, and a few plain JavaScript files, which makes it a perfect fit for GitHub Pages.

## What's in the folder?

```bash
which-rpg/
├── index.html          the picker page
├── catalogue.html      the audit page: every game, machine by machine
├── favicon.svg         the little gold menu cursor in the browser tab
├── README.md           this file
├── .nojekyll           tells GitHub Pages to serve the files as they are
├── .github/
│   └── workflows/
│       └── version.yml bumps the footer version on every site push
├── css/
│   └── style.css       all the styling
└── js/
    ├── games.js        the catalogue: games, platforms, hours, tags, and the version
    ├── recommend.js    the scoring engine (no DOM, so it runs in Node too)
    ├── catalogue.js    renders the audit page
    └── app.js          wires the page up and keeps state in the URL
```

The split is deliberate. `games.js` is the file you'll edit most, so it sits on its own; `recommend.js` has no knowledge of the page, which means you can test the maths in isolation; and `app.js` only deals with rendering and events.

## How do I try it locally?

Because the scripts are loaded with ordinary `<script>` tags rather than ES modules, you can simply double-click `index.html` and it works straight from your file system. If you'd rather run it the way GitHub will serve it, any static server does the job:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## How does the recommending work?

So under the hood, this is a small content-based recommender, the same broad idea as "people who liked this also liked that", except the similarity comes from describing each game rather than from other people's behaviour.

**Every game is a set of tags.** Things like `turn-based`, `open-world`, `choices`, `dark-fantasy`, or `social`. Each tag is weighted by how rare it is across the catalogue (inverse document frequency, damped so it doesn't go wild), because sharing a rare trait such as `roguelite` or `no-combat` says far more about two games than both being `fantasy`. Each game's weighted tags are then normalised into a unit vector.

**Your played games become a taste profile.** Loved games add their vector at full weight, "it was fine" adds about a third, and "not for me" subtracts. What this means is that if you loved Elden Ring but disliked Skyrim, open-world exploration on its own gets pulled down while the challenge and dark-fantasy side of Elden Ring still counts.

**Moods are a second, optional profile.** If you tick "Little or no combat" and "A strong story", those tags get blended in alongside your played games (or used on their own if you haven't added any). A ticked mood pulls harder than your history does, so a craving can genuinely reshape the list; your played games still decide the pecking order among games that fit it.

**Each game you could actually play is scored as:**

- how closely it matches your profile (cosine similarity),
- plus how well its length fits the time you said you have,
- plus a small nudge if it shares a series with something you loved (or a penalty if it shares one with something you didn't),
- plus a tiny bonus for widely loved "starter" games, which matters most when there's nothing else to go on.

Length is a soft preference with a hard edge: a game a little over your range just loses a few points and gets flagged as "longer than you asked for", but anything more than double (or less than half) your range is held back until everything that fits has been shown. A 100-hour Persona game is never your top pick for a weekend.

**The top three are kept varied.** Only one game per series can appear in the top three, so a Souls fan gets one Souls game and two other ideas rather than three FromSoftware titles in a row.

**Backward compatibility is handled for you.** A PS5 owner sees PS4 games, an Xbox Series owner sees Xbox One games, and a Switch 2 owner sees Switch games, and each card says which version you'd be playing. That mapping lives in `BACKWARD` at the top of `recommend.js`. Tick no machines at all and there's no constraint: the whole catalogue is in play, with each card showing where the game natively runs.

All the weights live in the `WEIGHTS` object in `recommend.js`, so if you think length should matter more, or moods should count less, that's the place to tune.

## How do I add or fix a game?

Open `js/games.js` and add an entry to the `games` array:

```js
{ id: "sea-of-stars", title: "Sea of Stars", year: 2023,
  platforms: ["pc", "ps5", "ps4", "xsx", "xb1", "switch"], hours: 28,
  tags: ["turn-based", "party", "jrpg", "fantasy", "retro", "cosy"],
  starter: true,
  pitch: "A gorgeous modern love letter to 16-bit RPGs, with timing-based turn-based combat." },
```

A few rules of thumb:

- **`id`** must be unique and URL-safe (lowercase letters, numbers, and hyphens), because it appears in shareable links. Changing an existing id breaks old links that include it.
- **`platforms`** uses these keys: `pc`, `ps5`, `ps4`, `xsx`, `xb1`, `switch2`, `switch`, `mobile`, `snes`, `megadrive`, `ps1`, `saturn`, `n64`, `gamecube`, `mastersystem`, and `gba`. Only list where the game is sold natively; backward compatibility is added automatically, so a PS4 game doesn't also need `ps5`. Each platform's `coverage` (`complete`, `partial` or `living`) tracks how finished its list is; see "Where the lists stand" below.
- **`hours`** is a rough main-story figure. [HowLongToBeat](https://howlongtobeat.com/)'s "Main Story" number is a sensible source.
- **`tags`** should come from the `tags` object near the top of the file. Five to eight tags per game works well; too few and the game rarely matches anything, too many and it matches everything a little.
- **`series`** is optional but worth setting for sequels, so they get grouped sensibly.
- **`aka`** is an optional list of search aliases, which is how "bg3" finds Baldur's Gate 3 and "ff7" finds every Final Fantasy VII.
- **`note`** is an optional line shown under the platforms, handy for things like "Xbox via backward compatibility".

If you add a new tag, give it a `label` that reads naturally after "it has" (the cards say things like "Like Baldur's Gate 3, it has choices that matter"), and add a `mood` and `group` if you want it offered as an "In the mood for" option.

There's no automated test suite, but because `recommend.js` doesn't touch the page you can sanity-check the catalogue from Node:

```bash
node -e '
global.window = {};
require("./js/games.js");
const R = require("./js/recommend.js");
const idx = R.buildIndex(window.RPG_DATA);
const r = R.recommend(idx, {
  played: [{ id: "bg3", feel: "loved" }],
  machines: ["pc"], length: "long", moods: []
});
r.picks.forEach(p => console.log(p.game.title, p.score.toFixed(2)));
'
```

## Sharing picks

Everything you choose is kept in the address bar, so the "Copy link to these picks" button gives you a link that reopens the page in exactly the same state. The format is deliberately readable:

```bash
#p=bg3.l,dos2.l,skyrim.d&m=pc,ps5&t=long&v=sci-fi
```

`p` is the played list (`.l` loved, `.f` fine, `.d` not for me), `m` is machines, `t` is the length (`short`, `medium`, `long`, or `epic`), and `v` is moods. Because it's a hash rather than a query string, none of it is sent to GitHub's servers.

## Coming back later

Your most recent selections are also saved in your own browser using `localStorage`, so opening the page again without a saved link picks up where you left off (and the address bar is updated to match, so it can be shared). This stays on your machine; nothing is sent anywhere. If you open someone else's saved link, that link wins for the visit, and "Start over" clears what was remembered.

## Where the lists stand

Each platform in `games.js` carries a `coverage` value, and the audit page at `catalogue.html` shows it. **Complete** means every officially released North American or European RPG we know of is listed; **partial** means that sweep is still to come; **living** machines are curated modern libraries that keep growing rather than chasing completeness. New machines are added as their games come up, and start out partial until their sweep is done. English fan translations are part of the plan for the retro machines, but are not listed yet.

- **Complete (official NA/EU):** Super Nintendo, Mega Drive, Master System, PlayStation 1, Saturn, Nintendo 64, GameCube, Game Boy Advance
- **Partial:** none right now
- **Living lists:** PC, PlayStation, Xbox, Switch, mobile

## Caveats

- **Hours are approximate.** They're rough main-story figures, and side content in most of these games can easily double them.
- **Platforms change.** The lists reflect what could be confirmed as of October 2026, but ports and remasters arrive constantly, so check the store before buying. The footer's `version` looks after itself: the workflow in `.github/workflows/version.yml` bumps the patch number on every push that touches the site, while a hand-edited version is left alone — use that for major bumps (changes that break shared links) and minor ones (new platforms or features). Keep `updated` current for catalogue changes.
- **"PC or Steam Deck" is one option.** Nearly everything listed for PC is on Steam, but Steam Deck compatibility varies by game, so check its Deck rating.
- **Xbox 360 era games** like Fallout: New Vegas and Dragon Age: Origins are listed under Xbox One because they run through backward compatibility on both Xbox One and Series consoles.
- **Mobile is thin.** Only a handful of the classics have proper phone ports, so someone who picks only "Phone or tablet" will see a short list.
- **Retro consoles are covered as their original versions.** Super Nintendo, Mega Drive, PlayStation, Saturn, and Nintendo 64 games list the retro console (and modern platforms too, where the same version is still sold); where a remake or remaster exists, the card's note points to it.

## Ideas for later

- Links from each card to a store page or review.
- A "show me something different" toggle that deliberately picks games far from your profile.
- More games, especially for mobile and for genres that are light here, such as monster collecting and farming RPGs.
