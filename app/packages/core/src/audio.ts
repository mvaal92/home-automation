/** Downsample Float32 [-1,1] audio to 16-bit PCM at the target rate (linear average). */
export function toPcm16(input: Float32Array, inputRate: number, targetRate = 16000): Int16Array {
  const ratio = inputRate / targetRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j] ?? 0;
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** RMS level 0..1 for meters / simple VAD. */
export function rms(input: Float32Array): number {
  let s = 0;
  for (let i = 0; i < input.length; i++) s += (input[i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, input.length));
}
