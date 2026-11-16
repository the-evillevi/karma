import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Catalog, Product } from "../../domain/catalog.ts";
import { formatMXN } from "../../domain/money.ts";

type ProductGridProps = {
  catalog: Catalog;
  onPick: (product: Product) => void;
  busy?: boolean;
};

/** Lowercase without accents, so "cafe" finds "Café". */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function ProductGrid({
  catalog,
  onPick,
  busy = false,
}: ProductGridProps) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const products = useMemo(() => {
    const needle = normalize(query.trim());
    return catalog.products.filter(
      (product) =>
        (needle !== "" || categoryId === null
          ? true
          : product.categoryId === categoryId) &&
        normalize(product.name).includes(needle),
    );
  }, [catalog, categoryId, query]);

  const filters = [
    { id: null, name: "Todos" },
    ...[...catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder),
  ];

  return (
    <section
      aria-label="Menú"
      aria-busy={busy}
      {...(busy ? { inert: "" } : {})}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <Input
        type="search"
        inputMode="search"
        aria-label="Buscar producto"
        placeholder="Buscar producto"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="bg-card"
      />
      <div
        role="group"
        aria-label="Categorías"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      >
        {filters.map((filter) => {
          const active = query.trim() === "" && filter.id === categoryId;
          return (
            <button
              key={filter.id ?? "todos"}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCategoryId(filter.id);
                setQuery("");
              }}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] border border-border bg-card px-4 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary bg-primary font-medium text-primary-foreground"
                  : "hover:border-primary",
              )}
            >
              {filter.name}
            </button>
          );
        })}
      </div>
      {products.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Ningún producto coincide con «{query.trim()}».
        </p>
      ) : (
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] content-start gap-2 overflow-y-auto pb-24 lg:pb-4">
          {products.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                disabled={!product.available}
                onClick={() => onPick(product)}
                className="flex h-full min-h-20 w-full flex-col justify-between gap-2 rounded-[var(--radius-card)] border border-border bg-card p-3 text-left outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring active:bg-accent disabled:opacity-60 disabled:hover:border-border"
              >
                <span className="text-sm leading-snug font-medium">
                  {product.name}
                </span>
                <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground tabular-nums">
                  {formatMXN(product.priceCents)}
                  {!product.available && (
                    <span className="text-xs text-foreground">Agotado</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
