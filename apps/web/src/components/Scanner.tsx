import { parseContainerCode } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { useEffect, useRef, useState } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { Button, inputClass, Sheet } from "./ui";

// Serve the ZXing WASM from our own origin (precached by the service worker) instead of a CDN.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

/** Camera QR scanner with manual number entry as an equal alternative. */
export function Scanner({ onResult, onClose }: { onResult: (n: number) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  const [manual, setManual] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let cancelled = false;
    const detector = new BarcodeDetector({ formats: ["qr_code"] });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            for (const code of codes) {
              const n = parseContainerCode(code.rawValue);
              if (n !== null) return onResult(n);
              setInvalid(true);
            }
          } catch {
            // Frame not ready yet; try again on the next one.
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCameraError(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseContainerCode(manual);
    if (n === null) setInvalid(true);
    else onResult(n);
  };

  return (
    <Sheet title={de.scanner.title} onClose={onClose}>
      {cameraError ? (
        <p className="mb-4 text-sm text-slate-500">{de.scanner.noCamera}</p>
      ) : (
        <video ref={videoRef} className="mb-4 aspect-square w-full rounded-xl bg-black object-cover" muted playsInline />
      )}
      {invalid && <p className="mb-2 text-sm text-red-600">{de.scanner.invalid}</p>}
      <form onSubmit={submitManual} className="flex gap-2">
        <input
          className={inputClass}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder={de.scanner.manual}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <Button type="submit">{de.scanner.open}</Button>
      </form>
    </Sheet>
  );
}
