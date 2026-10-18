import { containerUrl } from "@freezer/shared/domain";
import { t } from "../lib/i18n";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, IconButton, TextField } from "../components/m3";

const MAX_LABELS = 200;

/** Printable sheet of container stickers: QR (URL /c/<n>) with the number in the middle. */
export function LabelsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const from = Math.max(1, Number(params.get("from")) || 1);
  const to = Math.min(from + MAX_LABELS - 1, Math.max(from, Number(params.get("to")) || from + 23));
  const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="min-h-dvh p-4 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-6 flex max-w-xl flex-wrap items-center gap-3">
        <IconButton icon="arrow_back" label={t.common.back} onClick={() => void navigate("/settings")} />
        <h1 className="type-title-large mr-auto">{t.labels.title}</h1>
        <TextField
          className="w-24"
          label={t.labels.from}
          type="number"
          min={1}
          value={from}
          onChange={(e) => setParams({ from: e.target.value, to: String(to) }, { replace: true })}
        />
        <TextField
          className="w-24"
          label={t.labels.to}
          type="number"
          min={from}
          value={to}
          onChange={(e) => setParams({ from: String(from), to: e.target.value }, { replace: true })}
        />
        <Button icon="print" onClick={() => window.print()}>
          {t.labels.print}
        </Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5cm,1fr))] gap-4 rounded-xl bg-white p-4 print:grid-cols-5 print:rounded-none">
        {numbers.map((n) => (
          <Label key={n} number={n} />
        ))}
      </div>
    </div>
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
    <div className="relative mx-auto aspect-square w-[3.5cm] break-inside-avoid">
      {src && <img src={src} alt={`QR ${number}`} className="size-full" />}
      <span className="absolute top-1/2 left-1/2 flex size-[26%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[30%] bg-white text-xl font-bold text-black">
        {number}
      </span>
    </div>
  );
}
