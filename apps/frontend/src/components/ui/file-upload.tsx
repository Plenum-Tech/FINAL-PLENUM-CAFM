"use client";

import React, { useRef, useState } from "react";
import { UploadCloud, X, File as FileIcon } from "lucide-react";
import { cn } from "@/utils";
import { Button } from "./button";

export interface FileUploadProps {
  /** The currently selected file */
  value?: File | null;
  /** Callback when a file is selected or removed */
  onChange: (file: File | null) => void;
  /** Accepted file types, e.g. "image/*,.pdf,.doc,.docx" */
  accept?: string;
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Title text shown above the upload area */
  title?: string;
  /** Description text shown below the title */
  description?: string;
  /** Whether the upload is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function FileUpload({
  value,
  onChange,
  accept = "*",
  maxSize,
  title = "Click or drag file to this area to upload",
  description = "Support for a single file upload.",
  disabled = false,
  className,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (file: File | null) => {
    setError(null);
    if (!file) {
      onChange(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    if (maxSize && file.size > maxSize) {
      setError(`File size exceeds the limit of ${(maxSize / (1024 * 1024)).toFixed(2)} MB`);
      return;
    }

    onChange(file);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      handleFileChange(droppedFile);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  return (
    <div className={cn("w-full space-y-2", className)}>
      {!value ? (
        <div
          className={cn(
            "relative flex flex-col items-center justify-center w-full p-6 border-2 border-dashed rounded-xl transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/50",
            disabled ? "opacity-50 cursor-not-allowed hover:border-border hover:bg-transparent" : "cursor-pointer"
          )}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => !disabled && inputRef.current?.click()}
        >
          <input
            type="file"
            ref={inputRef}
            className="hidden"
            accept={accept}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFileChange(e.target.files[0]);
              }
            }}
            disabled={disabled}
          />
          <div className="flex flex-col items-center justify-center space-y-2 text-center">
            <div className="p-3 bg-primary/10 rounded-full text-primary">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{title}</p>
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
          <div className="flex items-center space-x-4 overflow-hidden">
            <div className="p-2 bg-primary/10 rounded-lg text-primary shrink-0">
              <FileIcon className="w-6 h-6" />
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate" title={value.name}>
                {value.name}
              </span>
              <span className="text-xs text-muted-foreground">{formatFileSize(value.size)}</span>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => handleFileChange(null)}
            disabled={disabled}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive font-medium">{error}</p>}
    </div>
  );
}
