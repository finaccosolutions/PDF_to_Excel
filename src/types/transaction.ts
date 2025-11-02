export interface Transaction {
  [key: string]: string;
}

export interface PageData {
  pageNumber: number;
  transactions: Transaction[];
}

export interface ConversionResult {
  success: boolean;
  data: Transaction[];
  pages: PageData[];
  filename: string;
  headers: string[];
  error?: string;
}
