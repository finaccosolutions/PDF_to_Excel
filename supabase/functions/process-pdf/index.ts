import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as pdfjs from "npm:pdfjs-dist@3.11.174";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface Transaction {
  date: string;
  particulars: string;
  withdrawal: string;
  deposit: string;
  balance: string;
}

Deno.serve(async (req: Request) => {
  console.log("Request method:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: "No file provided", success: false, data: [] }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Processing file:", file.name, "size:", file.size);

    const arrayBuffer = await file.arrayBuffer();
    const text = await extractTextFromPDF(arrayBuffer);
    console.log("Extracted PDF text length:", text.length);

    const transactions = parseTransactions(text);
    console.log("Parsed transactions count:", transactions.length);

    if (transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No transactions found in PDF. Please ensure your PDF contains a valid bank statement.",
          data: [],
          filename: file.name,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: transactions,
        filename: file.name,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing PDF:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Failed to process PDF",
        data: [],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function extractTextFromPDF(arrayBuffer: ArrayBuffer): Promise<string> {
  pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
  const pdf = await pdfjs.getDocument(new Uint8Array(arrayBuffer)).promise;
  let text = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item: any) => item.str || "")
      .join(" ");
    text += pageText + "\n";
  }

  return text;
}

function parseTransactions(text: string): Transaction[] {
  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const transactions: Transaction[] = [];

  const datePatterns = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
    /(\d{2}\s+[A-Za-z]{3}\s+\d{4})/,
    /(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/,
  ];

  const headerKeywords = [
    /^date$/i,
    /^particulars$/i,
    /^withdrawal$/i,
    /^deposit$/i,
    /^balance$/i,
    /^transaction\s+date$/i,
    /^value\s+date$/i,
    /^description$/i,
    /^debit$/i,
    /^credit$/i,
    /^narration$/i,
  ];

  const skipKeywords = [
    /^page\s+\d+/i,
    /^statement\s+period/i,
    /^account\s+number/i,
    /^ifsc/i,
    /^branch/i,
    /^customer\s+id/i,
    /^address/i,
    /^opening\s+balance$/i,
    /^closing\s+balance$/i,
    /^total$/i,
    /bank details/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const isHeader = headerKeywords.some(pattern => pattern.test(line));
    if (isHeader) continue;

    const shouldSkip = skipKeywords.some(pattern => pattern.test(line));
    if (shouldSkip || line.length < 10) continue;

    let dateMatch = null;
    let matchedDate = "";

    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        dateMatch = match;
        matchedDate = match[1];
        break;
      }
    }

    if (dateMatch && matchedDate) {
      const restOfLine = line.replace(matchedDate, "").trim();

      const amounts = extractAmounts(restOfLine);

      let particulars = extractParticulars(restOfLine, amounts);

      let withdrawal = "";
      let deposit = "";
      let balance = "";

      if (amounts.length >= 1) {
        if (amounts.length === 1) {
          balance = formatAmount(amounts[0]);
        } else if (amounts.length === 2) {
          const isWithdrawal =
            line.toLowerCase().includes("dr") ||
            line.toLowerCase().includes("debit") ||
            line.toLowerCase().includes("withdrawal") ||
            line.toLowerCase().includes("chq") ||
            line.toLowerCase().includes("cheque") ||
            line.toLowerCase().includes("paid");

          const isDeposit =
            line.toLowerCase().includes("cr") ||
            line.toLowerCase().includes("credit") ||
            line.toLowerCase().includes("deposit") ||
            line.toLowerCase().includes("received");

          if (isWithdrawal) {
            withdrawal = formatAmount(amounts[0]);
            balance = formatAmount(amounts[1]);
          } else if (isDeposit) {
            deposit = formatAmount(amounts[0]);
            balance = formatAmount(amounts[1]);
          } else {
            const amount1 = parseFloat(amounts[0]);
            const amount2 = parseFloat(amounts[1]);

            if (amount2 > amount1) {
              deposit = formatAmount(amounts[0]);
              balance = formatAmount(amounts[1]);
            } else {
              withdrawal = formatAmount(amounts[0]);
              balance = formatAmount(amounts[1]);
            }
          }
        } else if (amounts.length >= 3) {
          withdrawal = formatAmount(amounts[0]);
          deposit = formatAmount(amounts[1]);
          balance = formatAmount(amounts[2]);
        }
      }

      if (matchedDate && particulars.length > 2) {
        transactions.push({
          date: matchedDate,
          particulars,
          withdrawal,
          deposit,
          balance,
        });
      }
    }
  }

  return transactions;
}

function extractAmounts(text: string): string[] {
  const pattern = /\d+(?:[,]\d{3})*(?:\.\d{2})?|\d+(?:[.]\d{3})*(?:,\d{2})?/g;
  const matches = text.match(pattern) || [];

  return matches
    .filter(m => {
      const cleaned = m.replace(/[,.]/g, "");
      return !isNaN(parseFloat(cleaned)) && cleaned.length >= 1;
    })
    .map(m => m.replace(/,/g, ""));
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount.replace(/[,.]/g, ""));
  if (isNaN(num)) return "";
  return num.toFixed(2);
}

function extractParticulars(text: string, amounts: string[]): string {
  let result = text;

  amounts.forEach(amount => {
    const escapedAmount = amount.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escapedAmount, "g"), "").trim();
  });

  result = result
    .replace(/\s+/g, " ")
    .replace(/^[:\-,.\s]+|[:\-,.\s]+$/g, "")
    .trim();

  result = result.substring(0, 150);

  return result || "Transaction";
}
