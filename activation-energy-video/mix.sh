#!/bin/sh
# voice on top, music well under it; music lifts on the hook reveal, on the roll, and after the last line
ffmpeg -v error -y -i build/voice_edit.wav -i build/music.wav -filter_complex "
[0:a]highpass=f=85,equalizer=f=3200:t=q:w=1.2:g=2.5,acompressor=threshold=-20dB:ratio=3:attack=8:release=140:makeup=3,loudnorm=I=-15:TP=-2:LRA=7,aresample=48000,pan=stereo|c0=c0|c1=c0,apad=whole_dur=124.89999999999999,asplit[v][vs];
[1:a]loudnorm=I=-16:TP=-2:LRA=11,aresample=48000,volume=eval=frame:volume='0.22+0.33*between(t,3.37-0.15,3.37+0.9)+0.10*between(t,117.27,118.7)+0.45*gte(t,118.7)*min(1,(t-118.7)/0.6)',asplit[m][ms];
[v][m]amix=inputs=2:normalize=0:duration=longest,volume=-2dB,alimiter=limit=0.84:level=false,atrim=0:124.89999999999999[a]" -map "[a]" -ar 48000 build/mix.wav -map "[vs]" build/stem_voice.wav -map "[ms]" build/stem_music.wav
