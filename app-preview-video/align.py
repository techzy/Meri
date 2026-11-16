"""Align hand-written captions (versions/<v>.txt, "id|text") to the cut voice track. Usage: python3 align.py v1"""
import json, re, sys, wave, difflib, numpy as np
from faster_whisper import WhisperModel
v=sys.argv[1]
w=wave.open(f"build/{v}/voice.wav"); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
m=WhisperModel("small.en",device="cpu",compute_type="int8")
segs,_=m.transcribe(a[::3],word_timestamps=True,vad_filter=False)
hw=[{"w":x.word.strip(),"s":x.start,"e":x.end} for s in segs for x in s.words]
norm=lambda s:re.sub(r"[^a-z0-9]","",s.lower().replace("plato's","plato"))
raw=[l.strip().split("|",1) for l in open(f"versions/{v}.txt") if l.strip()]
cw=[(li,wd) for li,(i,l) in enumerate(raw) for wd in l.split()]
A=[norm(x[1]) for x in cw]; B=[norm(x["w"]) for x in hw]
sm=difflib.SequenceMatcher(None,A,B,autojunk=False); t=[None]*len(cw)
for blk in sm.get_matching_blocks():
    for k in range(blk.size): t[blk.a+k]=(hw[blk.b+k]["s"],hw[blk.b+k]["e"])
print(v,"unmatched:",[cw[i][1] for i in range(len(cw)) if t[i] is None],"| extra heard:",[B[j] for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag!="equal" for j in range(j1,j2)])
for i in range(len(cw)):
    if t[i] is None:
        p=i-1
        while p>=0 and t[p] is None: p-=1
        n=i+1
        while n<len(cw) and t[n] is None: n+=1
        ps=t[p][1] if p>=0 else 0; ns=t[n][0] if n<len(cw) else ps+0.4; k=n-p-1; j=i-p-1
        t[i]=(ps+(ns-ps)*j/k, ps+(ns-ps)*(j+1)/k)
tl=json.load(open(f"build/{v}/timeline.json")); out=[]
for li,(i,l) in enumerate(raw):
    ws=[{"w":cw[k][1],"s":round(t[k][0],3),"e":round(t[k][1],3)} for k in range(len(cw)) if cw[k][0]==li]
    out.append({"id":int(i),"text":l,"s":ws[0]["s"],"e":ws[-1]["e"],"words":ws})
for x,y in zip(out,out[1:]): assert x["s"]<=y["s"],(x,y)
json.dump({"duration":tl["duration"],"voice_end":tl["voice_end"],"version":v,"lines":out},open(f"build/{v}/captions.json","w"),indent=1)
print("  "+" / ".join(f"{o['s']:.2f} {o['text']}" for o in out))
