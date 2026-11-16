"""Original backing track, synthesised from scratch (no samples, nothing licensed). Output: build/music.wav"""
import json, wave, os, numpy as np
BUILD=os.environ.get("BUILD","build")
SR=48000
cap=json.load(open(BUILD+"/captions.json")); L=cap["lines"]
def line(i):   # look a caption line up by id; a line missing from a shorter cut resolves to the next one present
    c=[l for l in L if l.get("id",L.index(l))>=i]
    return c[0] if c else L[-1]
s=lambda i:line(i)["s"]-(0 if line(i).get("id",i)==i else .25)
VOICE_END=L[-1]["e"]; END_CARD=VOICE_END+cap.get("tail",2.6); TOTAL=END_CARD+cap.get("card",3.6)
ROLL=line(67)["words"][3]["s"]-0.15          # the ball starts rolling
REVEAL=L[0]["e"]+0.85                      # "8 years" lands
N=int((TOTAL+0.5)*SR); out=np.zeros((N,2),np.float32)
BEAT=60/96; BAR=4*BEAT
f=lambda m:440*2**((m-69)/12)
rng=np.random.default_rng(3)
def add(sig,t0,gain=1.0,pan=0.0):
    i=int(t0*SR)
    if i>=N or i<0: return
    sig=sig[:N-i]; l=np.cos((pan+1)*np.pi/4); r=np.sin((pan+1)*np.pi/4)
    out[i:i+len(sig),0]+=sig*gain*l; out[i:i+len(sig),1]+=sig*gain*r
def env(n,a,r):
    e=np.ones(n,np.float32); na=min(n//2,int(a*SR)); nr=min(n//2,int(r*SR))
    e[:na]=np.linspace(0,1,na)**2; e[n-nr:]=np.linspace(1,0,nr)**2; return e
def pad(m,dur):
    n=int(dur*SR); t=np.arange(n)/SR; x=0
    for det in (-0.06,0.05): x=x+np.sin(2*np.pi*f(m+det)*t)+0.25*np.sin(2*np.pi*2*f(m+det)*t)
    return (x*env(n,0.9,1.2)*0.25).astype(np.float32)
def pluck(m,dur=1.1,bright=0.3):
    n=int(dur*SR); t=np.arange(n)/SR
    x=np.sin(2*np.pi*f(m)*t)*np.exp(-t*4.2)+bright*np.sin(2*np.pi*f(m)*3*t)*np.exp(-t*11)+0.4*np.sin(2*np.pi*f(m)*2*t)*np.exp(-t*7)
    x[:96]*=np.linspace(0,1,96); return x.astype(np.float32)
def bass(m,dur):
    n=int(dur*SR); t=np.arange(n)/SR
    return ((np.sin(2*np.pi*f(m)*t)+0.2*np.sin(2*np.pi*2*f(m)*t))*env(n,0.02,0.25)).astype(np.float32)
def kick():
    n=int(0.32*SR); t=np.arange(n)/SR; ph=2*np.pi*(46*t+(110-46)*(1-np.exp(-t*30))/30)
    return (np.sin(ph)*np.exp(-t*11)).astype(np.float32)
def shaker(dur=0.06):
    n=int(dur*SR); x=rng.standard_normal(n).astype(np.float32); x=np.diff(x,prepend=0)  # crude high-pass
    return x*np.exp(-np.arange(n)/SR*70)
# Am9 - Fmaj7 - Cmaj7 - G6, two bars each
CH=[(45,[57,60,64,71]),(41,[57,60,64,69]),(48,[55,60,64,71]),(43,[55,59,62,64])]
ARP=[0,2,1,3,2,1,3,2]
bars=int(TOTAL/BAR)+1
T0=s(1)-0.3            # groove starts with the thesis line
for b in range(-2,bars):
    t0=T0+b*BAR
    if t0<-0.01 or t0>TOTAL: continue
    root,notes=CH[((b//2)%4)]
    sec = ("hook" if t0<T0 else "intro" if t0<s(6)-.3 else "ex1" if t0<s(33)-.3 else "ex2" if t0<s(53)-.3 else
           "ask" if t0<s(65)-.35 else "build" if t0<ROLL else "lift")
    if b%2==0:
        for m in notes: add(pad(m,2*BAR+1.6),t0,{"hook":.07,"intro":.06,"ex1":.045,"ex2":.04,"ask":.05,"build":.055,"lift":.06}[sec],pan=(m%5-2)*.2)
        if sec in("intro","ex1","ex2","build","lift"): add(bass(root-12 if root>43 else root,2*BAR*0.96),t0,{"intro":.16,"ex1":.18,"ex2":.2,"build":.2,"lift":.26}[sec])
    for k in range(8):
        tk=t0+k*BEAT/2
        if tk>TOTAL-1.2: continue
        if sec in("intro","ex1","ex2","lift") or (sec=="build" and k%2==0) or (sec=="ask" and k in(0,3,6)):
            m=notes[ARP[k]]+(12 if sec=="lift" else 0)
            add(pluck(m),tk,{"intro":.14,"ex1":.13,"ex2":.12,"ask":.10,"build":.11,"lift":.14}[sec],pan=.35*(1 if k%2 else -1))
            if sec=="lift" and k%2==0: add(pluck(m-12,1.4,.15),tk,.08)
        if sec in("ex2","lift") and k%2==1: add(shaker(),tk,.035 if sec=="ex2" else .05,pan=.3)
        if sec in("ex1","ex2","lift") and k in(0,5): add(kick(),tk,{"ex1":.22,"ex2":.3,"lift":.38}[sec])
        if sec=="build": add(kick(),tk,.12+.2*(tk-(s(65)-.35))/max(.1,ROLL-(s(65)-.35)))
# hook: one held chord, then a hit when "8 years" lands
for m in (45,57,60,64): add(pad(m,T0+1.5),0,.08)
for k,m in enumerate((57,64,60,69,64,72)): add(pluck(m),0.15+k*BEAT/2,.12,pan=.3*(1 if k%2 else -1))   # music is there from the first second
for m,d in ((57,0),(64,.02),(69,.04),(72,.06)): add(pluck(m,1.8,.5),REVEAL+d,.16)
add(kick(),REVEAL,.5)
# riser into the roll + hit on the roll
n=int((ROLL-(s(65)-.35))*SR); x=rng.standard_normal(n).astype(np.float32); x=np.diff(x,prepend=0); k=np.linspace(0,1,n)
y=np.zeros(n,np.float32); acc=0.0
al=0.02+0.5*k**2
for i in range(n): acc+=al[i]*(x[i]-acc); y[i]=acc
add(y*k**2,s(65)-.35,.22)
add(kick(),ROLL,.7)
for m,d in ((48,0),(60,.01),(64,.02),(67,.03),(72,.04),(76,.05)): add(pluck(m,2.6,.5),ROLL+d,.17,pan=(m%3-1)*.4)
# gentle one-pole low-pass to keep it soft, then fades
for c in range(2):
    acc=0.0; z=out[:,c]
    z[:]=np.convolve(z,np.ones(5)/5,mode="same")
fo=int(min(2.6,cap.get("card",3.6)*.8)*SR); out[-fo:]*=np.linspace(1,0,fo)[:,None]**1.5
out[:int(.3*SR)]*=np.linspace(0,1,int(.3*SR))[:,None]
out/=max(1e-6,np.abs(out).max())/0.85
w=wave.open(BUILD+"/music.wav","w"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out*32767).astype(np.int16).tobytes()); w.close()
json.dump({"VOICE_END":VOICE_END,"END_CARD":END_CARD,"TOTAL":TOTAL,"ROLL":ROLL,"REVEAL":REVEAL},open(BUILD+"/marks.json","w"))
print("music ok",TOTAL,"roll",ROLL,"reveal",REVEAL)
