import { useState, useRef, useCallback } from 'react';
import { uploadShot } from '@/hooks/useRecords';

interface ShotButtonProps {
  sid: string;
  currentTime: number;
}

// Compress image in browser: max 1600px long edge, JPEG quality 0.8
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1600;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h / w) * maxDim);
            w = maxDim;
          } else {
            w = Math.round((w / h) * maxDim);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas 不可用')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export default function ShotButton({ sid, currentTime }: ShotButtonProps) {
  const [uploading, setUploading] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const base64 = await compressImage(file);
      await uploadShot(sid, currentTime, base64);
      setSuccessFlash(true);
      setTimeout(() => setSuccessFlash(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [sid, currentTime]);

  return (
    <div className="relative">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
          successFlash
            ? 'bg-green-100 text-green-700'
            : 'bg-background-100 text-foreground-600 hover:bg-background-200'
        }`}
        title="拍板书"
      >
        <div className="w-4 h-4 flex items-center justify-center">
          <i className={`${uploading ? 'ri-loader-4-line animate-spin' : successFlash ? 'ri-check-line' : 'ri-camera-line'}`}></i>
        </div>
        拍板书
      </button>
      {error && <p className="absolute top-full mt-1 text-xs text-red-500 whitespace-nowrap">{error}</p>}
    </div>
  );
}