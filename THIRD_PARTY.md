# Third-party material

Everything here is shipped inside the app. Each entry says where it came from, its license, and what was changed.

## Virtuosity Drums (drum samples)

| | |
|---|---|
| Files | `harness/static/sounds/kick.mp3`, `snare.mp3`, `rim.mp3`, `hihat.mp3`, `hihatOpen.mp3`, `ride.mp3` |
| Source | Virtuosity Drums by Versilian Studios, https://github.com/sfzinstruments/virtuosity_drums (commit `9f04cf9a734527edfbb0a4eee1f674e45bbf71bc`). Product page: https://versilian-studios.com/virtuosity-drums/ |
| Performer | Austin McMahon, house kit at Virtuosity Musical Instruments, Boston, MA |
| License | **CC0 1.0 Universal** (public domain dedication). Full text: `harness/static/sounds/LICENSE-CC0.txt`, copied from the source repository's `LICENSE`. Commercial use and redistribution are allowed; attribution is not required. We credit the source anyway, as Versilian asks. |
| Original files | `Samples/kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac`, `Samples/mid/snare/mid_snare_center_vl28.flac`, `Samples/mid/snare/mid_snare_crossstick_vl12.flac`, `Samples/oh/hh/oh_hh_closed_vl3_rr1.flac`, `Samples/oh/hh/oh_hh_open_vl3_rr1.flac`, `Samples/oh/ride/oh_ride_ride_vl2_rr1.flac` |
| Changes | Mixed to mono; silence before each hit removed; tails shortened (0.3 to 1.6 s) with a fade-out; peak-normalized to -1 dBFS; encoded as 96 kbps mono MP3 at 44.1 kHz. Reproduce with `scripts/build-drum-samples.sh`. |

## Ear-training sounds

None. Every ear-training sound (tones, chords, clicks) is synthesized in the browser with Web Audio (`src/modules/ear/audio.ts`). No samples, no third-party audio.

## ts-fsrs (scheduling algorithm)

MIT License, Copyright (c) 2026 Open Spaced Repetition. Source, version and license: `vendor/ts-fsrs/VENDORED.md` and `vendor/ts-fsrs/LICENSE`.
