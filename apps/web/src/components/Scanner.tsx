import { parseContainerCode } from "@freezer/shared/domain";
import { t } from "../lib/i18n";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { motionScheme } from "../theme/motion";
import { Button, Icon, Sheet, TextField } from "./m3";

// Serve the ZXing WASM from our own origin (precached by the service worker) instead of a CDN.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

/** Camera QR scanner sheet with manual number entry as an equal alternative. */
export function Scanner({ open, onResult, onClose }: { open: boolean; onResult: (n: number) => void; onClose: () => void }) {
  return (
    <Sheet open={open} title={t.scanner.title} onClose={onClose}>
      <ScannerBody onResult={onResult} />
    </Sheet>
  );
}

function ScannerBody({ onResult }: { onResult: (n: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState("");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let cancelled = false;
    const detector = new BarcodeDetector({ formats: ["qr_code"] });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setReady(true);
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
          raf = requestAnimationFrame(() => void tick());
        };
        raf = requestAnimationFrame(() => void tick());
      } catch {
        setCameraError(true);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseContainerCode(manual);
    if (n === null) setInvalid(true);
    else onResult(n);
  };

  return (
    <>
      {cameraError ? (
        <div className="type-body-medium mb-4 flex items-center gap-3 rounded-l bg-surface-container px-4 py-3 text-on-surface-variant">
          <Icon name="error" />
          {t.scanner.noCamera}
        </div>
      ) : (
        <div className="relative mb-4 aspect-square w-full overflow-hidden rounded-xl bg-inverse-surface">
          <video ref={videoRef} className="size-full object-cover" muted playsInline />
          {/* Viewfinder frame that "breathes" on the slow spatial spring while scanning. */}
          <motion.div
            className="pointer-events-none absolute inset-[18%] rounded-xli ring-4 ring-primary-container"
            initial={{ opacity: 0, scale: 1.15 }}
            animate={ready ? { opacity: 1, scale: [1, 0.96, 1] } : { opacity: 0.4, scale: 1 }}
            transition={ready ? { scale: { repeat: Infinity, duration: 2.4, ease: "easeInOut" }, opacity: motionScheme.defaultEffects } : motionScheme.slowSpatial}
          />
        </div>
      )}
      <AnimatePresence>
        {invalid && (
          <motion.p
            className="type-body-medium mb-3 text-error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={motionScheme.defaultSpatial}
          >
            {t.scanner.invalid}
          </motion.p>
        )}
      </AnimatePresence>
      <form onSubmit={submitManual} className="flex items-start gap-2">
        <TextField
          className="flex-1"
          label={t.scanner.manual}
          leadingIcon="keyboard"
          inputMode="numeric"
          pattern="[0-9]*"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <Button type="submit" size="m" icon="arrow_forward" aria-label={t.scanner.open} className="px-4" />
      </form>
    </>
  );
}
