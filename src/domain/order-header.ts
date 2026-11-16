// Order type and customer data (EVL-122 [B]). Delivery needs name, phone and
// address; pickup needs name and phone; counter and table orders need none.
import type { OrderHeader, OrderType } from "./journal.ts";
import { tableLabel } from "./tables.ts";

export type CustomerField = "name" | "phone" | "address";

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  mostrador: "Mostrador",
  mesa: "Mesa",
  recoger: "Recoger",
  entrega: "Entrega",
};

export const CUSTOMER_FIELD_LABELS: Record<CustomerField, string> = {
  name: "nombre",
  phone: "teléfono",
  address: "dirección",
};

/** The customer fields this order type requires, in display order. */
export function requiredCustomerFields(type: OrderType): CustomerField[] {
  if (type === "entrega") return ["name", "phone", "address"];
  if (type === "recoger") return ["name", "phone"];
  return [];
}

/** Required customer fields that are empty or only spaces. */
export function missingCustomerFields(header: OrderHeader): CustomerField[] {
  return requiredCustomerFields(header.type).filter(
    (field) => header.customer[field].trim() === "",
  );
}

/** "Mesa 3", "Recoger · Ana", "Entrega · Ana" or "Mostrador". */
export function headerLabel(header: OrderHeader): string {
  if (header.type === "mesa") return tableLabel(header.table) || "Mesa";
  const label = ORDER_TYPE_LABELS[header.type];
  if (header.type === "mostrador") return label;
  const name = header.customer.name.trim();
  return name ? `${label} · ${name}` : label;
}
