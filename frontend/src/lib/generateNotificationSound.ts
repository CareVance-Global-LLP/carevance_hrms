// Simple notification sound generator using Web Audio API
// This creates basic notification sounds programmatically

export const generateNotificationSound = (
  type: 'chat' | 'approval' | 'announcement' | 'default' = 'default'
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const frequencies: Record<string, number[]> = {
        chat: [880, 1100, 880],
        approval: [660, 880, 1100],
        announcement: [880, 660, 880, 1100],
        default: [880, 1100],
      };

      const freqs = frequencies[type] || frequencies.default;
      const duration = 0.15;
      const gain = 0.3;

      let startTime = audioContext.currentTime;

      freqs.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = freq;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(gain, startTime + index * duration);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + (index + 1) * duration);

        oscillator.start(startTime + index * duration);
        oscillator.stop(startTime + (index + 1) * duration);
      });

      setTimeout(() => {
        resolve(new Blob());
      }, freqs.length * duration * 1000 + 100);
    } catch (error) {
      reject(error);
    }
  });
};
