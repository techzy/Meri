"""Align hand-checked caption text to word timings of the edited voice track."""
import json, re, sys, wave, difflib, numpy as np
from faster_whisper import WhisperModel
w=wave.open("build/check16k.wav"); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
m=WhisperModel("small.en",device="cpu",compute_type="int8")
segs,_=m.transcribe(a,word_timestamps=True,vad_filter=False)
hw=[{"w":x.word.strip(),"s":x.start,"e":x.end} for s in segs for x in s.words]
norm=lambda s:re.sub(r"[^a-z0-9]","",s.lower())
lines=[l.strip() for l in open("captions.txt") if l.strip()]
cw=[(li,wd) for li,l in enumerate(lines) for wd in l.split()]
A=[norm(x[1]) for x in cw]; B=[norm(x["w"]) for x in hw]
sm=difflib.SequenceMatcher(None,A,B,autojunk=False)
t=[None]*len(cw)
for blk in sm.get_matching_blocks():
    for k in range(blk.size): t[blk.a+k]=(hw[blk.b+k]["s"],hw[blk.b+k]["e"])
miss=[cw[i][1] for i in range(len(cw)) if t[i] is None]
print("unmatched caption words:",miss)
print("heard-but-not-captioned:",[B[j] for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag!="equal" for j in range(j1,j2)])
# interpolate unmatched
for i in range(len(cw)):
    if t[i] is None:
        p=i-1
        while p>=0 and t[p] is None: p-=1
        n=i+1
        while n<len(cw) and t[n] is None: n+=1
        ps=t[p][1] if p>=0 else 0; ns=t[n][0] if n<len(cw) else ps+0.4
        k=n-p-1; j=i-p-1
        t[i]=(ps+(ns-ps)*j/k, ps+(ns-ps)*(j+1)/k)
# whisper skips the isolated word "Fitness." in the edit; take its position from the cut list
tl=json.load(open("build/timeline.json"))
fs=[(o,o+(p1-p0)) for p0,p1,o in tl["segs"] if 78.0<p0<78.3][0]
for i in range(len(cw)):
    if cw[i][1]=="Fitness.": t[i]=(fs[0]+0.08,fs[1]-0.1)
out=[]
for li,l in enumerate(lines):
    ws=[{"w":cw[i][1],"s":round(t[i][0],3),"e":round(t[i][1],3)} for i in range(len(cw)) if cw[i][0]==li]
    out.append({"text":l,"s":ws[0]["s"],"e":ws[-1]["e"],"words":ws})
for i in range(len(out)-1):
    assert out[i]["s"]<=out[i+1]["s"], (out[i],out[i+1])
dur=len(a)/16000
json.dump({"duration":dur,"lines":out},open("build/captions.json","w"),indent=1)
for o in out: print(f"{o['s']:7.2f} {o['e']:7.2f}  {o['text']}")
print("dur",dur)
