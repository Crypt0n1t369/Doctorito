"""Reproduce the receiver-log statistics without copying device identifiers."""
import json
import math
from pathlib import Path

SOURCE = Path('/Users/kristaps/Downloads/atbalsts-log-3ikpsj6w.json')

def analyze(path=SOURCE):
    data = json.loads(Path(path).read_text())
    rx, capture = data['decode'], data['input']
    duration = capture['activeSeconds']
    assert duration > 0
    assert rx['framesOk'] + rx['framesFailed'] == rx['burstsHeard']
    assert math.isclose(rx['verifiedBitsPerSecond'], 8 * rx['verifiedBytes'] / duration, abs_tol=0.1)
    assert math.isclose(rx['decodeRate'], rx['framesOk'] / rx['burstsHeard'], abs_tol=0.001)
    assert len(data['levels']) == capture['levelSamples']
    assert all(a['t'] <= b['t'] for a,b in zip(data['levels'], data['levels'][1:]))
    high = [x for x in data['levels'] if x['peak'] > 1]
    # Protocol inspected at GitHub 5d6da0a: 4-byte body header, 5-byte status record,
    # 64-byte signature, 112 object bytes per transport frame. This log has one object.
    assert rx['objectsVerified'] == 1
    assert rx['verifiedBytes'] == 4 + 5 * rx['recordsApplied']
    stats = {
      'session': data['session'], 'exported_utc': data['generated'],
      'active_seconds': duration, 'first_object_seconds': rx['firstObjectSeconds'],
      'detected_bursts': rx['burstsHeard'], 'frames_ok': rx['framesOk'],
      'frames_failed': rx['framesFailed'],
      'detected_frame_success_fraction': rx['framesOk']/rx['burstsHeard'],
      'objects_verified': rx['objectsVerified'], 'status_records_applied': rx['recordsApplied'],
      'body_bytes': rx['verifiedBytes'], 'signed_object_bytes': rx['verifiedBytes']+64,
      'unique_fragments_needed_for_object': math.ceil((rx['verifiedBytes']+64)/112),
      'body_bits_per_second': rx['verifiedBytes']*8/duration,
      'body_bytes_per_second': rx['verifiedBytes']/duration,
      'registry_preloaded': data['state']['registry'],
      'facilities_with_status': data['state']['withStatus'],
      'registry_status_coverage_fraction': data['state']['withStatus']/data['state']['registry'],
      'situations_received': data['state']['situations'],
      'peak_max': capture['levelPeakMax'], 'windows_above_one': len(high),
      'high_peak_time_range': [high[0]['t'],high[-1]['t']] if high else None,
      'linear_180_second_projection_bytes_NOT_measured': rx['verifiedBytes']/duration*180,
    }
    outcomes = [{'outcome': label, 'count': rx[key], 'detected_total':rx['burstsHeard'],
                 'share':rx[key]/rx['burstsHeard'], 'session':data['session'],
                 'source_mode':'microphone', 'active_seconds':duration}
                for label,key in [('Decoded','framesOk'),('Failed','framesFailed')]]
    return {'statistics':stats,'outcomes':outcomes}

if __name__ == '__main__':
    result=analyze()
    Path(__file__).with_name('log-summary.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
