// Order type and customer data (EVL-122 [B]). Delivery needs name, phone and
// address; pickup needs name and phone; counter and table orders need none.
import type { OrderHeader, OrderType } from "./journal.ts";

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
  void type;
  throw new Error("not implemented");
}

/** Required customer fields that are empty or only spaces. */
export function missingCustomerFields(header: OrderHeader): CustomerField[] {
  void header;
  throw new Error("not implemented");
}

/** "Mesa 3", "Recoger · Ana", "Entrega · Ana" or "Mostrador". */
export function headerLabel(header: OrderHeader): string {
  void header;
  throw new Error("not implemented");
}
