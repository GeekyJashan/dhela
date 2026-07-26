import { useRef } from "react";
import { Camera, FileUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isMobileDevice } from "@/lib/device";
import { cn } from "@/lib/utils";

/**
 * File selection for a distributor standing at the godown door with a stack
 * of bills: a camera button that goes straight to the rear camera, plus the
 * normal picker for the gallery or a PDF.
 *
 * `capture` takes one shot per tap on both iOS and Android — it overrides
 * `multiple` — so the flow is tap, shoot, tap again, and the caller keeps
 * appending. Nothing uploads until the caller says so.
 *
 * The camera button is hidden on desktop, where `capture` is ignored and the
 * button would just open a second, identical file dialog.
 */
export function CaptureInput({
  onFiles,
  accept = "application/pdf,image/*",
  disabled,
  photoCount = 0,
  className,
}: {
  /** Called with each selection; append rather than replace. */
  onFiles: (files: File[]) => void;
  accept?: string;
  disabled?: boolean;
  /** Photos captured so far, used to number the next one. */
  photoCount?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const mobile = isMobileDevice();

  // Cameras hand back "image.jpg" every single time, which is useless in a
  // list of thirty. Number them in the order they were shot instead.
  const take = (list: FileList | null, fromCamera: boolean) => {
    if (!list?.length) return;
    const files = Array.from(list).map((f, i) =>
      fromCamera
        ? new File([f], `${t("Photo")} ${photoCount + i + 1}.jpg`, { type: f.type || "image/jpeg" })
        : f,
    );
    onFiles(files);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div
        className={cn("grid gap-3", mobile ? "grid-cols-1" : "grid-cols-1")}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); take(e.dataTransfer.files, false); }}
      >
        {mobile && (
          <button type="button" disabled={disabled}
            onClick={() => cameraRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50">
            <Camera className="h-5 w-5" />
            {t("Take photo")}
          </button>
        )}

        <button type="button" disabled={disabled}
          onClick={() => pickerRef.current?.click()}
          className={cn(
            "rounded-xl border-2 border-dashed transition hover:bg-muted/40 disabled:opacity-50",
            mobile ? "px-4 py-3.5" : "px-4 py-10",
          )}>
          <FileUp className={cn("mx-auto text-muted-foreground", mobile ? "h-5 w-5" : "h-9 w-9")} />
          <p className={cn("font-medium", mobile ? "mt-1.5 text-sm" : "mt-3")}>
            {mobile ? t("Choose from phone") : t("Drop files here or click to select")}
          </p>
          {!mobile && (
            <p className="mt-1 text-xs text-muted-foreground">{t("Multiple files supported")}</p>
          )}
        </button>
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { take(e.target.files, true); e.target.value = ""; }} />
      <input ref={pickerRef} type="file" accept={accept} multiple className="hidden"
        onChange={e => { take(e.target.files, false); e.target.value = ""; }} />

      {mobile && (
        <p className="text-center text-xs text-muted-foreground">
          {t("Keep tapping to add more — nothing uploads until you press Upload.")}
        </p>
      )}
    </div>
  );
}

/** Object URL for image files so a captured photo can be checked before upload. */
export function previewUrl(file: File): string | undefined {
  return file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
}
