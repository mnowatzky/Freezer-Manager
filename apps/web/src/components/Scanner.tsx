import { BARCODE_PATTERN, parseContainerCode } from "@freezer/shared/domain";
import { t } from "../lib/i18n";
import { BarcodeDetector, prepareZXingModule } from "barcode-detector/ponyfill";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { motionScheme } from "../theme/motion";
import { Button, Icon, Sheet, TextField } from "./m3";

// Serve the ZXing WASM from our own origin (precached by the service worker) instead of a CDN.
prepareZXingModule({
  overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
});

// Product barcode formats supported by the bundled ZXing WASM.
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
type Format = "qr_code" | (typeof BARCODE_FORMATS)[number];

const parseBarcode = (text: string) => (BARCODE_PATTERN.test(text.trim()) ? text.trim() : null);

export type ScanResult = { container: number } | { barcode: string };

// What a scanner looks for: container QR codes (→ number), product barcodes (→ digits), or both.
// `format` is the detected symbology; manual entry has none.
const modes = {
  container: {
    formats: ["qr_code"],
    parse: (text: string) => parseContainerCode(text),
    title: () => t.scanner.title,
    manual: () => t.scanner.manual,
    invalid: () => t.scanner.invalid,
  },
  barcode: {
    formats: BARCODE_FORMATS,
    parse: parseBarcode,
    title: () => t.scanner.title,
    manual: () => t.scanner.barcodeManual,
    invalid: () => t.scanner.invalidBarcode,
  },
  // Home screen: a sticker opens its container, a product barcode starts freezing it. Typed-in
  // numbers are container numbers.
  any: {
    formats: ["qr_code", ...BARCODE_FORMATS],
    parse: (text: string, format?: Format): ScanResult | null => {
      if (format && format !== "qr_code") {
        const code = parseBarcode(text);
        return code === null ? null : { barcode: code };
      }
      const n = parseContainerCode(text);
      return n === null ? null : { container: n };
    },
    title: () => t.scanner.titleAny,
    manual: () => t.scanner.manual,
    invalid: () => t.scanner.invalid,
  },
} as const;

export type ScannerMode =
  | { mode?: "container"; onResult: (n: number) => void }
  | { mode: "barcode"; onResult: (code: string) => void }
  | { mode: "any"; onResult: (result: ScanResult) => void };

/** Camera scanner sheet (container QR codes by default) with manual entry as an equal alternative. */
export function Scanner({ open, onClose, ...props }: ScannerMode & { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title={modes[props.mode ?? "container"].title()} onClose={onClose}>
      <ScannerView {...props} />
    </Sheet>
  );
}

/** The scanner itself, e.g. to show it inside another sheet. */
export function ScannerView(props: ScannerMode) {
  const mode = modes[props.mode ?? "container"];
  // Each mode's parser matches its callback's argument type.
  const onResult = props.onResult as (value: Parsed) => void;
  return <ScannerBody formats={mode.formats} parse={mode.parse} manualLabel={mode.manual()} invalidText={mode.invalid()} onResult={onResult} />;
}

type Parsed = string | number | ScanResult;

function ScannerBody({
  formats,
  parse,
  manualLabel,
  invalidText,
  onResult,
}: {
  formats: readonly Format[];
  parse: (text: string, format?: Format) => Parsed | null;
  manualLabel: string;
  invalidText: string;
  onResult: (value: Parsed) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  const [ready, setReady] = useState(false);
  const [manual, setManual] = useState("");
  const [invalid, setInvalid] = useState(false);
  // Stable for the camera effect, so a re-rendering parent doesn't restart the camera.
  const emit = useEffectEvent(onResult);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let cancelled = false;
    const detector = new BarcodeDetector({ formats: [...formats] });

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
              const value = parse(code.rawValue, code.format as Format);
              if (value !== null) return emit(value);
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
  }, [formats, parse]);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const value = parse(manual);
    if (value === null) setInvalid(true);
    else onResult(value);
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
            {invalidText}
          </motion.p>
        )}
      </AnimatePresence>
      <form onSubmit={submitManual} className="flex items-start gap-2">
        <TextField
          className="flex-1"
          label={manualLabel}
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
