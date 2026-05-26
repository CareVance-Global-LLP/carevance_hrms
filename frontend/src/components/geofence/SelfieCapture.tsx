import { useEffect, useRef, useState } from 'react';
import { selfieApi } from '@/services/api';

interface SelfieCaptureProps {
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  onComplete: () => void;
}

export default function SelfieCapture({ latitude, longitude, accuracy, onComplete }: SelfieCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraStarted, setCameraStarted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraStarted(true);
      } catch {
        setError('Camera access denied. Please allow camera permissions to continue.');
      }
    };
    start();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setCaptured(canvas.toDataURL('image/jpeg', 0.8));
  };

  const handleRetake = () => {
    setCaptured(null);
    setError(null);
  };

  const handleUpload = async () => {
    if (!captured) return;
    setUploading(true);
    setError(null);
    try {
      await selfieApi.upload({
        image: captured,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        accuracy: accuracy ?? undefined,
      });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      onComplete();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-slate-800 text-center">Take Today's Selfie</h3>
      <p className="text-sm text-slate-500 text-center">Required once per day before starting the timer</p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-2 text-center">
          {error}
        </div>
      )}

      {!cameraStarted && !error ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          Starting camera...
        </div>
      ) : !captured ? (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-64 object-cover" />
            <canvas ref={canvasRef} className="hidden" />
          </div>
          <button
            type="button"
            onClick={handleCapture}
            className="w-full rounded-lg bg-blue-600 text-white py-3 font-semibold hover:bg-blue-700 transition"
          >
            📸 Capture
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg overflow-hidden bg-slate-100">
            <img src={captured} alt="Captured selfie" className="w-full h-64 object-cover" />
          </div>
          {latitude && longitude && (
            <p className="text-xs text-slate-400 text-center">
              📍 {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleRetake}
              disabled={uploading}
              className="flex-1 rounded-lg border border-slate-300 bg-white text-slate-700 py-3 font-medium hover:bg-slate-50 transition disabled:opacity-50"
            >
              🔄 Retake
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              className="flex-1 rounded-lg bg-green-600 text-white py-3 font-semibold hover:bg-green-700 transition disabled:opacity-50"
            >
              {uploading ? 'Uploading...' : '✅ Save Selfie'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
