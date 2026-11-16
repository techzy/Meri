#!/bin/sh
# Usage: sh finish.sh v1   -> symposium-<v>.mp4 (voice cleaned, music under it, overlay composited)
v=$1; B=build/$v
set -- $(python3 -c "import json;m=json.load(open('$B/marks.json'));print(m['HIT'],m['TOTAL'],m['VOICE_END'])"); HIT=$1; TOT=$2; VE=$3
ffmpeg -v error -y -i $B/voice.wav -i $B/music.wav -filter_complex "
[0:a]highpass=f=85,afftdn=nr=24:nf=-34:tn=1,agate=threshold=0.012:ratio=2:range=0.25:attack=4:release=160,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=-20dB:ratio=3:attack=8:release=140:makeup=3,loudnorm=I=-15:TP=-2:LRA=7,aresample=48000,pan=stereo|c0=c0|c1=c0,apad=whole_dur=$TOT,asplit[v][vs];
[1:a]loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,volume=eval=frame:volume='0.38+0.12*between(t,$HIT,$VE)+0.35*gte(t,$VE)',asplit[m][ms];
[v][m]amix=inputs=2:normalize=0:duration=longest,volume=-2.5dB,alimiter=limit=0.84:level=false,atrim=0:$TOT[a]" -map "[a]" -ar 48000 $B/mix.wav -map "[vs]" $B/stem_voice.wav -map "[ms]" $B/stem_music.wav
ffmpeg -v error -y -i $B/base.mp4 -framerate 30 -i $B/ov/f%05d.png -i $B/mix.wav -filter_complex "[0:v][1:v]overlay=format=auto,format=yuv420p[v]" -map "[v]" -map 2:a -c:v libx264 -preset slow -crf 22 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 256k -movflags +faststart -shortest symposium-$v.mp4
