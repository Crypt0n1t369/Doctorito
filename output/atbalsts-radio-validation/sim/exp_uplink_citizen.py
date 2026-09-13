"""A citizen's report: what is it, how big, how long on air, how many fit."""
import sys, math, numpy as np
sys.path.insert(0,"/Users/kristaps/Documents/New project/output/atbalsts-radio-validation/sim")
import modem as M
FS=M.FS

# --- how many bits does a citizen report actually need?
# Latvia bounding box
lat0, lat1 = 55.67, 58.09
lon0, lon1 = 20.97, 28.24
km_lat = (lat1-lat0)*111.0
km_lon = (lon1-lon0)*111.0*math.cos(math.radians(56.9))
for cell_m in (100, 250):
    n_lat = km_lat*1000/cell_m; n_lon = km_lon*1000/cell_m
    bits = math.ceil(math.log2(n_lat)) + math.ceil(math.log2(n_lon))
    print(f"location at {cell_m:>3} m resolution: {n_lat:.0f} x {n_lon:.0f} cells "
          f"-> {bits} bits ({bits/8:.1f} bytes)")

FIELDS = [("device pseudonym", 3), ("what happened (category)", 1),
          ("how bad (severity)", 1), ("location, 100 m grid", 3),
          ("minutes since bulletin", 1)]
body = sum(n for _, n in FIELDS)
print("\ncitizen report:")
for k, n in FIELDS: print(f"  {k:<26}{n} byte{'s' if n>1 else ''}")
print(f"  {'short MAC (anti-spam)':<26}8 bytes")
total = body + 8
print(f"  {'':<26}{'-'*7}\n  {'total':<26}{total} bytes")

def tune(c, bw):
    M.CENTRE_HZ=c; M.CHIRP_F0,M.CHIRP_F1=c-bw*0.65,c+bw*0.65; M.CHIRP=M._chirp()
    M.set_fft(512,64,bw); M.set_mode("time")

tune(1500., 1650.)
for n, label in [(total, "one report"), (total+9, "two reports in one press"),
                 (total+27, "four reports in one press")]:
    t = M.modulate(bytes(n)).size/FS
    print(f"\n{label:<26}{n:>3} bytes -> {t:.2f} s on air  (+0.35 s key-up = {t+0.35:.2f} s)")

# --- how many citizens can one local receiving point absorb?
TX = M.modulate(bytes(total)).size/FS + 0.35
print(f"\nOne local receiving point, {TX:.2f} s per report:")
print(f"  back to back            : {60/TX:.0f} reports/minute")
print(f"  at 18% loading (people not coordinating): {60/TX*0.18:.0f} reports/minute")
print(f"  -> a town of 5000 where 2% report in the first hour = "
      f"{5000*0.02:.0f} reports, needs {5000*0.02*TX/60/0.18:.0f} min")

# --- does it still decode when many report at once on 4 sub-channels?
print("\nFour citizens keying up together on four sub-channels:")
BW=450.; SL=[800.,1500.,2200.,2900.]
rng=np.random.default_rng(9)
pays=[bytes(rng.integers(0,256,total,dtype=np.uint8)) for _ in SL]
sigs=[]
for c,p in zip(SL,pays):
    tune(c,BW); sigs.append(M.modulate(p))
n=max(s.size for s in sigs)
okc=0
for t in range(6):
    r=np.random.default_rng(400+t); mix=np.zeros(n+4000)
    for s in sigs:
        o=r.integers(0,2500); mix[o:o+s.size]+=s
    X=np.fft.rfft(mix); f=np.fft.rfftfreq(mix.size,1/FS)
    X[(f<300)|(f>3400)]=0; mix=np.fft.irfft(X,mix.size)
    p=np.mean(mix**2); mix+=r.normal(0,np.sqrt(p/10**(12/10)),mix.size)
    for c,w in zip(SL,pays):
        tune(c,BW); g,ok=M.demodulate(mix,total); okc += (ok and g==w)
print(f"  {okc}/24 recovered at 12 dB SNR")
