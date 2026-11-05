import { orderedDatabaseFields, type DatabaseData, type DatabaseField, type DatabaseView } from "./model";

/** The first visible field is the card title; all subsequent fields appear below it. */
export function getCardVisibleFields(data: DatabaseData, view: DatabaseView): DatabaseField[] {
  return orderedDatabaseFields(data, view).filter((field) => !view.hiddenFields.includes(field.id));
}
