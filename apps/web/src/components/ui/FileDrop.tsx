import type { ReactNode } from "react";
import { Button, DropZone, type FileDropItem, FileTrigger } from "react-aria-components";
import { cx } from "./cx";

/**
 * Open a file: click to browse, or drop one on it. The zone lights up while a
 * file is dragged over it.
 */
export function FileDrop({
  accept,
  onFile,
  label = "Open a file",
  hint = "or drop it here",
  className,
}: {
  /** MIME types and/or extensions, as for `<input accept>`. */
  accept?: string[];
  onFile: (file: File) => void;
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <DropZone
      className={cx("ui-dropzone", className)}
      onDrop={async (event) => {
        const item = event.items.find((i): i is FileDropItem => i.kind === "file");
        if (item) onFile(await item.getFile());
      }}
    >
      <FileTrigger
        acceptedFileTypes={accept}
        onSelect={(files) => {
          const file = files?.[0];
          if (file) onFile(file);
        }}
      >
        <Button className="ui-dropzone-button">
          <svg className="ui-file-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5" />
          </svg>
          {label}
        </Button>
      </FileTrigger>
      <span className="ui-dropzone-hint">{hint}</span>
    </DropZone>
  );
}
