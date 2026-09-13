import json, sys, os, time
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study, modem

DRRS = [-12, -9, -6, -3, 0, 3, 6, 9, 12]
N = 120

def _one(job):
    mode, guard, cond, pl, seed = job
    modem.set_mode(mode); modem.set_guard(guard)
    import numpy as np
    rng = np.random.default_rng(seed)
    pay = bytes(rng.integers(0, 256, pl, dtype=np.uint8))
    rx = ch.apply(modem.modulate(pay), cond, rng)
    got, ok = modem.demodulate(rx, pl)
    return bool(ok and got == pay)

if __name__ == "__main__":
    t0=time.time(); out=[]
    with Pool(8) as pool:
        for mode in ("freq","time"):
            for drr in DRRS:
                c = ch.Conditions(drr_db=drr, snr_db=25.0)
                jobs=[(mode,64,c,128,abs(hash((mode,drr,i)))%10**7) for i in range(N)]
                k=sum(pool.map(_one,jobs))
                lo,hi=study.wilson(k,N)
                out.append(dict(mode=mode,drr_db=drr,ok=k,n=N,rate=k/N,lo=lo,hi=hi))
                print(f"{mode:5s} DRR {drr:+4d} dB -> {k:3d}/{N} ({k/N:5.0%})",flush=True)
    json.dump(out,open("results_mode.json","w"),indent=1)
    print("elapsed",round(time.time()-t0,1),"s")
