import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface Props {
  valeur: string;
  taille?: number;
  className?: string;
}

// 13.1 : "QR code de vérification sur factures et tickets" — génère l'image
// entièrement côté client (mode local, aucun service externe requis).
export function QrCode({ valeur, taille = 96, className }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    QRCode.toDataURL(valeur, { width: taille, margin: 1 })
      .then((url) => {
        if (!annule) setDataUrl(url);
      })
      .catch(() => setDataUrl(null));
    return () => {
      annule = true;
    };
  }, [valeur, taille]);

  if (!dataUrl) return <div style={{ width: taille, height: taille }} className={className} />;
  return <img src={dataUrl} alt="QR code de vérification" width={taille} height={taille} className={className} />;
}
