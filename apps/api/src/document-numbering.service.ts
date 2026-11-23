import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service.js";

// Every automatically numbered document type is registered here with its own unique prefix.
export const DOCUMENT_NUMBERING = { requisition: { prefix: "Req", digits: 4 } } as const;
export type NumberingType = keyof typeof DOCUMENT_NUMBERING;
export const NUMBERING_TIME_ZONE = "Asia/Riyadh";
const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: NUMBERING_TIME_ZONE, calendar: "gregory", numberingSystem: "latn" });
export const documentYear = (date: Date) => Number(yearFormatter.format(date));
export function formatDocumentNumber(prefix: string, year: number, sequence: bigint, digits = 4) {
  if (!/^[A-Za-z][A-Za-z0-9]{0,15}$/.test(prefix) || !Number.isInteger(year) || year < 1 || sequence < 1n) throw new RangeError("Invalid document number components.");
  return `${prefix}-${year}-${sequence.toString().padStart(digits, "0")}`;
}

@Injectable()
export class DocumentNumberingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.prisma.$transaction(work, { maxWait: 30_000, timeout: 60_000 });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2034") throw error;
        if (attempt === 5) throw new ConflictException("Document numbering is busy; retry saving.");
        await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw new ConflictException("Document numbering is busy; retry saving.");
  }

  async next(tx: Prisma.TransactionClient, type: NumberingType, at = new Date()) {
    const { prefix, digits } = DOCUMENT_NUMBERING[type];
    const year = documentYear(at);
    // The upsert locks this prefix/year until the caller's document transaction commits.
    await tx.$executeRaw`INSERT INTO \`document_number_sequences\` (\`prefix\`, \`year\`, \`last_value\`, \`updated_at\`)
      VALUES (${prefix}, ${year}, 1, CURRENT_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE \`last_value\` = \`last_value\` + 1, \`updated_at\` = CURRENT_TIMESTAMP(3)`;
    const row = await tx.documentNumberSequence.findUniqueOrThrow({ where: { prefix_year: { prefix, year } } });
    return formatDocumentNumber(prefix, year, row.lastValue, digits);
  }

  async status(at = new Date()) {
    const year = documentYear(at);
    const rows = await this.prisma.documentNumberSequence.findMany({ where: { year } });
    return {
      year, timeZone: NUMBERING_TIME_ZONE,
      series: Object.entries(DOCUMENT_NUMBERING).map(([type, { prefix, digits }]) => {
        const lastValue = rows.find(row => row.prefix === prefix)?.lastValue ?? 0n;
        return { type, prefix, lastValue: lastValue.toString(), lastNumber: lastValue ? formatDocumentNumber(prefix, year, lastValue, digits) : null };
      }),
    };
  }
}
