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
      console.log("Text extraction failed or too short");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Could not extract enough text from PDF. The PDF might be image-based, password protected, or encrypted.",
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
      console.log("No transactions found in parsed text");
      return new Response(
        JSON.stringify({
          success: false,
          error: "No transaction lines found. Please ensure your PDF is a bank statement with transaction data.",
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
    const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
    let decodedPDF = utf8Decoder.decode(uint8Array);

    if (decodedPDF.indexOf("stream") === -1) {
      const latin1Decoder = new TextDecoder("latin1");
      decodedPDF = latin1Decoder.decode(uint8Array);
    }

    const textContent: string[] = [];

    const streamMatches = decodedPDF.split("stream");
    for (let i = 1; i < streamMatches.length; i++) {
      const streamPart = streamMatches[i];
      const endIndex = streamPart.indexOf("endstream");
      if (endIndex > 0) {
        const streamData = streamPart.substring(0, endIndex);
        const cleaned = streamData
          .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
          .replace(/\s+/g, " ");
        if (cleaned.trim()) {
          textContent.push(cleaned);
        }
      }
    }

    const parenStart = decodedPDF.indexOf("(");
    let currentIndex = parenStart;
    while (currentIndex > -1 && currentIndex < decodedPDF.length) {
      const closeIndex = decodedPDF.indexOf(")", currentIndex);
      if (closeIndex === -1) break;

      const content = decodedPDF.substring(currentIndex + 1, closeIndex);
      if (content.length > 3 && content.length < 500) {
        const cleaned = content
          .replace(/\\\(/g, "(")
          .replace(/\\\)/g, ")")
          .replace(/\\\\\\\\/g, "\\")
          .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
          .replace(/\s+/g, " ");
        if (cleaned.trim().length > 2) {
          textContent.push(cleaned);
        }
      }

      currentIndex = decodedPDF.indexOf("(", closeIndex);
    }

    text = textContent.join(" ");

    text = text
      .replace(/\s+/g, " ")
      .replace(/[^\x20-\x7E\n\r\t]/g, " ")
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

  console.log(`Processing ${lines.length} lines`);

  const transactions: Transaction[] = [];
  const seenLines = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (seenLines.has(line) || line.length < 10) continue;

    const lineKey = line.substring(0, 50);
    if (seenLines.has(lineKey)) continue;
    seenLines.add(lineKey);

    if (isHeaderLine(line)) continue;

    const dateMatch = extractDate(line);
    if (!dateMatch) continue;

    const amounts = extractAmounts(line);
    if (amounts.length === 0) continue;

    const particulars = extractParticulars(line, dateMatch, amounts);
    if (particulars.length < 2) continue;

    let withdrawal = "";
    let deposit = "";
    let balance = "";

    if (amounts.length >= 3) {
      balance = formatAmount(amounts[amounts.length - 1]);
      const firstAmount = amounts[0];
      const secondAmount = amounts.length > 1 ? amounts[1] : "";

      const isDebit = line.match(/debit|dr|withdrawal|chq|cheque|paid|atm|transfer/i);
      const isCredit = line.match(/credit|cr|deposit|received|salary|interest/i);

      if (isDebit && !isCredit) {
        withdrawal = formatAmount(firstAmount);
      } else if (isCredit && !isDebit) {
        deposit = formatAmount(firstAmount);
      } else if (secondAmount) {
        withdrawal = formatAmount(firstAmount);
        deposit = formatAmount(secondAmount);
      } else {
        withdrawal = formatAmount(firstAmount);
      }
    } else if (amounts.length === 2) {
      const isDebit = line.match(/debit|dr|withdrawal|chq|cheque|paid|atm|transfer/i);
      const isCredit = line.match(/credit|cr|deposit|received|salary|interest/i);

      if (isDebit && !isCredit) {
        withdrawal = formatAmount(amounts[0]);
        balance = formatAmount(amounts[1]);
      } else if (isCredit && !isDebit) {
        deposit = formatAmount(amounts[0]);
        balance = formatAmount(amounts[1]);
      } else {
        const amt0 = parseFloat(amounts[0].replace(/[,.]/g, ""));
        const amt1 = parseFloat(amounts[1].replace(/[,.]/g, ""));
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

    if (balance || withdrawal || deposit) {
      transactions.push({
        date: dateMatch,
        particulars: particulars.substring(0, 100),
        withdrawal,
        deposit,
        balance,
      });
    }
  }

  console.log(`Parsed ${transactions.length} transactions`);
  return transactions.slice(0, 1000);
}

function isHeaderLine(line: string): boolean {
  const headerPatterns = [
    "page",
    "statement",
    "account",
    "branch",
    "ifsc",
    "name",
    "address",
    "date",
    "particulars",
    "deposit",
    "withdrawal",
    "balance",
    "debit",
    "credit",
  ];

  const lowerLine = line.toLowerCase();
  return headerPatterns.some(p => lowerLine.includes(p) && line.length < 50);
}

function extractDate(line: string): string {
  const patterns = [
    /(\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4})/,
    /(\d{4}[-\/\.]\d{1,2}[-\/\.]\d{1,2})/,
    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)[a-z]*\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return "";
}

function extractAmounts(line: string): string[] {
  const patterns = [
    /\d{1,3}(?:,\d{3})*\.\d{2}/g,
    /\d{1,3}(?:\.\d{3})*,\d{2}/g,
    /\d+\.\d{2}/g,
    /\d+,\d{2}/g,
  ];

  const matches = new Set<string>();

  for (const pattern of patterns) {
    const found = line.match(pattern);
    if (found) {
      found.forEach(m => matches.add(m));
    }
  }

  return Array.from(matches).filter(m => {
    const num = parseFloat(m.replace(/[,.]/g, ""));
    return num >= 0.01 && num < 999999999;
  });
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount.replace(/[,.]/g, ""));
  return isNaN(num) ? "" : num.toFixed(2);
}

function extractParticulars(line: string, date: string, amounts: string[]): string {
  let result = line.replace(date, "");

  for (const amount of amounts) {
    result = result.replace(amount, "");
  }

  result = result
    .replace(/\s+/g, " ")
    .replace(/^[:-.,\s]+|[:-.,\s]+$/g, "")
    .trim();

  return result;
}
