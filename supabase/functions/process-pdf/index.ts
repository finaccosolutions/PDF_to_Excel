import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
    const text = extractTextFromPDF(arrayBuffer);
    console.log("Extracted PDF text length:", text.length);

    if (!text || text.trim().length < 20) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Could not extract text from PDF. Please ensure the PDF is not password protected or encrypted.",
          data: [],
          filename: file.name,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const transactions = parseTransactions(text);
    console.log("Parsed transactions count:", transactions.length);

    if (transactions.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No transactions found in PDF. Please ensure your PDF contains a valid bank statement with transaction data.",
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
        error: error instanceof Error ? error.message : "Failed to process PDF. Please try again.",
        data: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function extractTextFromPDF(arrayBuffer: ArrayBuffer): string {
  const uint8Array = new Uint8Array(arrayBuffer);
  let text = "";

  try {
    const latin1Decoder = new TextDecoder("latin1");
    const decodedPDF = latin1Decoder.decode(uint8Array);

    text = decodedPDF
      .replace(/\0/g, " ")
      .match(/[\x20-\x7E\n\r\t]+/g)
      ?.join(" ") || "";

    const hexStrings = decodedPDF.match(/<[0-9A-Fa-f]+>/g) || [];
    for (const hexStr of hexStrings) {
      try {
        const hex = hexStr.slice(1, -1);
        let decoded = "";
        for (let i = 0; i < hex.length; i += 2) {
          decoded += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }
        decoded = decoded.replace(/[^\x20-\x7E\n\r]/g, " ");
        text += " " + decoded;
      } catch {
      }
    }

    text = text
      .replace(/\(([^)]*?)\)/g, (_, content) => {
        return content
          .replace(/\\\\/g, "")
          .replace(/[^\x20-\x7E]/g, " ");
      })
      .replace(/\s+/g, " ")
      .trim();

    return text;
  } catch (error) {
    console.error("Error extracting text:", error);
    return "";
  }
}

function parseTransactions(text: string): Transaction[] {
  const lines = text
    .split(/[\n\r]+/)
    .map(line => line.trim())
    .filter(line => line.length > 3);

  const transactions: Transaction[] = [];
  const seenLines = new Set<string>();

  const datePatterns = [
    /(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4})/,
    /(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
  ];

  const skipPatterns = [
    /^page\s+\d+$/i,
    /^statement\s+period/i,
    /^account\s+number/i,
    /^branch/i,
    /^ifsc/i,
    /^address/i,
    /^name/i,
    /^date|particulars|deposit|withdrawal|balance|debit|credit/i,
  ];

  for (const line of lines) {
    if (seenLines.has(line)) continue;
    seenLines.add(line);

    if (skipPatterns.some(p => p.test(line))) continue;

    let foundDate = false;
    let dateStr = "";

    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        foundDate = true;
        dateStr = match[1];
        break;
      }
    }

    if (!foundDate) continue;

    const amounts = extractAmounts(line);
    if (amounts.length === 0) continue;

    const partOfLine = line.replace(dateStr, "").trim();
    const particulars = extractParticulars(partOfLine, amounts);

    if (particulars.length < 2) continue;

    let withdrawal = "";
    let deposit = "";
    let balance = "";

    if (amounts.length >= 3) {
      withdrawal = formatAmount(amounts[0]);
      deposit = formatAmount(amounts[1]);
      balance = formatAmount(amounts[2]);
    } else if (amounts.length === 2) {
      const isDebit = /debit|dr|withdrawal|chq|cheque|paid/i.test(line);
      const isCredit = /credit|cr|deposit|received/i.test(line);

      if (isDebit) {
        withdrawal = formatAmount(amounts[0]);
        balance = formatAmount(amounts[1]);
      } else if (isCredit) {
        deposit = formatAmount(amounts[0]);
        balance = formatAmount(amounts[1]);
      } else {
        const amt0 = parseFloat(amounts[0]);
        const amt1 = parseFloat(amounts[1]);
        if (amt1 > amt0) {
          deposit = formatAmount(amounts[0]);
          balance = formatAmount(amounts[1]);
        } else {
          withdrawal = formatAmount(amounts[0]);
          balance = formatAmount(amounts[1]);
        }
      }
    } else if (amounts.length === 1) {
      balance = formatAmount(amounts[0]);
    }

    transactions.push({
      date: dateStr,
      particulars: particulars.substring(0, 80),
      withdrawal,
      deposit,
      balance,
    });
  }

  return transactions.slice(0, 1000);
}

function extractAmounts(line: string): string[] {
  const amountPattern = /\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})?/g;
  const matches = line.match(amountPattern) || [];

  return matches.filter(m => {
    const num = parseFloat(m.replace(/[,.]/g, ""));
    return num > 0;
  });
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount.replace(/[,.]/g, ""));
  return isNaN(num) ? "" : num.toFixed(2);
}

function extractParticulars(text: string, amounts: string[]): string {
  let result = text;
  for (const amount of amounts) {
    result = result.replace(new RegExp(amount.replace(/[.]/g, "\\."), "g"), "");
  }
  return result
    .replace(/\s+/g, " ")
    .replace(/^[:-.,\s]+|[:-.,\s]+$/g, "")
    .trim();
}
