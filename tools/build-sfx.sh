#!/usr/bin/env bash
# Builds assets/sfx/*.mp3 from the CC0 source packs listed in assets/sfx/CREDITS.md.
# usage: tools/build-sfx.sh <dir with the unpacked source packs>   (needs ffmpeg)
set -euo pipefail
SRC="${1:?source directory}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/sfx"
TMP="$(mktemp -d)"
mkdir -p "$OUT"

# clip <out name> <source file> [start-trim threshold dB] [extra ffmpeg audio filters]
clip() {
  local name="$1" src="$SRC/$2" th="${3:--40}" extra="${4:-anull}"
  ffmpeg -v error -y -i "$src" -ac 1 -ar 44100 -af \
    "silenceremove=start_periods=1:start_threshold=${th}dB:detection=peak,areverse,silenceremove=start_periods=1:start_threshold=-48dB:detection=peak,areverse,$extra" \
    "$TMP/$name.wav"
  local peak dur
  peak=$(ffmpeg -hide_banner -i "$TMP/$name.wav" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\{0,1\}[0-9.]*\) dB.*/\1/p')
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$TMP/$name.wav")
  ffmpeg -v error -y -i "$TMP/$name.wav" \
    -af "volume=$(awk "BEGIN{print -1 - ($peak)}")dB,afade=t=out:st=$(awk "BEGIN{d=$dur-0.02; print (d>0?d:0)}"):d=0.02" \
    -codec:a libmp3lame -q:a 3 "$OUT/$name.mp3"
  printf "%-12s %5.2fs  %s\n" "$name" "$dur" "$2"
}

# impacts
clip punch_1 "punch/qubodupPunch/qubodupPunch01.flac"
clip punch_2 "punch/qubodupPunch/qubodupPunch03.flac"
clip punch_3 "punch/qubodupPunch/qubodupPunch04.flac"
clip hit_1   "hits/hits/hit22.mp3.flac" -24
clip hit_2   "hits/hits/hit24.mp3.flac" -24
clip hit_3   "hits/hits/hit37.mp3.flac" -24
clip ko      "hits/hits/hit21.mp3.flac" -24
clip block_1 "thwack/PCM/thwack-02.wav"
clip block_2 "thwack/PCM/thwack-06.wav"
clip land    "thwack/PCM/thwack-03.wav"
# swings
clip swish_1  "swishes/swishes/swish-10.wav"
clip swish_2  "swishes/swishes/swish-11.wav"
clip swish_3  "swishes/swishes/swish-12.wav"
clip swoosh_1 "swishes/swishes/swish-7.wav"
clip swoosh_2 "swishes/swishes/swish-9.wav"
clip jump     "swishes/swishes/swish-3.wav"
# ring
clip bell "cc0sfx/bell_01.ogg"
clip ding "cc0sfx/bell_02.ogg"
clip gong "cc0sfx/gong_01.ogg"
# voices
clip growl_1 "rpg/RPG Sound Pack/NPC/gutteral beast/mnstr1.wav"
clip growl_2 "rpg/RPG Sound Pack/NPC/gutteral beast/mnstr2.wav"
clip growl_3 "rpg/RPG Sound Pack/NPC/gutteral beast/mnstr3.wav"
clip growl_4 "rpg/RPG Sound Pack/NPC/gutteral beast/mnstr6.wav"
clip meow    "meow/Meow.ogg"
clip mew     "kitten/kitten_mew-1.wav"
# specials
clip magic "rpg/RPG Sound Pack/battle/magic1.wav"
clip spell "rpg/RPG Sound Pack/battle/spell.wav" -40 "atrim=0:1.5,afade=t=out:st=1.1:d=0.4"
clip quake "hits/hits/hit35.mp3.flac" -24
clip boom  "cc0sfx/explosion.ogg"
# interface
clip ui_move   "ui/Audio/select_002.ogg"
clip ui_select "ui/Audio/confirmation_001.ogg"
clip ui_back   "ui/Audio/back_001.ogg"
clip ui_pause  "ui/Audio/bong_001.ogg"
clip tick      "ui/Audio/tick_001.ogg"
# crowd
clip crowd    "crowd/crowd_shouting_0.ogg" -90 "atrim=3.4:7.2,asetpts=PTS-STARTPTS,afade=t=in:d=0.2,afade=t=out:st=2.4:d=1.4"
clip applause "applause/applause-clapping-church-crowd-immersive.wav" -90 "atrim=21:26.5,asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=3.6:d=1.9"

rm -rf "$TMP"
du -sh "$OUT"
