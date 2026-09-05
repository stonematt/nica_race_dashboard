# Brand

The look of this app comes from the Salem Composite Descenders design system, which lives
in the sibling repo [`stonematt/scd-brand`](https://github.com/stonematt/scd-brand)
(`DESIGN.md`, status APPROVED).

**That repo is private and this one is public.** So this document, and the `@theme` block
it describes, are the whole of the brand information available to anyone who is not the
owner. Everything below is written to be usable without `DESIGN.md` in hand.

Decided in [#13](https://github.com/stonematt/nica_race_dashboard/issues/13).

## How the tokens get here: a vendored copy

The `:root` block in `DESIGN.md` is hand-copied into the `@theme` block of
`src/app/globals.css`. Not a submodule, not a package.

The reason is the visibility split. A submodule in a public repo pointing at a private URL
fails for every clone that is not the owner's — including CI ([#28](https://github.com/stonematt/nica_race_dashboard/issues/28)),
which would need a deploy key to a private repo in order to fetch fifteen lines of CSS. A
private npm package needs a registry and a token for the same payload. The design system is
marked APPROVED and changes at roughly the rate the team reprints jerseys, so continuous
synchronisation buys nothing and costs auth on every clone.

There is no token build step. Tailwind 4's `@theme` **is** CSS custom properties and takes
OKLch natively ([#6](https://github.com/stonematt/nica_race_dashboard/issues/6)), so the
values transfer as they are; only the names change, to Tailwind's `--color-*` / `--font-*`
namespace.

## Keeping the copy honest

A copy drifts silently. Three things push back:

**The provenance line.** `globals.css` names the exact upstream commit it was taken from.
That turns "something changed" into a diff you can read:

```
git -C ../scd-brand log --oneline 25c5f87..HEAD -- DESIGN.md
```

**`pnpm brand:check`.** Parses both blocks and reports any token whose value disagrees, or
that upstream has and the copy does not. It **skips with exit 0** when `../scd-brand` is
not present, because most clones will not have it and a check that fails on a fresh clone
is a check that gets deleted.

Comparison is by **normalized value, never by character**. The copy cannot hold textual
identity: Prettier reformats it (it already turned DESIGN.md's `0.20` into `0.2`, and wraps
the long font stack), and `DESIGN.md` hand-aligns its columns. So trailing zeros,
whitespace and comma spacing are absorbed as formatting, and only real disagreement is
reported. The rule is one-directional — a token this repo adds that `DESIGN.md` does not
have is not drift.

**CI cannot do any of this**, by construction: it would need a deploy key to a private repo
from a public workflow. The comparison logic is therefore covered by ordinary unit tests
against fixture strings (`src/lib/brand-tokens.test.ts`), which do run in CI and which
prove the check can actually _detect_ drift rather than only ever passing.

## Fonts

Anton (display) and Nunito (body), self-hosted via `next/font/google` in
`src/app/layout.tsx`. Not a CDN link.

The deciding reason is operational, not aesthetic: **this app is opened at race venues** on
shared wifi, bound to loopback ([#33](https://github.com/stonematt/nica_race_dashboard/issues/33)).
A `fonts.gstatic.com` link makes every page load wait on the venue's network, and produces
a flash of fallback text or a hang on a page whose whole job is being readable in a parking
lot. `next/font` downloads the faces at build time and serves them from the app's own
origin, so the page renders correctly with the network unplugged.

Privacy agrees. [#3](https://github.com/stonematt/nica_race_dashboard/issues/3)'s posture is
`noindex` and no third-party requests; a CDN font would send every coach's IP and referer to
Google on every page view.

The cost, named so nobody is surprised by it: a cold-cache `pnpm build` needs the network
once per machine. Next caches the files after that.

The faces bind to `--font-display-face` / `--font-body-face`, which the `@theme` stacks
prepend to `DESIGN.md`'s own fallback lists. `brand:check` strips that prefix before
comparing.

## Rules that constrain code

Restated here because here is where they are enforceable. The rest of `DESIGN.md` — the
voice spec, jersey and print Pantones, the source-file inventory — stays a pointer.

- **Ink on orange, never white.** The one hard contrast rule. `globals.css` carries an
  `.on-accent` helper so a new orange surface inherits it by default rather than by
  someone remembering.
- **Orange leads as a highlight, not as a field.** Full-bleed orange is too intense to
  read against.
- **Navy ground for the banner**, with orange taking the wordmark, the rule, and the marks
  that matter — our dots on the field strip, the fastest lap, the headline number. This is
  the logo's own primary colorway and it is the map's standing palette decision
  ([#1](https://github.com/stonematt/nica_race_dashboard/issues/1)).
- Aqua is light and takes dark text. Navy and brown take white.

## Assets: what may live in this public repo

**Nothing from `scd-brand/sources/`, ever.** The `.ai` files, `SCD-Jersey-Design_20240125.pdf`
(which embeds Impact, a licensed face, plus print Pantones) and the 2024 Team Kit Design
Brief are a designer's and a vendor's working files. Not this repo's to redistribute,
regardless of visibility. This is a standing rule, not a v1 deferral.

**The logo mark and Milo are the club's own and may be committed — but neither is here
yet**, because there is nothing usable to commit:

- `logo-orange-on-white.png` is 2166×2550 RGB with **no alpha channel**. The only surface
  that would want it is the navy banner, where it would render as a white box. The
  wordmark is type instead (`src/components/Banner.tsx`), which is the real mark once Anton
  loads.
- Milo is commissioned work for the club, so publishing is settled — but the only art is
  `GuyAlone.ai` and PDF embeds. A web-ready SVG or alpha PNG has to be exported first, and
  no surface asks for one yet. The natural first home is an empty state ("no races yet this
  season"), where a mascot earns its place.

`src/app/icon.svg` is therefore **original placeholder work** in the brand colours, not the
mark. Replace it with a proper SVG traced from the `.ai` if that ever becomes worth doing.

## Reskinning this app for another club

The brand is confined to four places. Nothing else in the app reads a brand constant —
writing that down is also a test of whether it stays true.

1. **`src/app/globals.css`** — swap the `@theme` values. Colour names (`accent`, `navy`,
   `brown`, …) are used as Tailwind utilities throughout, so keep the names and change the
   values rather than renaming.
2. **`src/app/layout.tsx`** — swap the two `next/font/google` families.
3. **`src/app/icon.svg`** — the tab icon.
4. **`src/components/Banner.tsx`** — the wordmark text and the ground/highlight pairing.

Then either delete `bin/brand-check.ts` and its `brand:check` script, or repoint
`designPath` at your own source of truth. It skips silently if `../scd-brand` is absent, so
leaving it in place is harmless.

Note that this is a _reskin_, not multi-league support. The data model is Oregon-only by
decision ([#1](https://github.com/stonematt/nica_race_dashboard/issues/1), out of scope).
