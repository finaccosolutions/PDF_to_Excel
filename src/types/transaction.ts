export interface Transaction {
  [key: string]: string;
}

export interface ConversionResult {
  success: boolean;
  data: Transaction[];
  filename: string;
  headers: string[];
  error?: string;
}
