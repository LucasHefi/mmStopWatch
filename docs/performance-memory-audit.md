# Memory and rendering audit

Measured on Linux with WebKitGTK 4.1 in a 900 × 600 window. Values were read
after the process had settled; PSS is the useful metric for memory shared by
WebKit and GTK, while RSS is what most process monitors display.

## Results

| Scenario | Host RSS / PSS | Renderer RSS / PSS | Renderer CPU |
| --- | ---: | ---: | ---: |
| Empty Tauri window, no React | 197 / 76 MB | 193 / 85 MB | <1% |
| Original development UI | ~213 MB RSS | 857–873 MB RSS | 55–95% |
| Original release UI | ~203 MB RSS | ~663 / 550 MB | ~57% |
| Original isolated notes list | ~214 MB RSS | ~863 MB RSS | ~26% |
| Virtualized notes list | ~215 / 89 MB | ~272 / 157 MB | ~7% |
| Optimized complete development UI | ~215 / 89 MB | ~284 / 168 MB | ~17% |
| Optimized complete release UI | ~201 / 75 MB | ~259 / 144 MB | ~11% |

The optimized release is stable around 219 MB total PSS. The renderer RSS is
about 61% lower than the previous release measurement.

## What caused the high usage

1. Every note was mounted as its own Framer Motion tree. On a large vault this
   dominated renderer memory. `content-visibility` did not remove those nodes.
2. Animated SVG paths and moving CSS gradients are expensive in WebKitGTK.
   Some compound-path and gradient experiments grew beyond 1.3 GB and were
   rejected during testing.
3. Every running timer previously caused frequent React state updates and
   repeated store lookups. Repeated backdrop blur on cards added more
   compositing work.
4. The Linux Tauri host and an empty WebKit renderer already use about 160 MB
   total PSS before application UI or data is loaded.

## Implemented budget

- The notes list is virtualized and mounts only the visible rows plus overscan.
- The background uses a fixed low-resolution canvas and three pre-rendered glow
  sprites. Its memory is bounded and it pauses while the document is hidden.
- Timer text updates at 30 FPS directly in the DOM. React-derived progress and
  remaining-time state updates four times per second with CSS interpolation.
- Repeated card/sidebar backdrop filters and whole-row pulse animations were
  replaced with gradients, shadows and tiny isolated status animations.
- Linux WebKit disables unused WebGL, WebAudio, page cache, media-source,
  encrypted-media and legacy offline database features. HTML audio remains
  available for timer alerts.

## The 100 MB target

The current Tauri/WebKit architecture cannot meet a hard 100 MB process limit
on this Linux system: an empty window already reports about 390 MB combined RSS
and 160 MB combined PSS. More React or CSS tuning cannot cross that platform
floor.

To make 100 MB a realistic acceptance target, create a native UI proof of
concept without WebKit. Slint is the preferred candidate because it is a
declarative Rust desktop toolkit with lightweight software and GPU renderers.
The proof of concept should reuse a new Rust domain crate for timers, Markdown
storage and configuration, then validate these scenarios before migration:

- clean launch with no vault;
- vault with at least 1,000 notes;
- one and ten simultaneous running timers;
- animated background enabled for 30 minutes;
- total RSS below 100 MB and stable PSS with no upward trend.

Until that renderer migration, the practical release budget for the current
stack is 250 MB total PSS on Linux, with the renderer below 300 MB RSS.
