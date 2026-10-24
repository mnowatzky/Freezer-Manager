import { containerUrl } from "@freezer/shared/domain";
import { t } from "../lib/i18n";
import QRCode from "qrcode";
import { useEffect, useState, type ComponentProps, type CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, IconButton, TextField } from "../components/m3";

const MAX_LABELS = 200;
const DEFAULT_SIZE_CM = 3.5;

/** Printable sheet of container stickers: QR (URL /c/<n>) with the number in the middle. */
export function LabelsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const from = Math.max(1, Number(params.get("from")) || 1);
  const to = Math.min(from + MAX_LABELS - 1, Math.max(from, Number(params.get("to")) || from + 23));
  const size = Math.min(9, Math.max(2, Number(params.get("size")) || DEFAULT_SIZE_CM));
  const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const update = (changes: Record<string, string>) =>
    setParams({ from: String(from), to: String(to), size: String(size), ...changes }, { replace: true });

  return (
    <div className="min-h-dvh p-4 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-6 flex max-w-xl items-center gap-3">
        <IconButton icon="arrow_back" label={t.common.back} onClick={() => void navigate("/settings")} />
        <h1 className="type-title-large mr-auto">{t.labels.title}</h1>
        <Button icon="print" onClick={() => window.print()}>
          {t.labels.print}
        </Button>
      </div>
      <div className="no-print mx-auto mb-6 grid max-w-xl grid-cols-3 gap-3">
        <NumberField
          label={t.labels.from}
          type="number"
          min={1}
          value={from}
          onChange={(e) => update({ from: e.target.value })}
        />
        <NumberField
          label={t.labels.to}
          type="number"
          min={from}
          value={to}
          onChange={(e) => update({ to: e.target.value })}
        />
        <NumberField
          label={t.labels.size}
          type="number"
          min={2}
          max={9}
          step={0.5}
          value={size}
          onChange={(e) => update({ size: e.target.value })}
        />
      </div>
      {/* Printed, columns follow from the label size: as many as fit the page width. */}
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(var(--label),1fr))] gap-4 rounded-xl bg-white p-4 print:grid-cols-[repeat(auto-fill,var(--label))] print:justify-center print:rounded-none print:p-0"
        style={{ "--label": `${size}cm` } as CSSProperties}
      >
        {numbers.map((n) => (
          <Label key={n} number={n} />
        ))}
      </div>
    </div>
  );
}

/** Keeps the typed text while focused, so clearing it doesn't snap back to the clamped value. */
function NumberField({ value, onChange, onBlur, ...props }: ComponentProps<typeof TextField>) {
  const [draft, setDraft] = useState<string>();
  return (
    <TextField
      {...props}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange?.(e);
      }}
      onBlur={(e) => {
        setDraft(undefined);
        onBlur?.(e);
      }}
    />
  );
}

function Label({ number }: { number: number }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    // High error correction so the number overlay doesn't break scanning.
    void QRCode.toDataURL(containerUrl(import.meta.env.VITE_PUBLIC_URL || location.origin, number), {
      errorCorrectionLevel: "H",
      margin: 1,
      width: 300,
    }).then(setSrc);
  }, [number]);
  return (
    <div className="relative mx-auto aspect-square w-(--label) break-inside-avoid">
      {src && <img src={src} alt={`QR ${number}`} className="size-full" />}
      <span className="absolute top-1/2 left-1/2 flex size-[26%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[30%] bg-white text-[calc(var(--label)*0.15)] font-bold text-black">
        {number}
      </span>
    </div>
  );
}
