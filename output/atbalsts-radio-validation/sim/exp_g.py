"""Experiment G -- payload size at a MARGINAL point (DRR +6 dB, SNR +12 dB).
At a comfortable point every size decodes; the trade-off only appears at the edge."""
import json, sys, os, time
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study
if __name__ == "__main__":
    t0=time.time(); out=[]
    with Pool(8) as pool:
        for drr, snr in [(6,12),(6,10),(9,8)]:
            print(f"--- DRR {drr:+d} dB, babble SNR {snr:+d} dB ---")
            for pl in (85,128,170,255):
                c=ch.Conditions(drr_db=drr,snr_db=snr,noise="babble")
                k,n=study.run(c,n=120,guard=64,payload_len=pl,mode="time",
                              seed0=abs(hash((drr,snr,pl)))%10**6,pool=pool)
                lo,hi=study.wilson(k,n); b=study.burst_seconds(64,pl)
                out.append(dict(drr_db=drr,snr_db=snr,payload=pl,ok=k,n=n,rate=k/n,
                                lo=lo,hi=hi,burst_s=round(b,3)))
                print(f"  {pl:3d}-byte payload  burst {b:.2f}s -> {k:3d}/{n} ({k/n:5.0%})",flush=True)
    json.dump(out,open("results_g.json","w"),indent=1)
    print("elapsed",round(time.time()-t0,1),"s")
