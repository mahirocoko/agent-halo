export interface IDisplayOption {
  id: string;
  fingerprint: string;
  name: string;
  width: number;
  height: number;
  scaleFactor: number;
  isPrimary: boolean;
}

export interface IDisplayStateSnapshot {
  displays: IDisplayOption[];
  preferredDisplayId: string | null;
  preferredDisplayName: string | null;
  selectedDisplayId: string | null;
  activeDisplayId: string | null;
  fallbackActive: boolean;
}

export const displayResolutionLabel = (display: IDisplayOption): string =>
  `${display.width}×${display.height}`;
