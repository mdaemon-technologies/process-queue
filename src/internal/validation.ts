import { ItemID } from '../types.js';

/**
 * Validates if a value is a valid ItemID
 * @param id - Value to check
 * @returns True if id is a non-empty string or a number other than NaN, false otherwise
 */
export const isItemID = (id: unknown): id is ItemID =>
  (typeof id === "string" && id.length > 0) || (typeof id === "number" && !Number.isNaN(id));

/**
 * Validates that a value is an object with a valid id
 */
export const isValidItem = (item: unknown): boolean =>
  typeof item === "object" && item !== null && isItemID((item as { id?: unknown }).id);

/**
 * Normalizes a thrown value to an Error
 */
export const toError = (value: unknown): Error => value instanceof Error ? value : new Error(String(value));
