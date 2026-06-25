# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

This is **not a code repository** — it is a documentation / notes workspace for the
terrain (지형) system of a separate Rust/Bevy game. There is no build, lint, or test
step here. The substantive content lives in:

- `map/map.md` — the canonical design document for the terrain system
  (data source, tile format & elevation decoding, coordinate math, batch download,
  local-hosting options, alternative data sources, roadmap).
- `map/aa.txt` — scratch notes.

The game's actual source files referenced throughout `map/map.md`
(`src/scenery/terrain.rs`, `src/ui.rs`, `main.rs`) **are not present in this folder** —
they belong to the game project hosted elsewhere. Do not assume they exist here.

## Working rules

- **Auto-scrap discussions into `map/map.md`.** Whenever the user discusses terrain/map
  topics in chat (tile sources, download sizing, decoding, alternative providers, etc.),
  record the key conclusions into the appropriate section of `map/map.md` immediately,
  as part of the same reply — do **not** ask "shall I scrap this?" first.
- Preserve the document's existing structure when editing:
  개요 → 대체 데이터 소스 → 동작 → 포맷 → 좌표 계산 → 일괄 다운로드 → 로컬 구동 → 로드맵.
  Keep the table of contents in sync when adding sections.
- The file is Markdown-linted in the IDE (markdownlint). Honor it: specify a language on
  fenced code blocks (use ```text for formulas/URLs), use real headings instead of bold
  pseudo-headings, and end files with a single trailing newline.

## Domain facts worth knowing

- Tiles are **Terrarium-encoded** elevation rasters, decoded as
  `height_m = R*256 + G + B/256 - 32768`. Any alternative tile source using the same
  encoding (e.g. AWS Open Terrain Tiles) is a near drop-in; Mapbox-style encoding is not.
- Full-planet download is impractical (Mapterhorn ≈ 9.8 TiB total; z13+ high-res dominates).
  Region-by-bbox extraction is the realistic path. The game currently targets LOD 12.
