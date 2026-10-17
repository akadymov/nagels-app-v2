import React, { useEffect, useState } from 'react';
import { Image } from 'react-native';
import QRCode from 'qrcode';

export const TableQr: React.FC<{ url: string; size: number }> = ({ url, size }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: size }).then((d) => { if (alive) setSrc(d); }).catch(() => {});
    return () => { alive = false; };
  }, [url, size]);
  if (!src) return null;
  return <Image testID="tournament-table-qr" source={{ uri: src }} style={{ width: size, height: size }} />;
};
