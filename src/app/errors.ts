import { StorageWriteError } from "../data/pos-store.ts";
import { CommandRejectedError } from "../domain/commands.ts";
import { CUSTOMER_FIELD_LABELS } from "../domain/order-header.ts";
import type { CustomerField } from "../domain/order-header.ts";
import { OrderError } from "../domain/order.ts";
import { PaymentRejectedError } from "../domain/payment.ts";

const REJECTIONS: Record<CommandRejectedError["reason"], string> = {
  "not-allowed": "Tu usuario no tiene permiso para esta acción.",
  "empty-order": "Agrega al menos un producto.",
  "order-closed": "Esta cuenta ya fue cobrada y no se puede modificar.",
  "account-changed":
    "Esta cuenta cambió en otra pantalla. Ábrela de nuevo desde Cuentas abiertas para ver la versión actual.",
  "unknown-order": "No se encontró la cuenta.",
  "table-required": "Elige una mesa.",
  "table-unavailable": "Esa mesa no está disponible.",
  "invalid-table-count": "La cantidad de mesas debe estar entre 0 y 99.",
  "missing-customer-data": "Faltan datos del cliente.",
  "sent-to-kitchen":
    "Lo que ya se envió a cocina no se puede quitar ni cambiar desde aquí.",
  "nothing-new": "No hay productos nuevos que enviar a cocina.",
  "unknown-comanda": "No se encontró la comanda.",
  "comanda-finished": "Esta comanda ya fue entregada.",
  "invalid-preparation-step": "La comanda cambió; revisa su estado.",
  "pending-balance": "El pago no cubre el total a liquidar.",
  "invalid-tip": "La propina no es válida.",
  "invalid-price": "Escribe un precio mayor a $0.00.",
  "unknown-product": "No se encontró el producto.",
  "invalid-name": "Escribe el nombre del producto.",
  "unknown-category": "Elige una categoría.",
  "invalid-sku": "El SKU solo lleva números.",
  "duplicate-sku": "Ya existe un producto con ese SKU.",
};

export function errorMessage(error: unknown): string {
  if (error instanceof CommandRejectedError) {
    if (error.reason === "missing-customer-data") {
      const fields = error.fields.map(
        (field) => CUSTOMER_FIELD_LABELS[field as CustomerField] ?? field,
      );
      return `Falta ${fields.join(", ")} del cliente.`;
    }
    return REJECTIONS[error.reason];
  }
  if (error instanceof OrderError && error.reason === "product-unavailable") {
    return "Este producto está agotado.";
  }
  if (error instanceof PaymentRejectedError) {
    return error.reason === "only-cash-gives-change"
      ? "Sólo el efectivo puede exceder el total; con tarjeta o transferencia cobra el importe exacto."
      : "Captura un importe mayor a $0.00.";
  }
  if (error instanceof StorageWriteError) {
    return "No se pudo guardar en este dispositivo. La operación no se registró; intenta de nuevo.";
  }
  return "Ocurrió un error inesperado. La operación no se registró.";
}
