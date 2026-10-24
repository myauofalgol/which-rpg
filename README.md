# Which RPG should I play next?

A small, static web page that suggests your next RPG. You tell it which RPGs you've played (and whether you loved them, thought they were fine, found them lacking, or bounced off them), which machines you own (including a Steam Deck list limited to games Valve rates Verified or Playable), and how long you want to sink into the next one, and it ranks a hand-curated catalogue of around 1,200 games with a short explanation for each pick. There's also an audit page at `catalogue.html` that lays every game out machine by machine. The footer's flag switch flips between regional game names where they differ.

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
│       ├── version.yml  bumps the footer version on every site push
│       ├── deploy.yml   builds and deploys once the version has changed
│       └── validate.yml checks the JavaScript parses on pull requests
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

**Your played games become a taste profile.** Loved games add their vector at full weight, "it was fine" adds about a third, and "not for me" subtracts — that's the verdict for a style that isn't yours. There's a fourth, "it wasn't good", for a game that fell short on its own merits: it counts as played but leaves the profile alone, so one duff strategy RPG doesn't turn the picker off strategy RPGs. What this means is that if you loved Elden Ring but disliked Skyrim, open-world exploration on its own gets pulled down while the challenge and dark-fantasy side of Elden Ring still counts.

**Moods are a second, optional profile.** If you tick "Little or no combat" and "A strong story", those tags get blended in alongside your played games (or used on their own if you haven't added any). A ticked mood pulls harder than your history does, so a craving can genuinely reshape the list; your played games still decide the pecking order among games that fit it. "Card games" favours RPGs built around cards or deck-building. The "Where it's from" group leans the list towards Japanese or Western studios. This is about who made the game rather than its style: a Japanese action RPG counts as Japanese, and a Western-made JRPG-style game counts as Western.

**You can skip a title without judging it.** The Skip button on a suggestion hides that game (and any other edition of it) from the current list without adding it to your played games, so your taste profile and the weightings stay exactly as they were. Skips are kept in the shared link, and the "Bring back skipped titles" button restores them all.

**You can ask for something different.** The "Show me something different" toggle flips the ranking away from your taste: rather than the closest matches, it favours the games least like the ones you've played, while still respecting your machines and the time you have. It appears once you've added at least one played game or a mood, and it is for when you want a change of genre instead of another game in your comfort zone.

**Each game you could actually play is scored as:**

- how closely it matches your profile (cosine similarity),
- plus how well its length fits the time you said you have,
- plus a small nudge if it shares a series with something you loved (or a penalty if it shares one with something you didn't),
- plus a tiny bonus for widely loved "starter" games, which matters most when there's nothing else to go on,
- plus a nudge for famous games, or against them, when the popularity slider is off-centre,
- minus a penalty when critics rated it poorly, if it has a review score.

**The popularity slider leans the list.** Every game carries a hand-set fame tier from 1 (a deep cut) to 4 (a household name). Sliding towards crowd-pleasers nudges the famous games up and the obscure ones down; sliding towards hidden gems does the reverse. In the middle it does nothing at all, and your taste profile still decides the order within each leaning.

**Critical reception is a soft signal, not a filter.** An edition can carry an optional critic score in its `review` field. Scores at 75 or above are left alone; below that a penalty grows as the score falls, reaching full strength at 50 or lower. Unrated games are neutral, so a Japan-only or retro title is not punished for never being reviewed. The score is kept separate from the fame tier: fame is how widely known a game is, reception is how critics received it, and the two are counted independently. A game with a mixed score carries a "Mixed reception" chip on its card, with the source and score in its tooltip; the exact figure also appears in the card's facts.

**Where review scores come from.** Each edition gets at most one critic score, picked from the first source that covers it:

1. Metacritic
2. OpenCritic
3. RPGFan
4. GameRankings (archived)
5. MobyGames critic average (not MobyScore, which mixes in player ratings)
6. Magazine reviews (Famitsu, Console XS, Sega Power, The Games Machine, CVG, and so on)
7. RPGamer
8. AllGame (archived)

Use the score for the matching edition or platform where possible, and note when an aggregate covers several platforms. Scores are normalised to 0-100 and rounded: Famitsu's 40-point score is multiplied by 2.5, and RPGamer/AllGame's five-point scores by 20. Metacritic and OpenCritic publish their own aggregates; for GameRankings and MobyGames, only use a score based on at least three critic reviews. A single magazine review is acceptable when nothing better exists; when several magazines reviewed the same edition, average their normalised scores and label the source "Magazine average", listing the magazines in the note. RPGFan is the preferred RPG-specific source and deliberately sits above the retro aggregates; RPGamer and AllGame are last resorts. Never blend different kinds of source; the one exception is averaging multiple magazine reviews. Never use user scores, Steam reviews, IMDb, or IGDB ratings. If no source applies, leave `review` off: an unrated game stays neutral.

Length is a soft preference with a hard edge: a game a little over your range just loses a few points and gets flagged as "longer than you asked for", but anything more than double (or less than half) your range is held back until everything that fits has been shown. A 100-hour Persona game is never your top pick for a weekend.

**The top three are kept varied.** Only one game per series can appear in the top three, so a Final Fantasy fan gets one Final Fantasy game and two other ideas rather than three in a row. When no mood is active, no series may take more than two slots across the whole list. That cap yields rather than shrink the list, though: if holding series-mates back would leave fewer than the full set of picks, the best of them are added back to fill it. A mood puts every game tagged with it before anything merely related; when at least three different series match the mood, the top three are still spread across those series, while fewer than three lets mood matches repeat a series.

**Backward compatibility is handled for you.** A PS5 owner sees PS4 games, an Xbox Series owner sees Xbox One games, and a Switch 2 owner sees Switch games, and each card says which version you'd be playing. That mapping lives in `BACKWARD` at the top of `recommend.js`. Tick no machines at all and there's no constraint: the whole catalogue is in play, with each card showing where the game natively runs. If you'd rather have nothing but games actually made for your machines, tick "Only games made for these machines" under the machine list; it's off by default and does nothing until at least one machine is ticked. Below it, "Hide ports from other machines" goes a step further: it keeps only games whose own machine is one you ticked, so ticking the Game Boy Advance shows GBA games rather than the SNES games that were ported to it. A game's own machine is the oldest one it shipped on that isn't a living library (PC, phones, and the current consoles never count as the oldest), so a PlayStation game ported to PC still points back at the PlayStation; cross-generation releases can set `home` by hand when the newer version is the definitive one, as Breath of the Wild does for the Switch.

**Steam Deck is its own machine, not another name for PC.** It plays PC games, but only the ones Valve currently rates Verified or Playable are offered: the rating is stored on the game as `deck` (3 for Verified, 2 for Playable) and shown as a chip on the card. PC stays the option for every computer game, including the ones Valve has not rated for Deck. With "Hide ports from other machines" ticked, Deck behaves like PC, so console ports drop out and PC-native games stay. The Deck list is deliberately partial, because a rating has to be checked per game and can change with patches; see "Where the lists stand" below.

All the weights live in the `WEIGHTS` object in `recommend.js`, so if you think length should matter more, or moods should count less, that's the place to tune.

**A game with several editions is shown once.** Where a game lists both an original and a modern edition (the Final Fantasy Pixel Remasters, Adventures of Mana), the picker treats them as one game: it shows the edition your machines can best run, favouring the modern one, and the "Prefer original releases" box in the sidebar switches it back to the original where you can still play it. Playing either edition counts as playing the game, so the other is never suggested back at you. A review score belongs to the edition it was given to, so a well-received original and a more mixed remaster (or the other way round) are judged separately.

**Emulation re-releases and collections are availability notes, not separate games.** A paid standalone release or collection can count as a platform when it is currently purchasable on a living machine; on retro machines, historical availability is enough. Subscription libraries (Nintendo Classics / Switch Online, PS Plus Classics) and closed storefronts (Wii Virtual Console, the 3DS and Wii U eShops) belong in `note`, not `platforms`, because the game is not bought on that machine. List one canonical current collection per game, such as Sega Genesis Classics for the Mega Drive games it covers; only mention a second collection when it adds a machine the first does not cover or is the only route there, and mark delisted or limited releases as such. Individually sold emulation releases (Sega Ages, Arcade Archives) are preferred over compilations when they are the only route. A collection never gets its own entry: each game inside lists the collection's platforms and names it in a note, and emulation never changes the game's `home`.

## How do I add or fix a game?

Open `js/games.js` and add an entry to the `games` array:

```js
{ id: "sea-of-stars", title: "Sea of Stars", year: 2023, origin: "west", fame: 2,
  platforms: ["pc", "ps5", "ps4", "xsx", "xb1", "switch"], deck: 3, hours: 28,
  tags: ["turn-based", "party", "jrpg", "fantasy", "retro", "cosy"],
  starter: true,
  pitch: "A gorgeous modern love letter to 16-bit RPGs, with timing-based turn-based combat." },
```

A few rules of thumb:

- **`id`** must be unique and URL-safe (lowercase letters, numbers, and hyphens), because it appears in shareable links. Changing an existing id breaks old links that include it.
- **`platforms`** uses these keys: `pc`, `ps5`, `ps4`, `ps3`, `xsx`, `xb1`, `switch2`, `switch`, `mobile`, `nes`, `snes`, `megadrive`, `megacd`, `turbografx`, `turbografxcd`, `ps1`, `saturn`, `dreamcast`, `n64`, `gamecube`, `mastersystem`, `gamegear`, `gba`, `xbox`, `xbox360`, `gb`, `gbc`, `ds`, `3ds`, `psp`, `psvita`, `ps2`, `wii`, and `wiiu`. Only list where the game is sold as a playable release; emulation re-releases and collections follow the policy above, and backward compatibility is added automatically, so a PS4 game doesn't also need `ps5`. The exception is Xbox: since only some Xbox 360 and original Xbox games run on modern consoles, the ones that do list `xb1` as well, with a note. `steamdeck` is a machine key too, but it never goes in `platforms`: use the `deck` field below. Each platform's `coverage` (`complete`, `partial` or `living`) tracks how finished its list is, and its `era` (debut year) lets the recommender work out each game's own machine; see "Where the lists stand" below.
- **`hours`** is a rough main-story figure. [HowLongToBeat](https://howlongtobeat.com/)'s "Main Story" number is a sensible source.
- **`origin`** is optional: use `"west"` for a game made by a Western studio, or `"other"` for a studio outside Japan and the West (for example, Chinese or Korean developers). Japanese studios are the default and need no field. The picker turns this into the "From Japan" and "From the West" mood options. Origin is about the studio that developed the game, not its publisher or its style, so a Western-made JRPG-style game is still `"west"`.
- **`fame`** is the 1-4 popularity tier the slider leans on. The tier names live in `fameLevels` near the top of the file (Deep cut, Known to RPG fans, Well-known, Household name) and are shown as a chip on the pick cards and the audit page, which makes sweeping for outliers easy. Edit `fameLevels` to reword them.
- **`review`** is an optional critic score for this edition, e.g. `review: { score: 58, source: "Metacritic" }`. Use a 0-100 score from the first applicable source in "Where review scores come from". A score below the `mixedBelow` cut-off in `reviewLevels` (75 by default) gets a ranking penalty and a "Mixed reception" chip; the exact score and source are shown on the card. Unrated games stay neutral, so retro and obscure titles are not punished for lacking a score. Keep it separate from `fame`: popularity and critical reception are different things.
- **`tags`** should come from the `tags` object near the top of the file. Five to eight tags per game works well; too few and the game rarely matches anything, too many and it matches everything a little.
- **`series`** is optional but worth setting for sequels, so they get grouped sensibly.
- **`aka`** is an optional list of search aliases, which is how "bg3" finds Baldur's Gate 3 and "ff7" finds every Final Fantasy VII.
- **`na`/`eu`** is an optional display name for the footer's region toggle, for the handful of games renamed between regions (like Soleil and Crusader of Centy); those games get a small gold ⇄ marker wherever they're listed, with the other name in its tooltip.
- **`note`** is an optional line shown under the platforms, handy for things like "Xbox via backward compatibility".
- **`fan`** marks a version that never had an official English release and is played via an English fan translation patch — usually a Japan-only game, but occasionally one version of a game, as with Seiken Densetsu 3, Final Fantasy II, III and V, Dragon Quest V and VI, and Mother. These are hidden behind the picker's "Fan translations" toggle — they need a patched ROM and an emulator or flashcart — and carry a chip on the audit page. Keep the original machine in `platforms` and spell the situation out in `note`.
- **`deck`** is the Steam Deck rating for the PC release: `3` for Verified, `2` for Playable. It is the only way into the picker's Steam Deck machine; don't add `steamdeck` to `platforms`. Only set it when Valve currently rates the game, and check the rating on its Steam store page, because the list deliberately stays partial rather than assuming every PC game runs. The picker shows a Verified or Playable chip wherever the field is set.
- **`home`** is an optional list of machine keys naming where a game "lives", overriding the automatic "oldest machine it shipped on" rule. Use it for cross-generation releases where the newer version is the definitive one, such as `home: ["switch"]` for Breath of the Wild or `home: ["ps4"]` for Persona 5. It only matters for the "Hide ports from other machines" toggle.
- **`of`** and **`preferred`** handle a game that also has a modern edition worth its own card. Put `of: "<base-id>"` on the modern edition (its id points at the original game's entry) and `preferred: "<edition-id>"` on the original. The picker then lists the game once — the `preferred` edition by default, the original when "Prefer original releases" is ticked — and only offers editions your machines can run. It counts the whole lineage as played together, so loving the original never brings the remaster back at you. Use it only when the modern edition earns its own entry (the Final Fantasy Pixel Remasters, Adventures of Mana), especially when the two have different review scores, as with Nier and Nier Replicant or Persona 4 and Persona 4 Golden; a remaster that is just another way to play the same game should fold into that game's `platforms` instead.
- **One entry per game.** A plain port or re-release folds into a single entry, with `platforms` listing every machine and `note` signposting the current edition (Final Fantasy IV on PSP is just a platform on the SNES entry since it's the same game). A remaster that is the definitive modern version may get its own entry, linked with `of`/`preferred` above. Genuinely different games stay separate: sequels, remakes that change how the game plays (the Final Fantasy III and IV 3D remakes, Secret of Mana and Trials of Mana's 3D remakes), and cases like Shadowrun on SNES and Mega Drive. Alternate versions of the same numbered game can still share a lineage when one should stand in for the others, as with the two 1993 Ys IV versions and Memories of Celceta. Multi-game packages never get a package entry of their own: the games inside stay as individual entries, each listing the bundle's platforms and carrying a note that names it, as with the Suikoden I & II HD Remaster. Shining Force CD is one exception: it rebuilds the two Gaidens and adds a new scenario, so it stands as a game of its own. Evolution Worlds is another: not a bundle but a single game containing abridged versions of Evolution 1 and 2.

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

`p` is the played list (`.l` loved, `.f` fine, `.b` wasn't good, `.d` not for me), `s` is the skipped list (titles hidden without changing the profile), `m` is machines (including `steamdeck` for games Valve rates Verified or Playable), `n=1` restricts to games made for those machines (ignored when no machines are chosen), `h=1` hides ports from other machines (likewise ignored with no machines chosen), `d=1` turns on "show me something different", `o=1` prefers original releases over modern remasters, `f=1` includes Japan-only games with English fan translations, `t` is the length (`short`, `medium`, `long`, or `epic`), `v` is moods (including `cards`, `gacha`, `japanese`, and `western`), and `w` is the popularity slider (0 hidden gems to 100 crowd-pleasers; omitted when it's in the middle). Because it's a hash rather than a query string, none of it is sent to GitHub's servers.

## Coming back later

Your most recent selections are also saved in your own browser using `localStorage`, so opening the page again without a saved link picks up where you left off (and the address bar is updated to match, so it can be shared). This stays on your machine; nothing is sent anywhere. If you open someone else's saved link, that link wins for the visit, and "Start over" clears what was remembered.

## Where the lists stand

Each platform in `games.js` carries a `coverage` value, and the audit page at `catalogue.html` shows it. **Complete** means every officially released North American or European RPG we know of is listed; **partial** means that sweep is still to come; **living** machines are curated modern libraries that keep growing rather than chasing completeness. New machines are added as their games come up, and start out partial until their sweep is done. Japan-only games with English fan translations are listed behind the picker's "Fan translations" toggle, marked with a chip on the audit page, so they never pad the official coverage claims.

- **Complete (official NA/EU):** Super Nintendo, Mega Drive, Master System, Game Boy, Game Boy Color, Game Gear, Nintendo Entertainment System, PlayStation 1, Saturn, Nintendo 64, GameCube, Game Boy Advance, Xbox
- **Partial:** Xbox 360, Mega-CD, Dreamcast, TurboGrafx-16, TurboGrafx-CD
- **Steam Deck (partial):** only the PC games Valve currently rates Verified or Playable. The list grows as ratings are checked; PC remains the option for every computer game.
- **Living lists:** PC, PlayStation, Xbox Series and One, Switch, mobile
- **Newly added (partial):** PlayStation 3, PlayStation 2, Nintendo DS, Nintendo 3DS, PlayStation Portable, PlayStation Vita, Wii, Wii U — dedicated RPGs only for now, until each sweep is done

## Caveats

- **Hours are approximate.** They're rough main-story figures, and side content in most of these games can easily double them.
- **Fame tiers are rough guesses.** The 1-4 fame tier is a hand-set hunch rather than sales data, so treat the slider as a lean rather than a ranking. If a result feels wrong, check the game's tier on the audit page and adjust it in `games.js`.
- **Review scores are optional and partial.** Coverage is best for well-known games; many deep cuts, retro titles, and Japan-only releases have no acceptable critic score, so they stay neutral. Scores can change as more reviews arrive, so check the source before treating one as current.
- **Platforms change.** The lists reflect what could be confirmed as of October 2026, but ports and remasters arrive constantly, so check the store before buying. The footer's `version` looks after itself: `.github/workflows/version.yml` bumps the patch number on every push that touches the site and pushes it as its own commit, then `.github/workflows/deploy.yml` builds and deploys once it sees that commit, while a hand-edited version is left alone — use that for major bumps (changes that break shared links) and minor ones (new platforms or features). Keep `updated` current for catalogue changes.
- **Steam Deck is a rating, not a platform.** The Steam Deck option lists only the PC games Valve currently rates Verified or Playable, using the `deck` field, and the list is partial until every PC entry has been checked. Nearly everything listed for PC is on Steam, but ratings vary and can change with patches, so check the store before buying; PC lists the whole computer catalogue.
- **Xbox 360 and original Xbox games on modern consoles.** Only some of these run through backward compatibility, so games that do (like Fallout: New Vegas, Morrowind, and KOTOR) list Xbox One alongside their original machine and carry a note; the rest are Xbox 360 or Xbox only.
- **Mobile is thin.** Only a handful of the classics have proper phone ports, so someone who picks only "Phone or tablet" will see a short list.
- **Fan translations are opt-in.** Japan-only games with English translation patches stay hidden until you tick "Include Japan-only games with English fan translations" in the picker; they need a patched ROM and an emulator or flashcart, and they are marked on the audit page.
- **Game Gear, Mega-CD, Dreamcast and TurboGrafx are just starting.** Only the dedicated RPGs are listed so far, so owners of any of them see a short list until each sweep is done. The TurboGrafx lists follow the North American library, as the console barely reached Europe.
- **Retro consoles are covered as their original versions.** Super Nintendo, Mega Drive, PlayStation, Saturn, Nintendo 64, GameCube, Game Boy Advance, and Xbox games list the retro console (and modern platforms too, where the same version is still sold). Where a remake or remaster is the definitive modern version it may stand as its own entry, shown in place of the original; otherwise the card's `note` names it.

## Ideas for later

- Links from each card to a store page or review.
- More games, especially for mobile and for genres that are light here, such as monster collecting and farming RPGs.
- Add the original Japanese titles, either as search aliases or as a third "Japan" option in the footer's name toggle (a `jp` field alongside `na`/`eu`). Examples: Secret of Mana / Seiken Densetsu 2, Suikoden / Genso Suikoden, Etrian Odyssey / Sekaiju no Meikyu.
- Add themes which mimic UI windows for other RPGs (The default looks like Final Fantasy).
- Note which PC games run natively on macOS or Linux, for players without a Windows machine. Keep "PC" as the machine and flag only the exceptions, rather than splitting PC into Windows, Mac and Linux.
- Keep the Steam Deck ratings fresh with a small script that checks Valve's compatibility report for each PC entry, so the partial list can grow without hand-checking every store page.
