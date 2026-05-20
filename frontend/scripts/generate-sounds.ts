// Generate notification sounds as base64 WAV files
// These are minimal valid WAV files with simple tones

const generateWavHeader = (dataLength: number, sampleRate: number = 44100): Buffer => {
  const buffer = Buffer.alloc(44);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  
  // fmt subchunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22); // NumChannels (1 for mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  
  // data subchunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  
  return buffer;
};

const generateTone = (frequency: number, duration: number, sampleRate: number = 44100): Buffer => {
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = Buffer.alloc(numSamples * 2); // 16-bit samples
  
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t) * 32767 * 0.5;
    buffer.writeInt16LE(Math.floor(sample), i * 2);
  }
  
  return buffer;
};

const generateNotificationSound = (
  type: 'chat' | 'approval' | 'announcement' | 'default'
): Buffer => {
  const frequencies: Record<string, number[]> = {
    chat: [880, 1100, 880],
    approval: [660, 880, 1100],
    announcement: [880, 660, 880, 1100],
    default: [880, 1100],
  };

  const freqs = frequencies[type] || frequencies.default;
  const toneDuration = 0.12; // 120ms per tone
  const silenceDuration = 0.03; // 30ms silence between tones
  
  const toneBuffers = freqs.map(freq => generateTone(freq, toneDuration));
  const silenceBuffer = Buffer.alloc(Math.floor(44100 * silenceDuration) * 2);
  
  let totalLength = 0;
  toneBuffers.forEach((buf, i) => {
    totalLength += buf.length;
    if (i < toneBuffers.length - 1) {
      totalLength += silenceBuffer.length;
    }
  });
  
  const wavHeader = generateWavHeader(totalLength);
  const wavFile = Buffer.alloc(44 + totalLength);
  
  wavHeader.copy(wavFile, 0);
  
  let offset = 44;
  toneBuffers.forEach((buf, i) => {
    buf.copy(wavFile, offset);
    offset += buf.length;
    if (i < toneBuffers.length - 1) {
      silenceBuffer.copy(wavFile, offset);
      offset += silenceBuffer.length;
    }
  });
  
  return wavFile;
};

// Generate and save all notification sounds
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const soundsDir = path.join(__dirname, '..', 'public', 'sounds');

if (!fs.existsSync(soundsDir)) {
  fs.mkdirSync(soundsDir, { recursive: true });
}

const soundTypes: Array<'chat' | 'approval' | 'announcement' | 'default'> = [
  'chat',
  'approval',
  'announcement',
  'default',
];

soundTypes.forEach(type => {
  const wavData = generateNotificationSound(type);
  const filePath = path.join(soundsDir, `${type}-notification.mp3`);
  fs.writeFileSync(filePath, wavData);
  console.log(`Generated ${type}-notification.mp3`);
});

console.log('All notification sounds generated successfully!');
