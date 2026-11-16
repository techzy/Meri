"""Original backing track for one version, synthesised from scratch (nothing sampled or licensed). Usage: python3 music.py v1"""
import json, sys, wave, numpy as np
v=sys.argv[1]; SR=48000
cap=json.load(open(f"build/{v}/captions.json")); L=cap["lines"]; TOTAL=cap["duration"]
by={l["id"]:l for l in L}
BODY=by[20]["s"]-0.1                       # "So I've been reading..." : groove starts after the hook
DROP=by[90]["s"]-0.1                       # "I'm telling you this idea" : music thins out
HIT=by[92]["words"][0]["s"]-0.03           # "pregnant with it" : payoff
N=int((TOTAL+0.2)*SR); out=np.zeros((N,2),np.float32); rng=np.random.default_rng(5)
BEAT=60/104; BAR=4*BEAT; f=lambda m:440*2**((m-69)/12)
def add(sig,t0,g=1.0,pan=0.0):
    i=int(t0*SR)
    if i<0 or i>=N: return
    sig=sig[:N-i]; out[i:i+len(sig),0]+=sig*g*np.cos((pan+1)*np.pi/4); out[i:i+len(sig),1]+=sig*g*np.sin((pan+1)*np.pi/4)
def env(n,a,r):
    e=np.ones(n,np.float32); na=min(n//2,int(a*SR)); nr=min(n//2,int(r*SR)); e[:na]=np.linspace(0,1,na)**2; e[n-nr:]=np.linspace(1,0,nr)**2; return e
def pad(m,d):
    n=int(d*SR); t=np.arange(n)/SR; x=sum(np.sin(2*np.pi*f(m+dt)*t)+.25*np.sin(4*np.pi*f(m+dt)*t) for dt in(-.06,.05)); return (x*env(n,.5,.9)*.25).astype(np.float32)
def pluck(m,d=1.0,br=.35):
    n=int(d*SR); t=np.arange(n)/SR; x=np.sin(2*np.pi*f(m)*t)*np.exp(-t*4.6)+br*np.sin(6*np.pi*f(m)*t)*np.exp(-t*12)+.4*np.sin(4*np.pi*f(m)*t)*np.exp(-t*7); x[:96]*=np.linspace(0,1,96); return x.astype(np.float32)
def bass(m,d):
    n=int(d*SR); t=np.arange(n)/SR; return ((np.sin(2*np.pi*f(m)*t)+.2*np.sin(4*np.pi*f(m)*t))*env(n,.02,.2)).astype(np.float32)
def kick():
    n=int(.3*SR); t=np.arange(n)/SR; return (np.sin(2*np.pi*(46*t+64*(1-np.exp(-t*30))/30))*np.exp(-t*11)).astype(np.float32)
def hat():
    n=int(.05*SR); x=np.diff(rng.standard_normal(n).astype(np.float32),prepend=0); return x*np.exp(-np.arange(n)/SR*80)
CH=[(41,[60,64,65,69]),(43,[59,62,64,67]),(40,[59,62,64,67]),(45,[60,64,67,69])]   # Fmaj7 - G6 - Em7 - Am7, one bar each
ARP=[0,2,1,3,2,3,1,2]
for b in range(-8,int(TOTAL/BAR)+2):
    t0=BODY+b*BAR
    if t0<-BAR or t0>TOTAL: continue
    root,notes=CH[b%4]
    sec="hook" if t0<BODY-.01 else "body" if t0<DROP-BAR*.5 else "drop" if t0<HIT-.05 else "lift"
    if t0>=-0.01:
        for m in notes: add(pad(m,BAR+1.0),t0,{"hook":.07,"body":.045,"drop":.06,"lift":.06}[sec],pan=(m%5-2)*.2)
        if sec in("body","lift"): add(bass(root,BAR*.92),t0,.2)
    for k in range(8):
        tk=t0+k*BEAT/2
        if tk<0 or tk>TOTAL-.5: continue
        if sec=="drop": 
            if k in(0,4): add(pluck(notes[ARP[k]]),tk,.10)
            continue
        if sec=="hook" and k%2: continue
        add(pluck(notes[ARP[k]]+(12 if sec=="lift" else 0)),tk,{"hook":.13,"body":.12,"lift":.14}[sec],pan=.35*(1 if k%2 else -1))
        if sec in("body","lift"):
            if k in(0,3,6): add(kick(),tk,.3 if sec=="body" else .36)
            if k%2==1: add(hat(),tk,.04,pan=.3)
add(kick(),HIT,.7)
for m,d in((48,0),(60,.01),(64,.02),(67,.03),(72,.04),(76,.05)): add(pluck(m,2.2,.5),HIT+d,.17,pan=(m%3-1)*.4)
for c in range(2): out[:,c]=np.convolve(out[:,c],np.ones(5)/5,mode="same")
fo=int(.9*SR); out[-fo:]*=np.linspace(1,0,fo)[:,None]**1.5; out[:int(.15*SR)]*=np.linspace(0,1,int(.15*SR))[:,None]
out/=max(1e-6,np.abs(out).max())/.85
w=wave.open(f"build/{v}/music.wav","w"); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out*32767).astype(np.int16).tobytes()); w.close()
json.dump({"HIT":HIT,"TOTAL":TOTAL,"VOICE_END":cap["voice_end"]},open(f"build/{v}/marks.json","w")); print(v,"music ok",round(TOTAL,2),"hit",round(HIT,2))
