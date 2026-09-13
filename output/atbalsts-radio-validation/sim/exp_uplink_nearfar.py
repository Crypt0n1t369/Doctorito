import sys, numpy as np
sys.path.insert(0, "/Users/kristaps/Documents/New project/output/atbalsts-radio-validation/sim")
import modem as M
FS=M.FS; BW=450.0; SLICES=[800.,1500.,2200.,2900.]; PAYLOAD=40

def tune(c):
    M.CENTRE_HZ=c; M.CHIRP_F0,M.CHIRP_F1=c-300.,c+300.; M.CHIRP=M._chirp()
    M.set_fft(512,64,BW); M.set_mode("time")

rng=np.random.default_rng(4)
pays=[bytes(rng.integers(0,256,PAYLOAD,dtype=np.uint8)) for _ in SLICES]
sigs=[]
for c,p in zip(SLICES,pays):
    tune(c); sigs.append(M.modulate(p))
n=max(s.size for s in sigs)

print("=== NEAR-FAR: one station close to the receiver, three far away ===")
print("   (the loud one is on the 1500 Hz slice)\n")
for d in (0,10,20,30,40):
    g=[1.,10**(d/20),1.,1.]
    okc=np.zeros(4,int)
    for t in range(5):
        r=np.random.default_rng(700+t)
        mix=np.zeros(n+4000)
        for s,gg in zip(sigs,g):
            o=r.integers(0,3000); mix[o:o+s.size]+=s*gg
        X=np.fft.rfft(mix); f=np.fft.rfftfreq(mix.size,1/FS)
        X[(f<300)|(f>3400)]=0; mix=np.fft.irfft(X,mix.size)
        p=np.mean(mix**2); mix+=r.normal(0,np.sqrt(p/10**(20/10)),mix.size)
        for i,(c,w) in enumerate(zip(SLICES,pays)):
            tune(c); got,ok=M.demodulate(mix,PAYLOAD)
            okc[i]+= (ok and got==w)
    print(f"  loud station +{d:2d} dB -> " +
          "  ".join(f"{c:.0f}Hz:{k}/5" for c,k in zip(SLICES,okc)))
