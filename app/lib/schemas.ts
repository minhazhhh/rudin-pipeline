import { z } from "zod";

/** Coerces "", undefined, or null to null; otherwise coerces to a number. Use for optional numeric fields. */
const numOrNull = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : Number(v)),
  z.number().nullable(),
);

const strOrEmpty = z.preprocess((v) => (v === undefined || v === null ? "" : v), z.string());

export const affBandSchema = z.object({
  pctUnits: z.coerce.number(),
  ami: z.coerce.number(),
  studio: z.coerce.number(),
  oneBr: z.coerce.number(),
  twoBr: z.coerce.number(),
});

export const projectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  borough: z.string().min(1, "Borough is required"),
  status: z.string().min(1, "Status is required"),
  category: z.string().min(1, "Category is required"),
  units: numOrNull,
  sqft: numOrNull,
  deliveryLabel: strOrEmpty,
  sponsor: strOrEmpty,
  lender: strOrEmpty,
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  isRudin: z.coerce.boolean().default(false),
  imageUrl: strOrEmpty,
  affPct: numOrNull,
  mktU: numOrNull,
  affU: numOrNull,
  avgSf: numOrNull,
  affBands: z.array(affBandSchema).nullable().optional(),
  compBuildingName: z.string().nullable().optional(),
});

export const compBuildingSchema = z.object({
  name: z.string().min(1, "Name is required"),
  propertyType: z.string().min(1, "Property type is required"),
  lat: numOrNull,
  lng: numOrNull,
  underwritten: z.coerce.boolean().default(false),
  note: strOrEmpty.nullable().optional(),
  totalN: numOrNull,
});

const statFields = {
  avgRent: numOrNull,
  medRent: numOrNull,
  minRent: numOrNull,
  maxRent: numOrNull,
  nRent: numOrNull,
  avgPsf: numOrNull,
  medPsf: numOrNull,
  minPsf: numOrNull,
  maxPsf: numOrNull,
  nPsf: numOrNull,
};

export const compBuildingStatSchema = z.object({
  buildingId: z.string().min(1),
  unitType: z.string().min(1),
  ...statFields,
  avgSf: numOrNull,
  medSf: numOrNull,
  minSf: numOrNull,
  maxSf: numOrNull,
  nSf: numOrNull,
});

export const overallUnitStatSchema = z.object({
  unitType: z.string().min(1),
  ...statFields,
  avgSf: numOrNull,
  medSf: numOrNull,
  minSf: numOrNull,
  maxSf: numOrNull,
  nSf: numOrNull,
});

export const typeUnitStatSchema = z.object({
  propertyType: z.string().min(1),
  unitType: z.string().min(1),
  ...statFields,
});

export const trendPointSchema = z.object({
  quarter: z.string().min(1),
  quarterOrder: z.coerce.number(),
  unitType: z.string().min(1),
  avgRent: z.coerce.number(),
});
