# Vision Bench

A practice bench for choosing lighting, lenses and cameras for 2D machine vision
inspections. Fourteen customer jobs, a free bench, a simulated camera image, and an
expert setup with the reasoning behind it.

Live copy: https://claude.ai/artifact/MShQDZLhG8cpmqUVaZSLge

## Files

```
vision-bench/
├── README.md
├── vision-bench.html      built app: the file you open, host or share
└── source/
    ├── build.py           combines the source files into vision-bench.html
    ├── body.html          page skeleton (header, three columns, tab bar)
    ├── style.css          styling, light and dark themes, phone layout
    ├── model.js           data, optics, lighting model, grading, expert solver
    ├── sensor.js          simulated camera image and pixel loupe
    ├── scene.js           3D bench (three.js r128)
    └── app.js             controls, game logic, modals, tour, saving
```

## Running it

Open `vision-bench.html` in any modern browser. Nothing to install. It needs internet
access for two things only: three.js from cdnjs and the Barlow font from Google Fonts.
Everything else is inside the file.

To host it for other people, upload that one file anywhere static: GitHub Pages,
Netlify, an S3 bucket or a company intranet share. Progress is stored per browser, so
each person keeps their own stars.

## Editing it

1. Edit the files in `source/`.
2. Run `python3 build.py` from inside `source/`. Python 3, no packages needed.
3. It writes a fresh `vision-bench.html` beside the sources. Move it up a level, or
   edit the last lines of `build.py` to change where it lands.

`python3 build.py --local` writes `test.html` instead, which loads `three.min.js` from
the same folder. Drop a copy of three.js r128 there (`npm pack three@0.128.0`) if you
want to work offline.

### Load order matters

All four scripts share one scope, and `build.py` concatenates them in this order:
`model.js`, `sensor.js`, `scene.js`, `app.js`. `sensor.js` and `scene.js` call functions
from `model.js`; `app.js` uses all three. Only the part of `model.js` between the
`/*MODEL-BEGIN*/` and `/*MODEL-END*/` markers is inlined, so the `module.exports` line
after it stays out of the page and you can still test the model with Node:

```js
const M = require('./model.js');
const sol = M.solve(setupObject);   // expert setup for a given job
```

## Common changes

| Change | Where |
|---|---|
| Add a customer job | `CHALLENGES` in `model.js` |
| Add a part or defect type | `PARTS` or `DEFS` in `model.js` |
| Change hardware specs or prices | `CAMERAS`, `LENSES`, `LIGHTS` in `model.js` |
| Change how a light behaves on a surface | `RESP` in `model.js` |
| Change star thresholds (85 / 65 / 40) | end of `evaluate()` in `model.js` |
| Change job difficulty dots | `DIFF` in `app.js` |
| Colors, fonts, spacing | the token block at the top of `style.css` |

## What the model does and does not do

Optics come from real formulas: field of view from magnification, depth of field,
diffraction, motion blur, frame rate against line rate, and vignetting against the lens
image circle. Lighting is a rules-based model of how each technique behaves on each
surface class, tuned by hand. It points at the right technique and teaches the
trade-offs, but it will not predict exact contrast, and glare position does not follow
the real geometry. Check anything important on a real bench.

## Browser support

Any current Chrome, Edge, Firefox or Safari, on desktop or mobile. The 3D bench needs
WebGL; without it the camera image and grading still work and a message explains why
the bench is missing.
