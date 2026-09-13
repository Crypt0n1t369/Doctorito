"""End to end: wardens key up -> NBFM -> one receiver -> SQLite the centre queries."""
import sys, os, hmac, hashlib, sqlite3, struct, numpy as np
sys.path.insert(0,"/Users/kristaps/Documents/New project/output/atbalsts-radio-validation/sim")
import modem as M

FS_A=M.FS; UP=12; FS_I=FS_A*UP; DEV=2500.0; TAU=750e-6

# ---------- station keys: each warden gets a symmetric key, MAC truncated to 8 B
STATION_KEYS = {sid: hashlib.sha256(f"warden-{sid}".encode()).digest()
                for sid in range(1, 200)}

def pack(station, seq, rows):
    """station(2) seq(1) n(1) [id(2) state(1) places(1) rev(1)]* mac(8)"""
    b = struct.pack(">HBB", station, seq, len(rows))
    for sid, state, places, rev in rows:
        b += struct.pack(">HBBB", sid, state, places, rev)
    mac = hmac.new(STATION_KEYS[station], b, hashlib.sha256).digest()[:8]
    return b + mac

def unpack(b):
    if len(b) < 12: raise ValueError("short")
    body, mac = b[:-8], b[-8:]
    station, seq, n = struct.unpack(">HBB", body[:4])
    if station not in STATION_KEYS: raise ValueError("unknown station")
    want = hmac.new(STATION_KEYS[station], body, hashlib.sha256).digest()[:8]
    if not hmac.compare_digest(mac, want): raise ValueError("bad MAC")
    if len(body) != 4 + 5*n: raise ValueError("length mismatch")
    rows = [struct.unpack(">HBBB", body[4+5*i:9+5*i]) for i in range(n)]
    return station, seq, rows

# ---------- NBFM chain
def resample(x,up):
    X=np.fft.rfft(x); Y=np.zeros(x.size*up//2+1,complex); Y[:X.size]=X*up
    return np.fft.irfft(Y,x.size*up)
def decimate(x,dn):
    X=np.fft.rfft(x); return np.fft.irfft(X[:x.size//dn//2+1]/dn, x.size//dn)
def emph(x,fs,tau,pre):
    a=np.exp(-1/(fs*tau)); y=np.empty_like(x); px=py=0.0
    for i,s in enumerate(x):
        if pre: py=s-a*px+a*py; px=s
        else:   py=(1-a)*s+a*py
        y[i]=py
    return y*(np.max(np.abs(x))/(np.max(np.abs(y))+1e-12)) if pre else y
def nbfm(audio, cnr_db, seed):
    a=emph(audio,FS_A,TAU,True); a/=np.max(np.abs(a))+1e-12
    ph=2*np.pi*np.cumsum(DEV*resample(a,UP))/FS_I
    iq=np.exp(1j*ph)
    def iff(y):
        Y=np.fft.fft(y); f=np.fft.fftfreq(y.size,1/FS_I); Y[np.abs(f)>6250]=0
        return np.fft.ifft(Y)
    r=np.random.default_rng(seed); n=r.normal(0,1,iq.size)+1j*r.normal(0,1,iq.size)
    n*=np.sqrt(np.mean(np.abs(iff(iq))**2)/10**(cnr_db/10)/np.mean(np.abs(iff(n))**2))
    y=iff(iq+n)
    d=np.concatenate([[0],np.angle(y[1:]*np.conj(y[:-1]))*FS_I/(2*np.pi)])/DEV
    return emph(decimate(d,UP),FS_A,TAU,False)

M.CENTRE_HZ=1500.; M.CHIRP_F0,M.CHIRP_F1=700.,2300.; M.CHIRP=M._chirp()
M.set_fft(512,64,1650.); M.set_mode("time")

# ---------- six wardens report, each on its own transmission (slotted)
rng=np.random.default_rng(21)
wardens=[3,17,42,58,91,120]
truth={}
bursts=[]
for w in wardens:
    rows=[]
    for _ in range(6):
        sid=int(rng.integers(1,804)); state=int(rng.integers(0,5))
        places=int(rng.integers(0,200)); rev=int(rng.integers(1,20))
        rows.append((sid,state,places,rev)); truth[(w,sid)]=(state,places,rev)
    bursts.append(M.modulate(pack(w,1,rows)))

db=sqlite3.connect(":memory:")
db.execute("""CREATE TABLE report(station INT, shelter INT, state INT,
              places INT, revision INT, heard_at REAL, cnr REAL,
              PRIMARY KEY(station,shelter,revision))""")
db.execute("CREATE TABLE rejected(reason TEXT, heard_at REAL)")

print("Six wardens, 36 shelter updates, one shared NBFM channel\n")
print(f"{'CNR':>5}{'bursts heard':>14}{'MAC ok':>8}{'rows in DB':>12}")
for cnr in (20, 12, 8, 6, 4):
    db.execute("DELETE FROM report"); db.execute("DELETE FROM rejected")
    heard=ok=0
    t=0.0
    for k,(w,burst) in enumerate(zip(wardens,bursts)):
        gap=int(0.3*FS_A)
        air=np.concatenate([np.zeros(gap),burst,np.zeros(gap)])
        out=nbfm(air,cnr,50+k)
        got,crc=M.demodulate(out,len(pack(w,1,[(1,1,1,1)]*6)))
        if crc: heard+=1
        if not crc: continue
        try:
            st,seq,rows=unpack(bytes(got)); ok+=1
            for sid,state,places,rev in rows:
                db.execute("INSERT OR REPLACE INTO report VALUES(?,?,?,?,?,?,?)",
                           (st,sid,state,places,rev,t,cnr))
        except ValueError as e:
            db.execute("INSERT INTO rejected VALUES(?,?)",(str(e),t))
        t+=1.9
    n=db.execute("SELECT COUNT(*) FROM report").fetchone()[0]
    print(f"{cnr:>4}dB{heard:>10}/6{ok:>7}{n:>12}")

# verify the DB actually holds the truth, at a workable CNR
db.execute("DELETE FROM report")
t=0.0
for k,(w,burst) in enumerate(zip(wardens,bursts)):
    out=nbfm(np.concatenate([np.zeros(2400),burst,np.zeros(2400)]),12,50+k)
    got,crc=M.demodulate(out,len(pack(w,1,[(1,1,1,1)]*6)))
    if not crc: continue
    st,seq,rows=unpack(bytes(got))
    for sid,state,places,rev in rows:
        db.execute("INSERT OR REPLACE INTO report VALUES(?,?,?,?,?,?,?)",
                   (st,sid,state,places,rev,t,12)); t+=1.9
bad=[k for k,v in truth.items()
     if db.execute("SELECT state,places,revision FROM report WHERE station=? AND shelter=?",
                   k).fetchone() != v]
print(f"\nDB cross-checked against what the wardens actually sent: "
      f"{len(truth)-len(bad)}/{len(truth)} rows exact, {len(bad)} wrong")
print("\nWhat the centre sees (sample query -- shelters reported full):")
for row in db.execute("""SELECT shelter, places, station FROM report
                         WHERE state=4 ORDER BY shelter LIMIT 5"""):
    print(f"   shelter {row[0]:>3}  {row[1]:>3} places  reported by warden {row[2]}")
print("\nTamper check: flip one byte of a warden's transmission ->")
b=bytearray(pack(3,1,[(100,1,50,2)])); b[5]^=0x01
try: unpack(bytes(b)); print("   ACCEPTED (bad)")
except ValueError as e: print(f"   rejected: {e}")
