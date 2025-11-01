export interface Transaction {
  date: string;
  particulars: string;
  withdrawal: string;
  deposit: string;
  balance: string;
}

export interface ConversionResult {
  success: boolean;
  data: Transaction[];
  filename: string;
  error?: string;
}
