// Thin AudioWorklet wrapper around FormantSynth. The DSP lives in the engine
// module so it can be reused outside the browser

import { FormantSynth } from './engine/synth-core.js';

class FormantProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options?.processorOptions ?? {};
    this.synth = new FormantSynth({
      sampleRate,
      initialTarget: opts.initialTarget,
      schedule: opts.schedule,
    });
    this.port.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type === 'frame') {
        this.synth.setTarget(msg.target, msg.transitionMs);
      } else if (msg?.type === 'schedule') {
        this.synth.queueSchedule(msg.schedule);
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    this.synth.process(out);
    if (outputs[0].length > 1) outputs[0][1].set(out);
    return true;
  }
}

registerProcessor('formant-processor', FormantProcessor);
