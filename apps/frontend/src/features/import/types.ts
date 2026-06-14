export type ImportRow = Record<string, string | number | boolean | null>;

export type ImportJob = {
  id: string;
  fileName: string;
  fileType: "csv" | "json";
  rowsCount: number;
  preview: ImportRow[];
  createdAt: string;
};
