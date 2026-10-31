#!/usr/bin/env sh
# Rebuilds harness/static/sounds/*.mp3 from Virtuosity Drums (CC0 1.0).
# Needs git and ffmpeg (with libmp3lame). Downloads only the 6 files used.
# See THIRD_PARTY.md for the source and license.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/harness/static/sounds"
COMMIT=9f04cf9a734527edfbb0a4eee1f674e45bbf71bc
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone -q --filter=blob:none --no-checkout https://github.com/sfzinstruments/virtuosity_drums.git "$TMP/vd"
cd "$TMP/vd"; git checkout -q "$COMMIT" -- LICENSE \
  Samples/kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac Samples/mid/snare/mid_snare_center_vl28.flac \
  Samples/mid/snare/mid_snare_crossstick_vl12.flac Samples/oh/hh/oh_hh_closed_vl3_rr1.flac \
  Samples/oh/hh/oh_hh_open_vl3_rr1.flac Samples/oh/ride/oh_ride_ride_vl2_rr1.flac
cp LICENSE "$OUT/LICENSE-CC0.txt"
# name, source, length (s), fade-out (s): mono, pre-hit silence trimmed,
# tail shortened with a fade, peak-normalized to -1 dBFS, 96 kbps mono MP3.
while read -r name src len fade; do
  ffmpeg -nostdin -v error -y -i "Samples/$src" -af "pan=mono|c0=0.5*c0+0.5*c1,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0,atrim=0:$len,afade=t=out:st=$(awk "BEGIN{print $len-$fade}"):d=$fade" -ar 44100 -c:a pcm_s16le "$TMP/$name.wav"
  peak=$(ffmpeg -nostdin -hide_banner -i "$TMP/$name.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p')
  ffmpeg -nostdin -v error -y -i "$TMP/$name.wav" -af "volume=$(awk "BEGIN{print -1-($peak)}")dB" -c:a libmp3lame -b:a 96k -ac 1 "$OUT/$name.mp3"
  echo "$name.mp3"
done <<'LIST'
kick kickmic/kick/kickmic_kick_snoff_vl3_rr1.flac 0.70 0.25
snare mid/snare/mid_snare_center_vl28.flac 0.70 0.30
rim mid/snare/mid_snare_crossstick_vl12.flac 0.30 0.15
hihat oh/hh/oh_hh_closed_vl3_rr1.flac 0.30 0.12
hihatOpen oh/hh/oh_hh_open_vl3_rr1.flac 1.20 0.60
ride oh/ride/oh_ride_ride_vl2_rr1.flac 1.60 0.90
LIST
