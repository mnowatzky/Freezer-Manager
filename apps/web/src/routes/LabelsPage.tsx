import { containerUrl } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, Field, inputClass } from "../components/ui";

const MAX_LABELS = 200;

/** Printable sheet of container stickers: QR (URL /c/<n>) with the number in the middle. */
export function LabelsPage() {
  const [params, setParams] = useSearchParams();
  const from = Math.max(1, Number(params.get("von")) || 1);
  const to = Math.min(from + MAX_LABELS - 1, Math.max(from, Number(params.get("bis")) || from + 23));
  const numbers = Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <div className="p-4">
      <div className="no-print mx-auto mb-6 flex max-w-xl flex-wrap items-end gap-3">
        <Link to="/einstellungen" className="mr-auto text-brand-dark underline">
          ← {de.common.back}
        </Link>
        <Field label={de.labels.from}>
          <input
            type="number"
            min={1}
            className={`${inputClass} w-24`}
            value={from}
            onChange={(e) => setParams({ von: e.target.value, bis: String(to) }, { replace: true })}
          />
        </Field>
        <Field label={de.labels.to}>
          <input
            type="number"
            min={from}
            className={`${inputClass} w-24`}
            value={to}
            onChange={(e) => setParams({ von: String(from), bis: e.target.value }, { replace: true })}
          />
        </Field>
        <Button onClick={() => window.print()}>{de.labels.print}</Button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.5cm,1fr))] gap-4 print:grid-cols-5">
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
    void QRCode.toDataURL(containerUrl(import.meta.env.VITE_PUBLIC_URL || location.origin, number), { errorCorrectionLevel: "H", margin: 1, width: 300 }).then(
      setSrc,
    );
  }, [number]);
  return (
    <div className="relative mx-auto aspect-square w-[3.5cm] break-inside-avoid">
      {src && <img src={src} alt={`QR ${number}`} className="size-full" />}
      <span className="absolute top-1/2 left-1/2 flex size-[26%] -translate-x-1/2 -translate-y-1/2 items-center justify-center bg-white text-xl font-bold">
        {number}
      </span>
    </div>
  );
}
