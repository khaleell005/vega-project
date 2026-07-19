import { Prisma } from "@prisma/client";

type RequestStatus = "allowed" | "denied";
type RequestSource = "redis" | "local-fallback";

interface RequestQueryParams {
  clientId: string;
  status?: RequestStatus;
  source?: RequestSource;
  maxLatency?: number;
}

export function buildRequestWhere({
  clientId,
  status,
  source,
  maxLatency,
}: RequestQueryParams): Prisma.RequestWhereInput {
  const where: Prisma.RequestWhereInput = { clientId };
  if (status) where.status = status;
  if (source) where.source = source;
  if (maxLatency !== undefined && !isNaN(maxLatency)) {
    where.responseTimeMs = { lte: maxLatency };
  }
  return where;
}
