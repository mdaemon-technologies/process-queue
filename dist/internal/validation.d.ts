import { ItemID } from '../types.js';
/**
 * Validates if a value is a valid ItemID
 * @param id - Value to check
 * @returns True if id is a non-empty string or a number other than NaN, false otherwise
 */
export declare const isItemID: (id: unknown) => id is ItemID;
/**
 * Validates that a value is an object with a valid id
 */
export declare const isValidItem: (item: unknown) => boolean;
/**
 * Normalizes a thrown value to an Error
 */
export declare const toError: (value: unknown) => Error;
