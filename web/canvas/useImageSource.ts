import { useEffect, useState } from "react";
import type { SceneSpec } from "../../src/spec";

export type Source =
  | { kind: "blank"; scene?: SceneSpec }
  | { kind: "image"; name: string; dataUrl: string; scene?: SceneSpec };

type LoadedImage = {
  source: Source;
  image: HTMLImageElement | null;
  width: number;
  height: number;
};

const blankSize = {
  width: Math.max(960, Math.floor(window.innerWidth - 56)),
  height: Math.max(620, Math.floor(window.innerHeight - 104))
};

export function useImageSource() {
  const [loaded, setLoaded] = useState<LoadedImage | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const source = (await fetch("/api/source").then((res) => res.json())) as Source;
      if (source.kind === "blank") {
        setLoaded({ source, image: null, ...blankSize });
        return;
      }

      const image = new Image();
      image.onload = () => {
        if (!cancelled) {
          setLoaded({
            source,
            image,
            width: image.naturalWidth,
            height: image.naturalHeight
          });
        }
      };
      image.src = source.dataUrl;
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return loaded;
}
