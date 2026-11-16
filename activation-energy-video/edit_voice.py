"""Cut the voice memo into the punchy edit. Outputs build/voice_edit.wav + build/timeline.json"""
import json, wave, sys, os, numpy as np
BUILD=os.environ.get("BUILD","build"); SHORT=os.environ.get("MODE")=="short"
SR=48000
SP=sys.argv[1]
w=wave.open(BUILD+"/voice_clean.wav"); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
words=[x for s in json.load(open("voice_words.json")) for x in s["words"]]
# (section, start, end) in source seconds, from the word-level transcript
CLIPS=[
 ("hook",261.94,264.95),
 ("thesis",0.66,8.05),
 ("chem",13.30,23.20),
 ("phys",24.14,24.80),("phys",31.22,40.70),
 ("rel",41.32,52.02),
 ("money",58.70,65.35),
 ("fit",78.14,79.02),("fit",83.24,85.85),("fit",95.02,99.30),("fit",100.86,103.60),("fit",110.08,120.30),
 ("yt",138.72,143.25),("yt",147.18,158.25),
 ("ball",168.72,173.95),("ball",174.24,181.95),("ball",187.30,192.62),("ball",215.16,219.70),("ball",230.24,237.45),
]
if SHORT:  # 60-second Instagram cut: only the punchiest lines
    CLIPS=[("hook",261.94,264.95),("thesis",0.66,8.05),("chem",17.68,23.20),("phys",24.14,24.80),("phys",31.22,35.95),
     ("yt",138.72,143.25),("yt",147.18,151.05),("ball",171.46,173.95),("ball",174.24,176.60),("ball",187.30,190.95),("ball",215.16,219.70),("ball",230.24,237.45)]
hop=int(SR*0.01)
env=np.array([np.sqrt(np.mean(a[i:i+hop*2]**2)+1e-12) for i in range(0,len(a)-hop*2,hop)])
db=20*np.log10(env+1e-9)
thr=np.percentile(db,10)+9
sil=db<thr
print("thr",thr,"floor",np.percentile(db,10),"speech",np.percentile(db,90))
def runs(lo,hi):
    out=[];i=lo
    while i<hi:
        if sil[i]:
            j=i
            while j<hi and sil[j]: j+=1
            out.append((i,j)); i=j
        else: i+=1
    return out
def snap(t,kind):
    f=int(t*100); lo=max(0,f-35); hi=min(len(sil),f+35)
    rs=[r for r in runs(lo,hi) if r[1]-r[0]>=6]
    if rs:
        r=min(rs,key=lambda r:min(abs(r[0]-f),abs(r[1]-f)) if not (r[0]<=f<=r[1]) else 0)
        return (max(r[0],r[1]-7) if kind=="start" else min(r[1],r[0]+12))/100
    lo=max(0,f-12); hi=f+12
    return (lo+int(np.argmin(db[lo:hi])))/100
out=[]; segs=[]  # segs: (src_start, src_end, out_start)
pos=0.0; prev=None; timeline=[]
def fade(x,n=int(SR*0.012)):
    x=x.copy(); n=min(n,len(x)//2); r=np.linspace(0,1,n); x[:n]*=r; x[-n:]*=r[::-1]; return x
for sec,s,e in CLIPS:
    s2=snap(s,"start"); e2=snap(e,"end")
    gap = 0 if prev is None else ((1.25 if SHORT else 1.5) if sec=="thesis" else (0.42 if SHORT else 0.55) if sec!=prev else (0.2 if SHORT else 0.24))
    if gap: out.append(np.zeros(int(gap*SR),np.float32)); pos+=gap
    # split clip at long internal pauses and shorten them
    pieces=[]; cur=s2
    for r0,r1 in runs(int(s2*100),int(e2*100)):
        if (r1-r0)/100>0.34 and r0/100>s2+0.05 and r1/100<e2-0.05:
            pieces.append((cur,r0/100+0.10)); cur=r1/100-0.09
    pieces.append((cur,e2))
    for k,(p0,p1) in enumerate(pieces):
        x=fade(a[int(p0*SR):int(p1*SR)])
        segs.append((p0,p1,pos)); out.append(x); pos+=len(x)/SR
    timeline.append({"section":sec,"src":[s2,e2],"pieces":len(pieces)})
    print(f"{sec:7s} {s:7.2f}->{s2:7.2f}  {e:7.2f}->{e2:7.2f} pieces={len(pieces)} out_end={pos:.2f}")
    prev=sec
audio=np.concatenate(out)
def tmap(t):
    for p0,p1,o in segs:
        if p0-0.02<=t<=p1+0.02: return o+min(max(t-p0,0),p1-p0)
    return None
ow=[]
ci=0
for sec,s,e in CLIPS:
    for x in words:
        if (s-0.01<=x["s"]<e-0.05) or (x["w"].strip()=="Fitness." and sec=="fit" and s<79 ) and not any(o["w"]=="Fitness." for o in ow):
            ts=tmap(x["s"]); te=tmap(min(x["e"],e))
            if ts is None:  # word start fell in a removed pause: use next kept piece
                c=[o for p0,p1,o in segs if p0>x["s"]]; ts=min(c) if c else None
            if te is None or te<ts: te=ts+0.25
            ow.append({"w":x["w"].strip(),"s":round(ts,3),"e":round(te,3),"sec":sec,"clip":ci})
    ci+=1
wo=wave.open(BUILD+"/voice_edit.wav","w"); wo.setnchannels(1); wo.setsampwidth(2); wo.setframerate(SR)
wo.writeframes((np.clip(audio,-1,1)*32767).astype(np.int16).tobytes()); wo.close()
json.dump({"duration":pos,"segs":segs,"words":ow,"clips":timeline},open(BUILD+"/timeline.json","w"),indent=1)
print("duration",pos,"words",len(ow))
