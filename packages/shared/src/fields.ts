import { z } from "zod";
import { BARCODE_PATTERN, CATEGORY_IDS, UNITS } from "./domain";

// Validation rules for single fields, shared by the mutators and the import parser (import.ts),
// so a file that passes the import preview also passes the server.

export const id = z.string().min(1).max(64);
export const name = z.string().trim().min(1).max(100);
export const unit = z.enum(UNITS);
export const quantity = z.number().positive().max(100_000);
export const containerNumber = z.number().int().positive().max(1_000_000).nullable();
export const notes = z.string().trim().max(500).nullable();
/** Zero's representation of a Postgres `date`: epoch ms at UTC midnight. */
export const date = z.number().int();
export const category = z.enum(CATEGORY_IDS).nullable();
export const barcode = z.string().regex(BARCODE_PATTERN);
export const shelfLifeMonths = z.number().int().positive().max(120).nullable();
