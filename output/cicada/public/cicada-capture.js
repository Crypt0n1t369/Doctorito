/* AudioWorklet that forwards microphone blocks to the page.
   DSP runs on the main thread; this only moves samples off the audio thread. */
class CicadaCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.at = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.at++] = ch[i];
      if (this.at === this.buf.length) {
        this.port.postMessage(this.buf.slice());
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor("cicada-capture", CicadaCapture);
