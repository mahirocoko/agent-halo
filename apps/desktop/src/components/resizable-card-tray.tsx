import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

export interface IResizableCardSpec {
  id: string;
  defaultRatio: number;
  minWidth?: number;
}

export interface IResizableCardLayout {
  cardStyle: (index: number) => CSSProperties;
  dividerProps: (index: number, label: string) => {
    "aria-label": string;
    "aria-orientation": "vertical";
    "aria-valuemax": number;
    "aria-valuemin": number;
    "aria-valuenow": number;
    className: string;
    onDoubleClick: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
    role: "separator";
    tabIndex: 0;
  };
  ratios: number[];
  resetLayout: () => void;
  trayRef: RefObject<HTMLDivElement | null>;
}

interface IUseResizableCardLayoutOptions {
  defaultRatios?: number[];
  dividerWidth?: number;
  storageKey: string;
  specs: IResizableCardSpec[];
}

interface IDragState {
  divider: number;
  startX: number;
  startWidths: number[];
  totalAvail: number;
}

const DEFAULT_MIN_WIDTH = 190;

const normalizeRatios = (ratios: number[], defaults: number[]): number[] => {
  if (ratios.length !== defaults.length || ratios.some((ratio) => !Number.isFinite(ratio) || ratio <= 0.04)) {
    return defaults;
  }
  const sum = ratios.reduce((total, ratio) => total + ratio, 0);
  if (!Number.isFinite(sum) || sum <= 0 || Math.abs(sum - 1) > 0.1) return defaults;
  return ratios.map((ratio) => ratio / sum);
};

const readStoredRatios = (storageKey: string, defaults: number[]): number[] => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaults;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeRatios(parsed as number[], defaults) : defaults;
  } catch {
    return defaults;
  }
};

const writeStoredRatios = (storageKey: string, ratios: number[]) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(ratios));
  } catch {
    // Keep the current layout in memory when persistence is unavailable.
  }
};

export const useResizableCardLayout = ({
  defaultRatios,
  dividerWidth = 12,
  storageKey,
  specs,
}: IUseResizableCardLayoutOptions): IResizableCardLayout => {
  const defaults = useMemo(() => defaultRatios ?? specs.map((spec) => spec.defaultRatio), [defaultRatios, specs]);
  const minWidth = Math.max(...specs.map((spec) => spec.minWidth ?? DEFAULT_MIN_WIDTH), DEFAULT_MIN_WIDTH);
  const [ratios, setRatios] = useState(() => readStoredRatios(storageKey, defaults));
  const ratiosRef = useRef(ratios);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<IDragState | null>(null);

  useEffect(() => {
    const normalized = normalizeRatios(ratios, defaults);
    ratiosRef.current = normalized;
    if (normalized.some((ratio, index) => ratio !== ratios[index])) setRatios(normalized);
    writeStoredRatios(storageKey, normalized);
  }, [defaults, ratios, storageKey]);

  const getTotalAvail = () => {
    const width = trayRef.current?.getBoundingClientRect().width ?? 960;
    return Math.max(0, width - dividerWidth * Math.max(0, specs.length - 1));
  };

  const updateWidths = (widths: number[], totalAvail: number) => {
    if (totalAvail <= 0) return;
    const next = normalizeRatios(widths.map((width) => width / totalAvail), defaults);
    ratiosRef.current = next;
    setRatios(next);
  };

  const handlePointerDown = (divider: number, event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const totalAvail = getTotalAvail();
    if (totalAvail < minWidth * specs.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      divider,
      startX: event.clientX,
      startWidths: ratiosRef.current.map((ratio) => ratio * totalAvail),
      totalAvail,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const left = drag.divider;
    const right = left + 1;
    const combined = drag.startWidths[left] + drag.startWidths[right];
    const nextLeft = Math.max(minWidth, Math.min(combined - minWidth, drag.startWidths[left] + event.clientX - drag.startX));
    const widths = [...drag.startWidths];
    widths[left] = nextLeft;
    widths[right] = combined - nextLeft;
    updateWidths(widths, drag.totalAvail);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore a pointer cancelled by the browser or native shell.
    }
    dragRef.current = null;
  };

  const handleKeyDown = (divider: number, event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const totalAvail = getTotalAvail();
    const widths = ratiosRef.current.map((ratio) => ratio * totalAvail);
    const combined = widths[divider] + widths[divider + 1];
    const nextLeft = Math.max(minWidth, Math.min(combined - minWidth, widths[divider] + (event.key === "ArrowRight" ? 16 : -16)));
    widths[divider] = nextLeft;
    widths[divider + 1] = combined - nextLeft;
    updateWidths(widths, totalAvail);
  };

  const resetLayout = () => {
    ratiosRef.current = defaults;
    setRatios(defaults);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // In-memory reset still applies when persistence is unavailable.
    }
  };

  return {
    cardStyle: (index) => ({
      flex: `${ratios[index] ?? defaults[index] ?? 1 / specs.length} 0 0px`,
      minInlineSize: `${specs[index]?.minWidth ?? minWidth}px`,
    }),
    dividerProps: (index, label) => {
      const totalAvail = getTotalAvail();
      const ratio = ratios[index] ?? defaults[index] ?? 0;
      const nextRatio = ratios[index + 1] ?? defaults[index + 1] ?? 0;
      return {
        "aria-label": label,
        "aria-orientation": "vertical" as const,
        "aria-valuemax": Math.round(Math.max(minWidth, (ratio + nextRatio) * totalAvail - minWidth)),
        "aria-valuemin": minWidth,
        "aria-valuenow": Math.round(ratio * totalAvail),
        className: "card-resize-divider",
        onDoubleClick: () => resetLayout(),
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => handleKeyDown(index, event),
        onPointerCancel: handlePointerUp,
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => handlePointerDown(index, event),
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        role: "separator" as const,
        tabIndex: 0 as const,
      };
    },
    ratios,
    resetLayout,
    trayRef,
  };
};

export const ResizableCardDivider = ({
  index,
  label,
  layout,
  className = "",
}: {
  index: number;
  label: string;
  layout: IResizableCardLayout;
  className?: string;
}) => {
  const props = layout.dividerProps(index, label);
  return <div {...props} className={[props.className, className].filter(Boolean).join(" ")}><div className="card-resize-grip" aria-hidden="true" /></div>;
};
