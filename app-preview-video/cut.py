"""Cut one version of the Symposium video. Usage: python3 cut.py v1|v2|v3 <source.mp4>
Writes build/<v>/voice.wav, build/<v>/base.mp4 (1080x1920, no audio) and build/<v>/timeline.json.
All cuts are on the 30 fps frame grid so picture and sound stay locked."""
import sys, json, wave, subprocess, os, numpy as np
VER, SRC = sys.argv[1], sys.argv[2]
SR, FPS = 48000, 30
C = {  # name: (start, end) seconds in the source
 "E2a":(20.78,23.12), "E2b":(23.58,25.18),            # "you can either be pregnant in the head, or" / "pregnant in the body" (the pause between is cut)
 "A":(0.52,6.42), "B":(6.45,11.13), "C":(11.13,14.47), "D":(14.47,17.12), "Dhook":(15.08,17.12),
 "E1":(17.14,19.24), "E1b":(17.56,19.24),             # "(and) there's two types of immortality" (the stumble after it is cut)
 "F":(25.48,27.72), "G":(28.60,32.92), "H":(34.50,37.62), "Hhook":(36.16,37.62),
}
V = {  # (clip, zoom)
 "v1":[("E2a",1.0),("E2b",1.0),("A",1.1),("B",1.0),("C",1.1),("D",1.0),("E1",1.1),("F",1.0),("G",1.1),("H",1.18)],
 "v2":[("Hhook",1.15),("A",1.0),("B",1.1),("C",1.0),("D",1.1),("E1",1.0),("E2a",1.1),("E2b",1.1),("F",1.0),("G",1.1),("H",1.18)],
 "v3":[("Dhook",1.12),("A",1.0),("E1b",1.1),("E2a",1.0),("E2b",1.0),("F",1.1),("G",1.0),("H",1.16)],
}[VER]
out=f"build/{VER}"; os.makedirs(out,exist_ok=True)
w=wave.open("build/src48k.wav"); a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
hop=SR//100
db=np.array([20*np.log10(np.sqrt(np.mean(a[i:i+2*hop]**2))+1e-9) for i in range(0,len(a)-2*hop,hop)])
sil=db<np.percentile(db,10)+7
fr=lambda t:round(t*FPS)
pieces=[]   # (start_frame, end_frame, zoom, clip)
for name,z in V:
    s,e=C[name]; cur=s; i=int(s*100)
    while i<int(e*100):          # shorten pauses longer than 0.3 s inside a clip
        if sil[i]:
            j=i
            while j<int(e*100) and sil[j]: j+=1
            if (j-i)/100>0.30 and i/100>s+0.1 and j/100<e-0.1:
                pieces.append((fr(cur),fr(i/100+0.09),z,name)); cur=j/100-0.08
            i=j
        else: i+=1
    pieces.append((fr(cur),fr(e),z,name))
pieces=[p for p in pieces if p[1]>p[0]]
aud=[]; pos=0; tl=[]
for f0,f1,z,name in pieces:
    x=a[f0*SR//FPS:f1*SR//FPS].copy(); n=int(SR*0.008); r=np.linspace(0,1,n); x[:n]*=r; x[-n:]*=r[::-1]
    tl.append({"clip":name,"src":[f0/FPS,f1/FPS],"out":pos/FPS,"zoom":z}); aud.append(x); pos+=f1-f0
TAIL=20  # frames: hold the last frame for the music to land
aud.append(np.zeros(TAIL*SR//FPS,np.float32))
audio=np.concatenate(aud)
wo=wave.open(out+"/voice.wav","w"); wo.setnchannels(1); wo.setsampwidth(2); wo.setframerate(SR); wo.writeframes((np.clip(audio,-1,1)*32767).astype(np.int16).tobytes()); wo.close()
# picture: trim each piece, punch in around the face, concat
fc=[]; labels=[]
for k,(f0,f1,z,name) in enumerate(pieces):
    W=int(round(1080*z/2)*2); H=int(round(1920*z/2)*2)
    cx=int((W-1080)*0.56); cy=int((H-1920)*0.47)       # keep the face where it was
    fc.append(f"[0:v]trim=start_frame={f0}:end_frame={f1},setpts=PTS-STARTPTS,scale={W}:{H}:flags=lanczos,crop=1080:1920:{cx}:{cy},setsar=1[p{k}]"); labels.append(f"[p{k}]")
fc.append("".join(labels)+f"concat=n={len(pieces)}:v=1:a=0,unsharp=5:5:0.5,tpad=stop_mode=clone:stop={TAIL},fps={FPS}[v]")
subprocess.run(["ffmpeg","-v","error","-y","-i",SRC,"-filter_complex",";".join(fc),"-map","[v]","-c:v","libx264","-preset","medium","-crf","14","-pix_fmt","yuv420p",out+"/base.mp4"],check=True)
dur=(pos+TAIL)/FPS
json.dump({"duration":dur,"voice_end":pos/FPS,"pieces":tl},open(out+"/timeline.json","w"),indent=1)
print(VER,"pieces",len(pieces),"duration",round(dur,2))
for p in tl: print(f"  {p['out']:6.2f}  {p['clip']:6s} src {p['src'][0]:.2f}-{p['src'][1]:.2f} z{p['zoom']}")
